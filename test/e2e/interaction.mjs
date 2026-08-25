/**
 * Chat, the game clock, and pile handling.
 *
 * Covers the interactions added after the first round of play-testing: a quick pull
 * takes one card off a pile while a held pull moves the whole pile, cards laid on each
 * other merge, chat is colour-coded per player, and the clock counts down.
 */

import { chromium } from 'playwright';

const SHOT = process.env.SHOT_DIR ?? new URL('./screenshots/', import.meta.url).pathname;
let failures = 0;
const check = (l, c, d = '') => { if (!c) failures++; console.log(`  [${c ? 'PASS' : 'FAIL'}] ${l}${!c && d ? ` — ${d}` : ''}`); };

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

async function open(packButton, name) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on('pageerror', (e) => console.log(`  [PAGE ERROR] ${String(e).slice(0, 200)}`));
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.fill('input[placeholder="Guest"]', name);
  if (packButton) await page.click(`button:has-text("${packButton}")`);
  await page.click('button:has-text("Create table")');
  await page.waitForSelector('.topbar', { timeout: 20000 });
  await page.waitForTimeout(2500);
  return page;
}

const state = (page) => page.evaluate(() => window.__wvtt);

/** Screen position of a table piece, projected through the live camera. */
async function screenOf(page, pieceId) {
  return page.evaluate((id) => {
    const s = window.__wvtt;
    const p = s.pieces[id];
    if (!p) return null;
    const canvas = document.querySelector('canvas');
    const r = canvas.getBoundingClientRect();
    // The renderer exposes nothing, so approximate with the known camera framing by
    // asking the page for the piece's projected position via the R3F store if present.
    return { x: p.x, z: p.z, rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
  }, pieceId);
}

/* ---------------- piles ---------------- */
console.log('\nPulling from a pile');
{
  const page = await open('Card Sandbox', 'Puller');
  const before = await state(page);
  const deckId = Object.keys(before.stacks)[0];
  const deckSize = before.stacks[deckId].pieceIds.length;
  check('the deck starts whole', deckSize === 52, `${deckSize}`);

  // Find the deck on screen by right-clicking around until its menu appears.
  const box = await page.locator('canvas').boundingBox();
  let spot = null;
  for (const fy of [0.45, 0.40, 0.50, 0.35, 0.55]) {
    for (const fx of [0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65, 0.3, 0.7]) {
      if (spot) continue;
      await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy, { button: 'right' });
      await page.waitForTimeout(180);
      const menu = await page.$('.piece-menu');
      if (menu && (await menu.innerText()).includes('Split in half')) spot = [fx, fy];
      else if (menu) await page.keyboard.press('Escape');
    }
  }
  check('found the deck on screen', !!spot, 'never located it');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  if (spot) {
    const [fx, fy] = spot;
    const from = { x: box.x + box.width * fx, y: box.y + box.height * fy };

    console.log('\nA quick pull takes one card');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 150, from.y + 40, { steps: 12 });   // straight away, no hold
    await page.mouse.up();
    await page.waitForTimeout(1200);

    const s1 = await state(page);
    const deckNow = s1.stacks[deckId]?.pieceIds?.length ?? 0;
    const looseNow = Object.values(s1.pieces).filter((p) => !p.stackId).length;
    check('the pile loses exactly one card', deckNow === 51, `${deckNow}`);
    check('one card is now loose', looseNow === 1, `${looseNow} loose`);

    console.log('\nA held pull moves the whole pile');
    const s2 = await state(page);
    const deckBefore = { ...s2.stacks[deckId] };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.waitForTimeout(1100);                                    // hold first
    await page.mouse.move(from.x - 120, from.y + 60, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(1200);

    const s3 = await state(page);
    const deckAfter = s3.stacks[deckId];
    check('the pile keeps all its cards', deckAfter?.pieceIds?.length === 51, `${deckAfter?.pieceIds?.length}`);
    check('the pile itself has moved', !!deckAfter && Math.abs(deckAfter.x - deckBefore.x) > 0.05,
      `${deckBefore.x?.toFixed(2)} -> ${deckAfter?.x?.toFixed(2)}`);
    check('no menu was left open', !(await page.$('.piece-menu')));
    await page.screenshot({ path: `${SHOT}/10-piles.png` });
  }
  await page.close();
}

/* ---------------- chat ---------------- */
console.log('\nChat');
{
  const a = await open('Card Sandbox', 'Ana');
  const code = (await a.textContent('.topbar .room .code')).trim();
  const b = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await b.goto(`http://localhost:5173/?room=${code}`, { waitUntil: 'networkidle' });
  await b.fill('input[placeholder="Guest"]', 'Ben');
  await b.click('button:has-text("Join")');
  await b.waitForSelector('.topbar', { timeout: 20000 });
  await b.waitForTimeout(1500);

  await a.click('button:has-text("Chat")');
  await b.click('button:has-text("Chat")');
  await a.waitForSelector('.chat', { timeout: 5000 });
  await a.fill('.chat-input input', 'anyone for a game?');
  await a.click('.chat-input button');
  await a.waitForTimeout(1000);

  check("Ana sees her own message", (await a.textContent('.chat-list')).includes('anyone for a game?'));
  check('Ben sees it too', (await b.textContent('.chat-list')).includes('anyone for a game?'));

  await b.fill('.chat-input input', 'deal me in');
  await b.click('.chat-input button');
  await b.waitForTimeout(1000);
  check('replies come back the other way', (await a.textContent('.chat-list')).includes('deal me in'));

  const colours = await a.$$eval('.chat-line .who', (els) => els.map((e) => getComputedStyle(e).color));
  check('each player has their own colour', new Set(colours).size === 2, colours.join(' / '));
  await a.screenshot({ path: `${SHOT}/11-chat.png` });
  await a.close();
  await b.close();
}

/* ---------------- clock ---------------- */
console.log('\nGame clock');
{
  const page = await open('Chess', 'Timer');
  await page.click('.topbar .icon');
  await page.waitForTimeout(300);
  await page.click('.menu button:has-text("5 min")');
  await page.waitForTimeout(800);
  await page.click('.topbar .icon');

  check('the clock appears at the table', !!(await page.$('.clock')));
  const shown = await page.textContent('.clock');
  check('it shows the starting time', /5:00/.test(shown), shown?.replace(/\s+/g, ' '));

  await page.click('.clock button:has-text("Start")');
  await page.waitForTimeout(2200);
  const running = await page.evaluate(() => window.__wvtt.clock);
  check('it is running', running.running === true);
  check("the active player's time is falling", running.times['0'] < 5 * 60_000, `${running.times['0']}`);
  check("the other player's time is untouched", running.times['1'] === 5 * 60_000, `${running.times['1']}`);
  await page.screenshot({ path: `${SHOT}/12-clock.png` });
  await page.close();
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
