/**
 * Regenerate the README screenshots.
 *
 * Each one is a full-window capture at 960x600 on a 2x display, so the images are the
 * 1920-wide ones the README embeds. Run with the dev servers up:
 *
 *   PORT=2588 npm run dev:server
 *   VITE_SERVER_HOST=localhost:2588 npx vite --port 5199 --config client/vite.config.ts client
 *   node docshots.mjs
 */

import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(root, 'docs/images');
const BASE = process.env.BASE ?? 'http://localhost:5199';
const only = process.argv.slice(2);
const want = (name) => only.length === 0 || only.includes(name);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

/** A fresh page at the size the README images are cut to. */
async function page(height = 600) {
  const p = await browser.newPage({ viewport: { width: 960, height }, deviceScaleFactor: 2 });
  p.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 160)));
  return p;
}

/**
 * Pin the graphics quality before the app starts.
 *
 * Left to itself the frame watchdog sees a software renderer, drops to the no-shadow
 * setting and says so in a toast — so every documentation shot came out flat with a
 * message about it across the middle. A stored quality is a deliberate choice, which
 * the watchdog never overrides.
 */
async function pinQuality(p) {
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.evaluate(() => localStorage.setItem('wvtt:settings', JSON.stringify({
    dragButton: 'left',
    uiScale: 1,
    logKinds: ['move', 'cards', 'dice', 'table', 'rules', 'presence'],
    logMineOnly: false,
    hotkeys: true,
    quality: 'high',
  })));
}

async function table(p, packName, playerName = 'Ana') {
  await pinQuality(p);
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.fill('input[placeholder="Guest"]', playerName);
  await p.click(`button:has-text("${packName}")`);
  await p.click('button:has-text("Create table")');
  await p.waitForSelector('.topbar', { timeout: 25000 });
  await wait(6000);
  return (await p.textContent('.topbar .room .code')).trim();
}

/** A second player at an existing table, so a shot can show more than one name. */
async function join(code, name, height = 600) {
  const p = await page(height);
  await pinQuality(p);
  await p.goto(`${BASE}/?room=${code}`, { waitUntil: 'networkidle' });
  await p.fill('input[placeholder="Guest"]', name);
  await p.click('button:has-text("Join")');
  await p.waitForSelector('.topbar', { timeout: 25000 });
  await wait(6000);
  return p;
}

const shots = {
  async table() {
    const p = await page(645);
    const code = await table(p, 'Wild Colours');
    const b = await join(code, 'Ben', 645);
    // The pack deals and starts the game itself; its own buttons are the way in.
    const deal = p.locator('.topbar .game-action').first();
    if (await deal.count()) { await deal.click(); await wait(2500); }
    await wait(2500);
    await p.screenshot({ path: path.join(OUT, 'table.png') });
    await b.close();
    await p.close();
  },

  async menu() {
    const p = await page(600);
    await table(p, 'Card Sandbox');
    // The pile menu, opened on the deck, with the count submenu expanded — the same
    // thing the README's caption describes.
    const box = await p.locator('canvas').boundingBox();
    // Aim at the deck rather than hunting for it: the dev build projects a table
    // position to screen pixels, which is exactly what this needs.
    const at = await p.evaluate(() => {
      const deck = Object.values(window.__wvtt.stacks)[0];
      return window.__wvttProject(deck.x, deck.z);
    });
    await p.mouse.click(box.x + at.x, box.y + at.y, { button: 'right' });
    await p.waitForSelector('.piece-menu', { timeout: 10000 });
    await wait(300);
    const take = p.locator('.piece-menu .pm-item > button', { hasText: 'Take' }).first();
    if (await take.count()) { await take.click(); await wait(350); }
    await p.screenshot({ path: path.join(OUT, 'menu.png') });
    await p.close();
  },

  async log() {
    const p = await page(645);
    const code = await table(p, 'Card Sandbox');
    const b = await join(code, 'Ben', 645);
    await p.click('button:has-text("Shuffle")'); await wait(800);
    await b.click('button:has-text("Deal 2")'); await wait(800);
    await p.click('button:has-text("Deal 1")'); await wait(800);
    await b.click('button:has-text("Shuffle")'); await wait(800);
    await p.click('button:has-text("Log")');
    await wait(1500);
    await p.screenshot({ path: path.join(OUT, 'log.png') });
    await b.close();
    await p.close();
  },

  async dice() {
    const p = await page(600);
    await table(p, 'Dice Tray');
    await wait(2500);
    await p.screenshot({ path: path.join(OUT, 'dice.png') });
    await p.close();
  },

  async editor() {
    const p = await page(672);
    await table(p, 'Card Sandbox');
    await p.click('.topbar .icon');
    await wait(400);
    await p.click('button:has-text("Make your own game")');
    await p.waitForSelector('.editor', { timeout: 25000 });
    await wait(1400);
    await p.screenshot({ path: path.join(OUT, 'editor.png') });
    await p.close();
  },
};

for (const [name, run] of Object.entries(shots)) {
  if (!want(name)) continue;
  process.stdout.write(`${name}… `);
  await run();
  console.log('done');
}

await browser.close();
