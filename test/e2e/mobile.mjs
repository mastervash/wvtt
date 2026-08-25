/**
 * Mobile layout and touch.
 *
 * Runs an iPhone-sized viewport with real touch events. The camera framing adapts to
 * the viewport, so this suite is what catches a change that looks fine in a desktop
 * window but puts the deck off the edge of a phone screen.
 */

import { chromium, devices } from 'playwright';

const SHOT = process.env.SHOT_DIR ?? new URL('./screenshots/', import.meta.url).pathname;
let failures = 0;
const check = (l, c, d='') => { if (!c) failures++; console.log(`  [${c?'PASS':'FAIL'}] ${l}${!c&&d?` — ${d}`:''}`); };
const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });

const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
page.on('pageerror', e => console.log(`  [PAGE ERROR] ${String(e).slice(0,160)}`));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.screenshot({ path: SHOT + '/m1-lobby.png' });
const lobbyScrollX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('the lobby does not scroll sideways', lobbyScrollX <= 1, `overflow ${lobbyScrollX}px`);

await page.fill('input[placeholder="Guest"]', 'Mo');
await page.click('button:has-text("Create table")');
await page.waitForSelector('.topbar', { timeout: 25000 });
await page.waitForTimeout(3000);

const info = await page.evaluate(() => ({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  canvas: !!document.querySelector('canvas'),
  canvasH: document.querySelector('canvas')?.clientHeight ?? 0,
  trayVisible: !!document.querySelector('.tray'),
  shuffleBox: document.querySelector('.topbar .actions button')?.getBoundingClientRect().height ?? 0,
}));
check('the table does not scroll sideways', info.overflow <= 1, `overflow ${info.overflow}px`);
check('the 3D canvas fills the screen', info.canvas && info.canvasH > 500, `${info.canvasH}px tall`);
check('the hand tray is present', info.trayVisible);
check('toolbar buttons are a usable tap size', info.shuffleBox >= 28, `${info.shuffleBox}px tall`);

// Tap the deck with a real touch event and confirm a card reaches the hand.
await page.screenshot({ path: SHOT + '/m2-table.png' });
const box = await page.locator('canvas').boundingBox();
// The deck sits left of centre; find it by walking a few candidate spots rather than
// hard-coding one pixel, since the camera framing adapts to the viewport.
let drew = 0;
for (const [fx, fy] of [[0.13, 0.45], [0.16, 0.42], [0.10, 0.48], [0.20, 0.45]]) {
  await page.touchscreen.tap(box.x + box.width * fx, box.y + box.height * fy);
  await page.waitForTimeout(1400);
  drew = await page.locator('.tray-card').count();
  if (drew > 0) break;
}
check('tapping the deck draws a card by touch', drew === 1, `tray holds ${drew}`);
await page.screenshot({ path: SHOT + '/m2b-drawn.png' });

await page.click('.topbar .icon');
await page.waitForTimeout(400);
await page.screenshot({ path: SHOT + '/m3-menu.png' });
const menuFits = await page.evaluate(() => {
  const m = document.querySelector('.menu');
  if (!m) return false;
  const r = m.getBoundingClientRect();
  return r.right <= window.innerWidth + 1 && r.left >= -1;
});
check('the menu fits on screen', menuFits);

console.log(failures === 0 ? '\nMOBILE LAYOUT OK' : `\n${failures} CHECK(S) FAILED`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
