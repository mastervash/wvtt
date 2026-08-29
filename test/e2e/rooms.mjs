/**
 * Coming back to a table you left.
 *
 * A room object is disposed the moment it is empty — keeping hundreds of idle rooms in
 * memory would be the wrong trade — so returning is really a restore from the snapshot
 * on disk. That path had no coverage from a browser, and it is the one players hit
 * whenever they close a tab and come back later.
 *
 * The other half is finding the table again: the room code is the only way in, and
 * nobody remembers six random characters, so the lobby keeps a list.
 *
 * Run: node test/e2e/rooms.mjs
 */

import { chromium } from 'playwright';

const SHOT = process.env.SHOT_DIR ?? new URL('./screenshots/', import.meta.url).pathname;
let failures = 0;
const check = (l, c, d = '') => { if (!c) failures++; console.log(`  [${c ? 'PASS' : 'FAIL'}] ${l}${!c && d ? ` — ${d}` : ''}`); };

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
// One context throughout: the recent-table list lives in this browser's storage, which
// is the whole point of it.
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log(`  [PAGE ERROR] ${String(e).slice(0, 200)}`));

const state = () => page.evaluate(() => window.__wvtt);

console.log('\nMaking a table and playing a little');
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.fill('input[placeholder="Guest"]', 'Vash');
await page.click('button:has-text("Wild Colours")');
await page.click('button:has-text("Create table")');
await page.waitForSelector('.topbar', { timeout: 20000 });
await page.waitForTimeout(2500);

const code = (await page.textContent('.topbar .room .code')).trim();
await page.click('button:has-text("New round")');
await page.waitForTimeout(2200);

const before = await state();
const handBefore = Object.values(before.pieces).filter((p) => p.zoneId === 'hand0').length;
check('a hand was dealt', handBefore === 7, `${handBefore}`);

console.log('\nLeaving empties the table, and the server lets it go');
await page.click('.topbar .icon');
await page.click('.menu button:has-text("Leave table")');
await page.waitForSelector('.lobby', { timeout: 15000 });
await page.waitForTimeout(1500);

console.log('\nThe lobby remembers where you have been');
const rows = await page.locator('.recent-row').count();
check('the table is listed on the lobby', rows >= 1, `${rows} rows`);
const label = (await page.locator('.recent-row .rejoin').first().innerText()).replace('\n', ' · ');
check('it is listed by code and game', label.includes(code) && /Wild Colours/.test(label), label);
await page.screenshot({ path: `${SHOT}/12-recent-tables.png`, fullPage: true });

console.log('\nGoing back rebuilds it from disk');
await page.locator('.recent-row .rejoin').first().click();
await page.waitForSelector('.topbar', { timeout: 25000 });
await page.waitForTimeout(2800);

const after = await state();
check('the same room code came back', (await page.textContent('.topbar .room .code')).trim() === code);
check('the pack came back', after.packName === 'Wild Colours', after.packName);
check('every card is still there', Object.keys(after.pieces).length === 108, `${Object.keys(after.pieces).length}`);
check('the table says it was restored',
  after.log.some((l) => /restored/i.test(l.text)), after.log.map((l) => l.text).slice(-3).join(' | '));

// The hand that was dealt belonged to a seat, and seats do not survive: the snapshot
// deliberately keeps no players. The CARDS are still in the hand zone, which is what
// matters — sit down again and they are yours.
const handAfter = Object.values(after.pieces).filter((p) => p.zoneId === 'hand0').length;
check('the cards left in the seat are still in it', handAfter === 7, `${handAfter}`);

console.log('\nForgetting a table removes it from the list');
await page.click('.topbar .icon');
await page.click('.menu button:has-text("Leave table")');
await page.waitForSelector('.lobby', { timeout: 15000 });
await page.waitForTimeout(800);
await page.locator('.recent-row .icon').first().click();
await page.waitForTimeout(300);
check('it is gone from the lobby', (await page.locator('.recent-row').count()) === rows - 1);

await browser.close();
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
