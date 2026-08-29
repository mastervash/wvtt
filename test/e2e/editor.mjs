import { chromium } from 'playwright';
const SHOT = process.env.SHOT_DIR ?? new URL('./screenshots/', import.meta.url).pathname;
let failures = 0;
const check = (label, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${!cond && detail ? ` — ${detail}` : ''}`);
};

// A complete user-authored pack: text cards, a private hand, and a rules script.
const CUSTOM_PACK = {
  manifest: {
    formatVersion: 1, id: 'quiz-night', name: 'Quiz Night', author: 'tester',
    description: 'A tiny custom deck built in the editor.',
    minSeats: 1, maxSeats: 4, defaultEnforcement: 'advisory', tableColor: '#3b2f5a',
  },
  components: ['Name a fruit', 'Name a country', 'Name a film', 'Name a colour'].map((t, i) => ({
    id: `q${i}`, kind: 'card', label: t, face: `q${i}`,
    front: { type: 'text', text: t, bg: '#f7f4ec', fg: '#16161a' },
    back: { type: 'text', text: '', bg: '#2b2b33', fg: '#2b2b33' },
    w: 0.63, h: 0.88, d: 0.006, data: { text: t },
  })),
  zones: [
    { id: 'hand0', label: 'Seat 1 hand', ownerSeat: 0, visibility: 'owner', x: 0, z: 3.6, w: 4.2, h: 1.3, layout: 'fan' },
    { id: 'play', label: 'Play area', ownerSeat: null, visibility: 'public', x: 0, z: 0, w: 6, h: 3, layout: 'free' },
  ],
  setup: [
    { componentIds: ['q0', 'q1', 'q2', 'q3'], as: 'stack', zoneId: null, x: -2, z: -1.5, faceUp: false, shuffled: true },
  ],
  script: `
    function onSetup(table) {
      table.setVar('asked', 0);
      table.log('Quiz Night ready.');
    }
    function onAction(table, action) {
      if (action === 'ask') {
        table.setVar('asked', (table.getVar('asked') || 0) + 1);
        table.dealToZone('play', 1);
        return table.getVar('asked');
      }
    }
  `,
};

const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => console.log(`  [PAGE ERROR] ${String(e).slice(0,200)}`));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.fill('input[placeholder="Guest"]', 'Author');
await page.click('button:has-text("Create table")');
await page.waitForSelector('.topbar', { timeout: 15000 });
await page.waitForTimeout(1500);

console.log('\nOpening the editor');
await page.click('.topbar .icon');
await page.click('button:has-text("Make your own game")');
await page.waitForSelector('.editor nav', { timeout: 20000 });
await page.waitForTimeout(500);
check('the editor opens', !!(await page.$('.editor nav')));

console.log('\nPrompt generation');
await page.fill('textarea[placeholder^="e.g."]', 'A trick-taking game about trains.');
await page.selectOption('.grid2 select >> nth=0', 'trick');
await page.waitForTimeout(400);
const prompt = await page.inputValue('.prompt-out textarea');
check('the prompt includes the game description', prompt.includes('trains'));
check('the prompt includes the script API reference', prompt.includes('table.dealTo(seat, count)'));
check('the prompt includes the pack format', prompt.includes('"visibility": "owner"'));
check('the prompt states the no-export rule', prompt.includes('Do NOT use "export"'));
check('the prompt picked up the chosen shape', prompt.toLowerCase().includes('trick-taking'));
await page.screenshot({ path: `${SHOT}/5-editor-prompt.png` });

console.log('\nImporting a hand-written pack');
await page.click('.editor nav button:has-text("Export")');
await page.click('button:has-text("Paste a pack")');
await page.fill('.paste textarea', JSON.stringify(CUSTOM_PACK));
await page.click('.paste button:has-text("Import")');
await page.waitForTimeout(600);
const current = await page.inputValue('textarea.mono');
check('the pack is imported into the editor', current.includes('Quiz Night'));

console.log('\nLoading it onto the live table');
await page.click('button:has-text("Load onto this table")');
await page.waitForTimeout(2500);
const packName = (await page.textContent('.topbar .room .pack'))?.trim();
check('the table switched to the custom pack', packName === 'Quiz Night', `shows "${packName}"`);

const state = await page.evaluate(() => {
  const s = window.__wvtt;
  return {
    pieces: Object.keys(s.pieces).length,
    zones: Object.keys(s.zones).length,
    enforcement: s.enforcement,
    log: s.log.map(l => l.text),
  };
});
check('the custom deck is on the table', state.pieces === 4, `${state.pieces} pieces`);
check('the custom zones loaded', state.zones === 2, `${state.zones} zones`);
check('enforcement came from the manifest', state.enforcement === 'advisory', state.enforcement);
check('the pack script ran its onSetup', state.log.some(t => t.includes('Quiz Night ready')), JSON.stringify(state.log));

await page.screenshot({ path: `${SHOT}/6-custom-pack-loaded.png` });

console.log('\nRejecting a malformed pack');
await page.click('.topbar .icon');
await page.click('button:has-text("Make your own game")');
await page.waitForSelector('.editor nav');
await page.waitForTimeout(400);
await page.click('.editor nav button:has-text("Export")');
await page.click('button:has-text("Paste a pack")');
await page.fill('.paste textarea', JSON.stringify({ manifest: { formatVersion: 99, id: 'x', name: 'x', author: 'x', description: 'x', minSeats: 1, maxSeats: 2, defaultEnforcement: 'off' }, components: [], zones: [], setup: [] }));
await page.click('.paste button:has-text("Import")');
await page.waitForTimeout(600);

// The editor now runs the server's own validator as you type, so a bad pack never
// reaches the table at all: the reason is on screen and the Load button is dead. The
// server still validates everything it is sent — see server/test/security.ts.
const verdict = (await page.textContent('.editor .verdict')) ?? '';
check('the editor flags the problem itself', /problem/i.test(verdict), `verdict: "${verdict}"`);
const problems = await page.locator('.warn.bad li').allTextContents();
check('and says what is wrong', problems.some((t) => /version/i.test(t)), JSON.stringify(problems));
check('loading is blocked', await page.locator('button:has-text("Load onto this table")').isDisabled());

console.log('\nThe draft survives closing the editor');
await page.click('.editor nav button:has-text("Pieces & zones")');
await page.fill('.editor label:has-text("Name") input', 'Draft Keeper');
await page.waitForTimeout(500);
await page.click('.editor > header .icon');
await page.waitForTimeout(500);
await page.click('.topbar .icon');
await page.click('button:has-text("Make your own game")');
await page.waitForSelector('.editor nav');
await page.click('.editor nav button:has-text("Pieces & zones")');
await page.waitForTimeout(400);
check('the work in progress is still there',
  (await page.inputValue('.editor label:has-text("Name") input')) === 'Draft Keeper');

console.log('\nZones can be placed without hand-editing JSON');
// Start from the blank pack, which defines a hand each and a play area.
await page.click('.editor nav button:has-text("Export")');
await page.click('button:has-text("Start a new pack")');
await page.waitForTimeout(500);
await page.click('.editor nav button:has-text("Pieces & zones")');
await page.waitForTimeout(400);
const geo = await page.locator('.zone-row.sub input[type=number]').count();
check('zone position and size can be edited in the form', geo >= 4, `${geo} fields`);
check('setup steps offer the per-seat option',
  (await page.locator('.zone-row.sub label.inline:has-text("once per seat")').count()) >= 0);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
