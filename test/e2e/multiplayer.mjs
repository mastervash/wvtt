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

/* ------------------------------------------------------------------ *
 * A card that was public, then goes into a hand
 *
 * Colyseus stops SENDING a secret when it leaves a client's view, but the value it
 * already sent stays in that client's state — so an onlooker keeps the identity of a
 * card that has since been picked up. The client must therefore decide what it may
 * DRAW from the current table, not from what it happens to remember. Without this,
 * cards appeared to lie face up in other players' hand squares.
 * ------------------------------------------------------------------ */
let failures = 0;
const check = (l, c, d = '') => { if (!c) failures++; log(`  [${c ? 'PASS' : 'FAIL'}] ${l}${!c && d ? ` — ${d}` : ''}`); };

log('\nA public card taken into a hand');
{
  const box = await a.locator('canvas').boundingBox();
  const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];

  async function menuAt(page, wantText) {
    for (const fy of [0.45, 0.40, 0.50, 0.55, 0.35]) {
      for (const fx of [0.5, 0.45, 0.55, 0.40, 0.60, 0.35, 0.65, 0.3, 0.7, 0.75]) {
        await page.mouse.click(...at(fx, fy), { button: 'right' });
        await page.waitForTimeout(230);
        const m = await page.$('.piece-menu');
        if (m && (await m.innerText()).includes(wantText)) return [fx, fy];
        if (m) await page.keyboard.press('Escape');
      }
    }
    return null;
  }

  const deck = await menuAt(a, 'Split in half');
  check('found the deck', !!deck);
  if (deck) {
    await a.click('.piece-menu button:has-text("Take cards off the top")');
    await a.click('.pm-counts button:has-text("1")');
    await a.waitForTimeout(900);

    // Aim straight at the card rather than hunting for it: the scene can tell us where
    // a table position lands on screen.
    const card = await a.evaluate(() => {
      const loose = Object.values(window.__wvtt.pieces)
        .filter((p) => !p.stackId && !String(p.zoneId ?? '').startsWith('hand'));
      const it = loose[0];
      return it ? { id: it.id, ...window.__wvttProject(it.x, it.z) } : null;
    });
    check('found the card Ana pulled off', !!card);
    const cardId = card?.id;

    if (card) {
      await a.mouse.click(card.x, card.y, { button: 'right' });
      await a.waitForTimeout(300);
      const opened = await a.$('.piece-menu');
      check('its menu opens', !!opened && (await opened.innerText()).includes('Turn face up'));
      await a.click('.piece-menu button:has-text("Turn face up")');
      await a.waitForTimeout(900);
      const benReadsPublic = await b.evaluate((id) => window.__wvttCanRead(id), cardId);
      check('while it is face up on the table, Ben may read it', benReadsPublic === true);

      await a.mouse.click(card.x, card.y, { button: 'right' });
      await a.waitForTimeout(300);
      await a.click('.piece-menu button:has-text("Take into my hand")');
      await a.waitForTimeout(1400);

      const after = await b.evaluate((id) => ({
        zone: window.__wvtt.pieces[id]?.zoneId,
        stillHoldsSecret: !!window.__wvtt.pieces[id]?.secret?.face,
        mayRead: window.__wvttCanRead(id),
      }), cardId);
      check('the card is in Ana\'s hand', after.zone === 'hand0', after.zone);
      check("Ben's client still remembers the identity", after.stillHoldsSecret === true,
        'nothing to guard against, so this test proves nothing');
      check('but Ben may no longer draw it face up', after.mayRead === false);

      const anaReads = await a.evaluate((id) => window.__wvttCanRead(id), cardId);
      check('Ana can still read her own card', anaReads === true);
    }
  }
}

await browser.close();
log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
