/**
 * Keyboard shortcuts.
 *
 * Shortcuts act on whatever the pointer is over, so this suite moves the mouse onto a
 * pile and presses keys — no clicking. What it is really guarding is the coupling
 * between the hover outline and the key handler: if hovering ever stops registering,
 * every shortcut silently becomes a no-op, and nothing else in the test suite would
 * notice.
 */

import { chromium } from 'playwright';

const SHOT = process.env.SHOT_DIR ?? new URL('./screenshots/', import.meta.url).pathname;
let failures = 0;
const check = (l, c, d = '') => { if (!c) failures++; console.log(`  [${c ? 'PASS' : 'FAIL'}] ${l}${!c && d ? ` — ${d}` : ''}`); };

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
page.on('pageerror', (e) => console.log(`  [PAGE ERROR] ${String(e).slice(0, 200)}`));

const state = () => page.evaluate(() => window.__wvtt);
const logText = (s, n = 8) => s.log.slice(-n).map((l) => l.text).join(' | ');

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.fill('input[placeholder="Guest"]', 'Keys');
await page.click('button:has-text("Card Sandbox")');
await page.click('button:has-text("Create table")');
await page.waitForSelector('.topbar', { timeout: 20000 });
await page.waitForTimeout(2500);

/**
 * Find the deck by hovering, not by clicking: the same signal the shortcuts use.
 * The camera adapts to the viewport, so a fixed pixel would be brittle.
 */
const box = await page.locator('canvas').boundingBox();
const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];

let spot = null;
for (const fy of [0.45, 0.40, 0.50, 0.55, 0.35]) {
  for (const fx of [0.5, 0.45, 0.55, 0.40, 0.60, 0.35, 0.65, 0.3, 0.7]) {
    if (spot) continue;
    await page.mouse.move(...at(fx, fy));
    await page.waitForTimeout(140);
    // Whether the pointer found the pile is itself only observable through a shortcut,
    // so the probe IS a shortcut: L locks what is hovered, and locking is visible in
    // state. It is undone immediately.
    await page.keyboard.press('l');
    await page.waitForTimeout(280);
    if (Object.values((await state()).stacks)[0]?.locked) {
      await page.keyboard.press('l');
      await page.waitForTimeout(280);
      spot = [fx, fy];
    }
  }
}

console.log('\nHovering a pile');
check('the pointer finds the deck and a key acts on it', !!spot, 'no hover target responded to a key');

if (spot) {
  await page.mouse.move(...at(...spot));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOT}/11-hotkeys-hover.png` });

  console.log('\nS shuffles');
  {
    const before = await state();
    const order = Object.values(before.stacks)[0].pieceIds.join(',');
    await page.keyboard.press('s');
    await page.waitForTimeout(600);
    const after = await state();
    const now = Object.values(after.stacks)[0].pieceIds.join(',');
    check('the pile is shuffled', now !== order);
    check('the log says who shuffled it', /shuffled/.test(logText(after)), logText(after));
    check('no cards were lost', Object.values(after.stacks)[0].pieceIds.length === 52);
  }

  console.log('\n4 draws four cards');
  {
    const seat = await page.evaluate(() => {
      const s = window.__wvtt;
      const me = Object.values(s.players)[0];
      return me.seat;
    });
    const handZone = `hand${seat}`;
    const before = await state();
    const held = Object.values(before.pieces).filter((p) => p.zoneId === handZone).length;
    await page.keyboard.press('4');
    await page.waitForTimeout(900);
    const after = await state();
    const now = Object.values(after.pieces).filter((p) => p.zoneId === handZone).length;
    check('four cards arrive in the hand', now === held + 4, `${held} -> ${now}`);
    check('they came off the pile', Object.values(after.stacks)[0].pieceIds.length === 48,
      `${Object.values(after.stacks)[0].pieceIds.length}`);
    check('the draw is logged with a count', /drew 4 cards/.test(logText(after)), logText(after));
  }

  console.log('\nF turns the pile over');
  {
    const before = await state();
    const topId = Object.values(before.stacks)[0].pieceIds.slice(-1)[0];
    const wasUp = before.pieces[topId].faceUp;
    await page.keyboard.press('f');
    await page.waitForTimeout(700);
    const after = await state();
    const nowTopId = Object.values(after.stacks)[0].pieceIds.slice(-1)[0];
    check('the pile is turned over', after.pieces[nowTopId].faceUp !== wasUp
      || nowTopId !== topId, 'nothing changed');
    check('the flip is logged', /turned .* over/.test(logText(after)), logText(after));
  }

  console.log('\nT takes the top card off');
  {
    const before = await state();
    const size = Object.values(before.stacks)[0].pieceIds.length;
    await page.keyboard.press('t');
    await page.waitForTimeout(800);
    const after = await state();
    const biggest = Object.values(after.stacks).reduce((a, b) => (b.pieceIds.length > a.pieceIds.length ? b : a));
    check('the pile loses a card', biggest.pieceIds.length === size - 1, `${size} -> ${biggest.pieceIds.length}`);
  }

  console.log('\nP pings, and the shortcut can be switched off');
  {
    await page.keyboard.press('p');
    await page.waitForTimeout(500);
    const after = await state();
    check('the ping is logged', /pinged the table/.test(logText(after)), logText(after));

    await page.click('.topbar .icon');
    await page.click('.menu label.check:has-text("Single-key shortcuts") input');
    await page.click('.topbar .icon');
    await page.waitForTimeout(300);
    await page.mouse.move(...at(...spot));
    await page.waitForTimeout(200);

    const before = await state();
    const order = Object.values(before.stacks).reduce((a, b) => (b.pieceIds.length > a.pieceIds.length ? b : a)).pieceIds.join(',');
    await page.keyboard.press('s');
    await page.waitForTimeout(600);
    const after2 = await state();
    const now = Object.values(after2.stacks).reduce((a, b) => (b.pieceIds.length > a.pieceIds.length ? b : a)).pieceIds.join(',');
    check('with shortcuts off, S does nothing', now === order);
  }
}

console.log('\nTyping is never a shortcut');
{
  // Turn shortcuts back on, then type into chat. Every one of these letters is a key
  // that would otherwise shuffle, flip or draw.
  await page.click('.topbar .icon');
  await page.click('.menu label.check:has-text("Single-key shortcuts") input');
  await page.click('.topbar .icon');
  await page.waitForTimeout(300);

  const before = await state();
  const biggestBefore = Object.values(before.stacks).reduce((a, b) => (b.pieceIds.length > a.pieceIds.length ? b : a));
  const order = biggestBefore.pieceIds.join(',');

  await page.click('button:has-text("Chat")');
  await page.waitForSelector('.chat-input input');
  await page.fill('.chat-input input', '');
  await page.type('.chat-input input', 'shall we deal 4 hands first?', { delay: 20 });
  await page.waitForTimeout(600);

  const after = await state();
  const biggestAfter = Object.values(after.stacks).reduce((a, b) => (b.pieceIds.length > a.pieceIds.length ? b : a));
  check('the deck was not shuffled by typing', biggestAfter.pieceIds.join(',') === order);
  check('no cards were drawn by typing', biggestAfter.pieceIds.length === biggestBefore.pieceIds.length,
    `${biggestBefore.pieceIds.length} -> ${biggestAfter.pieceIds.length}`);
  check('the message is intact in the box',
    (await page.inputValue('.chat-input input')) === 'shall we deal 4 hands first?',
    await page.inputValue('.chat-input input'));
}

await page.close();
await browser.close();
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
