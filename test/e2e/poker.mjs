import { chromium } from 'playwright';
const SHOT = process.env.SHOT_DIR ?? new URL('./screenshots/', import.meta.url).pathname;
let failures = 0;
const check = (l, c, d = '') => { if (!c) failures++; console.log(`  [${c ? 'PASS' : 'FAIL'}] ${l}${!c && d ? ` — ${d}` : ''}`); };
const readable = (s, zone) => Object.values(s.pieces).filter(p => p.zoneId === zone && p.secret?.face).length;
const total = (s, zone) => Object.values(s.pieces).filter(p => p.zoneId === zone).length;

const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
async function mk(name) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  p.on('pageerror', e => console.log(`  [${name} PAGE ERROR] ${String(e).slice(0,200)}`));
  return p;
}

const a = await mk('A');
await a.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await a.fill('input[placeholder="Guest"]', 'Ana');
await a.click('button:has-text("Texas Hold\'em")');
await a.click('button:has-text("Create table")');
await a.waitForSelector('.topbar', { timeout: 15000 });
await a.waitForTimeout(1500);
const code = (await a.textContent('.topbar .room .code'))?.trim();

const b = await mk('B');
await b.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await b.fill('input[placeholder="Guest"]', 'Ben');
await b.fill('input[placeholder="CODE"]', code);
await b.click('button:has-text("Join")');
await b.waitForSelector('.topbar', { timeout: 15000 });
await b.waitForTimeout(1200);

// Seat them apart.
await b.click('.topbar .icon');
await b.click('.menu .seats button:nth-child(2)');
await b.waitForTimeout(400);
await b.click('.topbar .icon');

console.log('\nPack and actions');
check('the poker pack loaded', (await a.textContent('.topbar .room .pack'))?.trim() === "Texas Hold'em");
const actionButtons = await a.$$eval('.game-action', els => els.map(e => e.textContent));
check('the pack\'s declared actions became buttons', actionButtons.join(',') === 'Deal hand,Flop,Turn,River', actionButtons.join(','));

console.log('\nDealing a hand via the pack script');
await a.click('button:has-text("Deal hand")');
await a.waitForTimeout(2500);

const sa = await a.evaluate(() => window.__wvtt);
const sb = await b.evaluate(() => window.__wvtt);
check('Ana holds 2 hole cards', total(sa, 'hand0') === 2, `${total(sa,'hand0')}`);
check('Ana can read both of her own', readable(sa, 'hand0') === 2, `${readable(sa,'hand0')}`);
check('Ben holds 2 hole cards', total(sb, 'hand1') === 2, `${total(sb,'hand1')}`);
check('Ana cannot read any of Ben\'s hole cards', readable(sa, 'hand1') === 0, `leaked ${readable(sa,'hand1')}`);
check('Ben cannot read any of Ana\'s hole cards', readable(sb, 'hand0') === 0, `leaked ${readable(sb,'hand0')}`);

console.log('\nThe flop is public');
await a.click('button:has-text("Flop")');
await a.waitForTimeout(2000);
const sa2 = await a.evaluate(() => window.__wvtt);
const sb2 = await b.evaluate(() => window.__wvtt);
check('three community cards are dealt', total(sa2, 'board') === 3, `${total(sa2,'board')}`);
check('Ana can read all three', readable(sa2, 'board') === 3, `${readable(sa2,'board')}`);
check('Ben can read the same three', readable(sb2, 'board') === 3, `${readable(sb2,'board')}`);
check('hole cards are still private after the flop', readable(sa2, 'hand1') === 0 && readable(sb2, 'hand0') === 0);
const boardFaceUp = Object.values(sa2.pieces).filter(p => p.zoneId === 'board' && p.faceUp).length;
check('community cards are rendered face up', boardFaceUp === 3, `${boardFaceUp} of 3 face up`);
const deckKinds = new Set(Object.values(sa2.pieces).filter(p => p.stackId && p.stackId === Object.values(sa2.stacks).sort((x,y)=>(y.pieceIds?.length??0)-(x.pieceIds?.length??0))[0]?.id).map(p => p.kind));
check('the deck contains only cards after a deal', [...deckKinds].join(',') === 'card', `kinds: ${[...deckKinds].join(',')}`);
const bankZones = Object.values(sa2.zones).filter(z => z.id.startsWith('bank'));
const distinctBankSpots = new Set(bankZones.map(z => `${z.x},${z.z}`)).size;
check('each seat has its own chip area', distinctBankSpots === bankZones.length, `${distinctBankSpots} distinct of ${bankZones.length}`);
const bank0 = Object.values(sa2.pieces).filter(p => p.zoneId === 'bank0').length;
const bank1 = Object.values(sa2.pieces).filter(p => p.zoneId === 'bank1').length;
check('the player who sat down later also got chips', bank0 > 0 && bank1 > 0, `bank0=${bank0} bank1=${bank1}`);
check('Ana has seat 0 and is not spectating', sa2.players[Object.keys(sa2.players).find(k => sa2.players[k].name === 'Ana')]?.seat === 0);

console.log('\nTurn and river');
await a.click('button:has-text("Turn")');
await a.waitForTimeout(1200);
await a.click('button:has-text("River")');
await a.waitForTimeout(1800);
const sa3 = await a.evaluate(() => window.__wvtt);
check('the board reaches five cards', total(sa3, 'board') === 5, `${total(sa3,'board')}`);
check('burnt cards went to the muck', total(sa3, 'muck') === 3, `${total(sa3,'muck')}`);
check('nobody can read the muck', readable(sa3, 'muck') === 0 && readable(sb2, 'muck') === 0);

console.log('\nSwitching rules off disables game actions');
await a.click('.topbar .icon');
await a.click('.menu .seg button:has-text("off")');
await a.waitForTimeout(800);
await a.click('.topbar .icon');
const disabled = await a.$eval('.game-action', el => el.disabled);
check('the action buttons are disabled with rules off', disabled === true);

await a.screenshot({ path: `${SHOT}/7-poker-ana.png` });
await b.screenshot({ path: `${SHOT}/8-poker-ben.png` });
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
