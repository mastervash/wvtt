import { chromium } from 'playwright';

const SHOT = process.env.SHOT_DIR ?? new URL('./screenshots/', import.meta.url).pathname;
const log = (...a) => console.log(...a);

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

async function newPage(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') log(`  [${name} console error] ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => log(`  [${name} PAGE ERROR] ${String(e).slice(0, 300)}`));
  return page;
}

// ---- Player A creates a table ----
const a = await newPage('A');
await a.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await a.fill('input[placeholder="Guest"]', 'Ana');
await a.click('button:has-text("Create table")');
await a.waitForSelector('.topbar', { timeout: 15000 });
await a.waitForTimeout(2500);

const code = (await a.textContent('.topbar .room .code'))?.trim();
log('room code:', code);
await a.screenshot({ path: `${SHOT}/1-table-created.png` });

// ---- Player B joins by code ----
const b = await newPage('B');
await b.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await b.fill('input[placeholder="Guest"]', 'Ben');
await b.fill('input[placeholder="CODE"]', code);
await b.click('button:has-text("Join")');
await b.waitForSelector('.topbar', { timeout: 15000 });
await b.waitForTimeout(2000);
log('B joined; players visible to A:', await a.$$eval('.topbar .players .chip', els => els.map(e => e.textContent)));

// ---- Ben takes seat 2 so they are in different seats ----
await b.click('.topbar .icon');
await b.waitForTimeout(300);
await b.click('.menu .seats button:nth-child(2)');
await b.waitForTimeout(500);
await b.click('.topbar .icon');

// ---- Deal two cards to everyone ----
await a.click('button:has-text("Deal 2")');
await a.waitForTimeout(2000);

await a.screenshot({ path: `${SHOT}/2-ana-dealt.png` });
await b.screenshot({ path: `${SHOT}/3-ben-dealt.png` });

// ---- What can each actually read? ----
async function trayFaces(page, name) {
  const imgs = await page.$$eval('.tray-card img', els => els.map(e => e.getAttribute('alt')));
  log(`  ${name} tray: ${imgs.length} cards -> ${JSON.stringify(imgs)}`);
  return imgs;
}
const aFaces = await trayFaces(a, 'Ana');
const bFaces = await trayFaces(b, 'Ben');

const identifiable = (arr) => arr.filter(x => x && x !== 'card').length;
log('\nRESULT');
log('  Ana can identify', identifiable(aFaces), 'of her own cards');
log('  Ben can identify', identifiable(bFaces), 'of his own cards');
const overlap = aFaces.filter(f => bFaces.includes(f) && f !== 'card');
log('  overlap between the two hands:', overlap.length);

// Does the raw client state leak the other hand?
const leak = await a.evaluate(() => {
  // Reach into the store to inspect every piece the client actually holds.
  const pieces = window.__wvtt?.pieces ?? {};
  return Object.values(pieces).filter(p => p.zoneId === 'hand1' && p.secret?.face).length;
});
log('  cards in Ben\'s hand that Ana\'s client can read:', leak);

await a.screenshot({ path: `${SHOT}/4-final-ana.png`, fullPage: false });
await browser.close();
