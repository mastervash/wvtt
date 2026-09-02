/**
 * Dice: rolling, landing on the rolled face, shaking to roll, and colouring.
 *
 * The dice were untextured solids with their value on a floating billboard, sunk to
 * their equator in the felt because every solid is modelled around its own centre.
 * They carry their numbers now, rest on the table, and tumble when rolled — all of
 * which is worth a suite, because most of it is geometry that fails silently.
 */
import { chromium } from 'playwright';

const SHOT = process.env.SHOT_DIR ?? new URL('./screenshots/', import.meta.url).pathname;
const wait = (ms) => new Promise(r => setTimeout(r, ms));
let bad = 0;
const check = (l,c,d='') => { if(!c) bad++; console.log(`  [${c?'PASS':'FAIL'}] ${l}${!c&&d?` — ${d}`:''}`); };
const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const p = await browser.newPage({ viewport: { width: 1100, height: 800 } });
p.on('pageerror', e => { bad++; console.log('  [PAGEERROR]', String(e).slice(0,200)); });
await p.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await p.fill('input[placeholder="Guest"]', 'Roller');
await p.click('button:has-text("Dice Tray")');
await p.click('button:has-text("Create table")');
await p.waitForSelector('.topbar', { timeout: 25000 });
await wait(6000);

const st = () => p.evaluate(() => window.__wvtt);
// The server reports refused ops on a channel the client ignores; collect them here.
await p.evaluate(() => {
  window.__errs = [];
  window.__wvttRoom.onMessage('opError', (m) => window.__errs.push(m));
});
const box = await p.locator('canvas').boundingBox();
/** Aim at the middle of the die's body, not at the felt beneath it. */
const dieAt = async (defId) => p.evaluate((d) => {
  const s = window.__wvtt;
  const pc = Object.values(s.pieces).find(q => q.defId === d);
  return { id: pc.id, ...window.__wvttProject(pc.x, pc.z) };
}, defId);

/**
 * Press on a die and confirm it was picked up.
 *
 * The projected centre is only an approximation of where a solid ends up on screen, and
 * a press a few pixels out lands on the felt instead — which reads as "the feature is
 * broken" rather than "the test missed". So it searches a little around the aim point
 * and reports the offset it settled on.
 */
const grab = async (die) => {
  for (const [dx, dy] of [[0, 0], [0, -10], [0, 10], [-10, 0], [10, 0], [0, -20], [0, 20]]) {
    await p.mouse.move(box.x + die.x + dx, box.y + die.y + dy);
    // Let the hover settle before pressing: the press is judged against what the scene
    // last resolved under the pointer.
    await wait(180);
    await p.mouse.down();
    await wait(450);
    if ((await st()).pieces[die.id].heldBy) { die.x += dx; die.y += dy; return true; }
    await p.mouse.up();
    await wait(200);
  }
  return false;
};

// --- shake to roll ---------------------------------------------------------
const d6 = await dieAt('d6');
const seqBefore = (await st()).pieces[d6.id].rollSeq ?? 0;
check('the die can be picked up', await grab(d6));
/*
 * The shake itself is dispatched from inside the page.
 *
 * Playwright's mouse.move is a round trip per event, and on a loaded machine running a
 * software renderer those land hundreds of milliseconds apart — far slower than any
 * hand, and slow enough that the detector correctly reads each one as the pointer
 * having stopped. A real shake is a burst of events a few milliseconds apart, which is
 * what this produces. The die is held by a genuine press; only the rattle is synthetic.
 */
await p.evaluate(({ x, y }) => {
  let at = x;
  for (let i = 0; i < 14; i++) {
    at = i % 2 === 0 ? x - 26 : x + 26;
    window.dispatchEvent(new PointerEvent('pointermove', {
      clientX: at, clientY: y, pointerId: 1, bubbles: true,
    }));
  }
}, { x: box.x + d6.x, y: box.y + d6.y });
await wait(600);
await p.mouse.up();
await wait(1500);
const seqAfter = (await st()).pieces[d6.id].rollSeq ?? 0;
check('shaking a held die rolls it', seqAfter > seqBefore, `${seqBefore} -> ${seqAfter}`);

// A plain drag must NOT roll it.
const d8 = await dieAt('d8');
const s8 = (await st()).pieces[d8.id].rollSeq ?? 0;
const x8 = (await st()).pieces[d8.id].x;
check('the d8 can be picked up', await grab(d8));
await p.mouse.move(box.x + d8.x + 160, box.y + d8.y + 60, { steps: 20 });
await p.mouse.up();
await wait(1200);
check('a plain drag moves the die', Math.abs((await st()).pieces[d8.id].x - x8) > 0.1,
  `${x8.toFixed(2)} -> ${(await st()).pieces[d8.id].x.toFixed(2)}`);
check('a plain drag does not roll', ((await st()).pieces[d8.id].rollSeq ?? 0) === s8);

// --- rolling via the context menu -----------------------------------------
const d20 = await dieAt('d20');
await p.mouse.click(box.x + d20.x, box.y + d20.y, { button: 'right' });
await p.waitForSelector('.piece-menu', { timeout: 8000 });
const title = await p.textContent('.pm-title');
check('the die menu names it', /d20|showing/i.test(title), title);
const before = (await st()).pieces[d20.id];
await p.click('.piece-menu button:has-text("Roll the d20")');
await wait(1500);
const after = (await st()).pieces[d20.id];
check('rolling bumps the roll counter', (after.rollSeq ?? 0) > (before.rollSeq ?? 0),
  `${before.rollSeq} -> ${after.rollSeq}`);
check('the value is in range', after.secret.value >= 1 && after.secret.value <= 20, String(after.secret.value));

// --- colour ----------------------------------------------------------------
await p.mouse.click(box.x + d20.x, box.y + d20.y, { button: 'right' });
await p.waitForSelector('.piece-menu', { timeout: 8000 });
await p.click('.piece-menu button:has-text("Colour")');
await wait(300);
check('a colour submenu opens', (await p.locator('.pm-swatch').count()) === 8,
  `${await p.locator('.pm-swatch').count()} swatches`);
await p.locator('.pm-swatch').nth(5).click();
await wait(900);
check('the colour reaches the table', (await st()).pieces[d20.id].tint === 'blue',
  (await st()).pieces[d20.id].tint);

await p.screenshot({ path: `${SHOT}/14-dice.png` });
console.log(bad === 0 ? '\nALL CHECKS PASSED' : `\n${bad} CHECK(S) FAILED`);
await browser.close();
process.exit(bad ? 1 : 0);
