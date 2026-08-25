/**
 * Production smoke test.
 *
 * The production build takes a different path from development: the client is served by
 * the game server and talks to it same-origin, rather than reaching across to Vite's
 * port. That path deserves its own test, because a broken same-origin websocket would
 * only show up after deploying.
 *
 * Expects a production server already listening on PORT (default 2580).
 */

import { chromium } from 'playwright';

const PORT = process.env.PORT ?? '2580';
const BASE = `http://localhost:${PORT}`;
let failures = 0;
const check = (l, c, d='') => { if (!c) failures++; console.log(`  [${c?'PASS':'FAIL'}] ${l}${!c&&d?` — ${d}`:''}`); };
const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });

const a = await browser.newPage({ viewport: { width: 1100, height: 800 } });
a.on('pageerror', e => console.log(`  [PAGE ERROR] ${String(e).slice(0,200)}`));
await a.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await a.fill('input[placeholder="Guest"]', 'Ana');
await a.click('button:has-text("Create table")');
await a.waitForSelector('.topbar', { timeout: 20000 });
await a.waitForTimeout(2500);
check('the production build connects same-origin', !!(await a.$('.topbar')));
const code = (await a.textContent('.topbar .room .code'))?.trim();
check('a room code is issued', /^[A-Z0-9]{6}$/.test(code ?? ''), code);

const b = await browser.newPage({ viewport: { width: 1100, height: 800 } });
await b.goto(`${BASE}/?room=${code}`, { waitUntil: 'networkidle' });
await b.fill('input[placeholder="Guest"]', 'Ben');
check('the invite link prefills the code', (await b.inputValue('input[placeholder="CODE"]')) === code);
await b.click('button:has-text("Join")');
await b.waitForSelector('.topbar', { timeout: 20000 });
await b.waitForTimeout(1500);
await b.click('.topbar .icon');
await b.click('.menu .seats button:nth-child(2)');
await b.waitForTimeout(500);
await b.click('.topbar .icon');

await a.click('button:has-text("Deal 2")');
await a.waitForTimeout(2500);
const sa = await a.evaluate(() => {
  // No dev state hook in production; read what the UI shows instead.
  return { tray: document.querySelectorAll('.tray-card').length };
});
const sb = await b.evaluate(() => ({ tray: document.querySelectorAll('.tray-card').length }));
check('Ana has 2 cards in her tray', sa.tray === 2, `${sa.tray}`);
check('Ben has 2 cards in his tray', sb.tray === 2, `${sb.tray}`);
const aAlts = await a.$$eval('.tray-card img', e => e.map(x => x.alt));
const bAlts = await b.$$eval('.tray-card img', e => e.map(x => x.alt));
check('each sees their own distinct cards', aAlts.every(x => !bAlts.includes(x)), `${aAlts} vs ${bAlts}`);
check('no dev state hook is exposed in production', await a.evaluate(() => window.__wvtt === undefined));

console.log(failures === 0 ? '\nPRODUCTION BUILD OK' : `\n${failures} CHECK(S) FAILED`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
