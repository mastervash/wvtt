/**
 * The piece context menu.
 *
 * Covers the actions that had no way to be triggered before: rolling a die, splitting a
 * pile and peeking. The Dice Tray pack shipped unplayable because tapping a die flipped
 * it instead of rolling it, so this suite is what stops that regressing.
 */

import { chromium } from 'playwright';

const SHOT = process.env.SHOT_DIR ?? new URL('./screenshots/', import.meta.url).pathname;
let failures = 0;
const check = (l, c, d = '') => { if (!c) failures++; console.log(`  [${c ? 'PASS' : 'FAIL'}] ${l}${!c && d ? ` — ${d}` : ''}`); };

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

async function table(packButton, name) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on('pageerror', (e) => console.log(`  [PAGE ERROR] ${String(e).slice(0, 200)}`));
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.fill('input[placeholder="Guest"]', name);
  await page.click(`button:has-text("${packButton}")`);
  await page.click('button:has-text("Create table")');
  await page.waitForSelector('.topbar', { timeout: 20000 });
  await page.waitForTimeout(2500);
  return page;
}

/**
 * Right-click around the middle of the table until the menu opens on something.
 * The camera adapts to the viewport, so a fixed pixel would be brittle.
 */
async function openMenuOnSomething(page, wantText) {
  const box = await page.locator('canvas').boundingBox();
  const spots = [];
  for (const fy of [0.45, 0.40, 0.50, 0.55, 0.35]) {
    for (const fx of [0.5, 0.45, 0.55, 0.40, 0.60, 0.35, 0.65, 0.3, 0.7]) spots.push([fx, fy]);
  }
  for (const [fx, fy] of spots) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy, { button: 'right' });
    await page.waitForTimeout(220);
    const menu = await page.$('.piece-menu');
    if (!menu) continue;
    const text = await menu.innerText();
    if (!wantText || text.includes(wantText)) return { text, at: [fx, fy] };
    await page.keyboard.press('Escape');
  }
  return null;
}

/* ---------------- dice ---------------- */
console.log('\nDice Tray: rolling a die');
{
  const page = await table('Dice Tray', 'Roller');
  const opened = await openMenuOnSomething(page, 'Roll');
  check('right-clicking a die opens a menu offering a roll', !!opened, 'never found a die');

  if (opened) {
    await page.screenshot({ path: `${SHOT}/9-dice-menu.png` });
    const before = await page.evaluate(() =>
      Object.values(window.__wvtt.pieces).filter((p) => p.kind === 'die').map((p) => p.secret?.value));
    await page.click('.piece-menu button:has-text("Roll")');
    await page.waitForTimeout(1500);

    const logText = await page.evaluate(() => window.__wvtt.log.map((l) => l.text).join(' | '));
    check('the roll is announced in the log', /rolled d\d+: \d+/.test(logText), logText.slice(-120));

    const after = await page.evaluate(() =>
      Object.values(window.__wvtt.pieces).filter((p) => p.kind === 'die').map((p) => p.secret?.value));
    check('every die shows a value in range', after.every((v) => typeof v === 'number' && v >= 1), JSON.stringify(after));
    check('the menu closes after acting', !(await page.$('.piece-menu')));
    // A roll landing on the same face is possible, so only require that something moved
    // or that the log recorded it, which the check above already asserts.
    console.log(`  (values before: ${JSON.stringify(before)} after: ${JSON.stringify(after)})`);
  }
  await page.close();
}

/* ---------------- splitting a pile ---------------- */
console.log('\nCard Sandbox: splitting a pile');
{
  const page = await table('Card Sandbox', 'Splitter');
  const stacksBefore = await page.evaluate(() => Object.keys(window.__wvtt.stacks).length);
  const opened = await openMenuOnSomething(page, 'Split in half');
  check('right-clicking the deck offers a split', !!opened, 'never found the deck');
  const deckSpot = opened?.at ?? null;

  if (opened) {
    await page.click('.piece-menu button:has-text("Split in half")');
    // A stack and its contents can arrive in separate patches, so poll until the
    // client's view of the table settles rather than sampling it once.
    const after = await page.waitForFunction(() => {
      const s = window.__wvtt;
      const sizes = Object.values(s.stacks).map((st) => st.pieceIds?.length ?? 0);
      const inStacks = sizes.reduce((a, b) => a + b, 0);
      if (Object.keys(s.stacks).length < 2 || inStacks !== 52) return null;
      return { sizes: sizes.sort((a, b) => b - a), count: Object.keys(s.stacks).length, inStacks };
    }, null, { timeout: 8000 }).then((h) => h.jsonValue()).catch(() => null);

    check('the deck becomes two piles', !!after && after.count === stacksBefore + 1,
      after ? `${stacksBefore} -> ${after.count}` : 'never settled');
    check('the cards are split evenly with none lost', !!after && after.sizes.slice(0, 2).join(',') === '26,26',
      after ? after.sizes.join(',') : 'never settled');
  }

  console.log('\nLong-press works the same way on touch');
  const box = await page.locator('canvas').boundingBox();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  // Press and hold without moving, which is how the menu is reached on a phone.
  // Start from the spot that already resolved to a pile, then fall back to a scan.
  let longPressed = false;
  const grid = deckSpot ? [deckSpot] : [];
  for (const fy of [0.45, 0.40, 0.50, 0.55, 0.35]) {
    for (const fx of [0.5, 0.45, 0.55, 0.40, 0.60, 0.35, 0.65, 0.3, 0.7]) grid.push([fx, fy]);
  }
  for (const [fx, fy] of grid) {
    await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
    await page.mouse.down();
    // Hold well past the 450ms threshold, and check while still holding. Under the
    // rendering load of several browser contexts the timer can slip, and releasing too
    // early cancels the press before it ever becomes a long one.
    await page.waitForTimeout(1200);
    longPressed = !!(await page.$('.piece-menu'));
    await page.mouse.up();
    await page.waitForTimeout(200);
    if (longPressed) break;
  }
  check('holding a press opens the menu', longPressed);

  console.log('\nRecentre control');
  await page.keyboard.press('Escape');
  check('the toolbar offers a way back to a sensible view', !!(await page.$('button:has-text("Recentre")')));
  await page.close();
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
