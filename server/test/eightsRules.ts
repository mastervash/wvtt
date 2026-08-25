/**
 * Crazy Eights rule enforcement, end to end through a real room.
 *
 * Uses real clients so this also covers the hidden-information path: a player must not
 * be able to see what anyone else is holding, even while rules are being enforced.
 *
 * Run: npx tsx server/test/eightsRules.ts
 */

import { createServer } from 'node:http';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client, type Room } from 'colyseus.js';
import { TableRoom } from '../src/rooms/TableRoom.js';

const PORT = 2591;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label: string, cond: boolean, detail = '') {
  if (!cond) failures++;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${!cond && detail ? ` — ${detail}` : ''}`);
}

interface Snap {
  pieces: Record<string, { id: string; zoneId: string; faceUp: boolean; secret?: { face?: string } }>;
  log: { text: string }[];
}
const snap = (room: Room) => room.state.toJSON() as unknown as Snap;
const inZone = (s: Snap, z: string) => Object.values(s.pieces).filter((p) => p.zoneId === z);
const readable = (s: Snap, z: string) => inZone(s, z).filter((p) => p.secret?.face).length;
const lastLog = (s: Snap, n = 6) => s.log.slice(-n).map((l) => l.text);

async function main() {
  const httpServer = createServer();
  const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
  gameServer.define('table', TableRoom);
  await gameServer.listen(PORT);

  const ca = new Client(`ws://localhost:${PORT}`);
  const roomA = await ca.joinOrCreate('table', { name: 'Ana', packId: 'eights' });
  await sleep(400);
  const cb = new Client(`ws://localhost:${PORT}`);
  const roomB = await cb.joinById(roomA.roomId, { name: 'Ben' });
  await sleep(500);

  const errorsA: string[] = [];
  const errorsB: string[] = [];
  roomA.onMessage('opError', (m: { error: string }) => errorsA.push(m.error));
  roomB.onMessage('opError', (m: { error: string }) => errorsB.push(m.error));

  roomA.send('op', { t: 'sit', seat: 0 });
  roomB.send('op', { t: 'sit', seat: 1 });
  await sleep(400);

  console.log('\nDealing a hand');
  roomA.send('op', { t: 'scriptAction', action: 'deal' });
  await sleep(1200);

  const sa = snap(roomA), sb = snap(roomB);
  check('Ana holds five cards', inZone(sa, 'hand0').length === 5, `${inZone(sa, 'hand0').length}`);
  check('Ben holds five cards', inZone(sb, 'hand1').length === 5, `${inZone(sb, 'hand1').length}`);
  check('a starting card is face up on the discard', inZone(sa, 'discard').length === 1);
  check('Ana can read her own hand', readable(sa, 'hand0') === 5, `${readable(sa, 'hand0')}`);
  check("Ana cannot read Ben's hand", readable(sa, 'hand1') === 0, `leaked ${readable(sa, 'hand1')}`);
  check("Ben cannot read Ana's hand", readable(sb, 'hand0') === 0, `leaked ${readable(sb, 'hand0')}`);
  check('both players can read the discard', readable(sa, 'discard') === 1 && readable(sb, 'discard') === 1);
  check('the log announces whose turn it is', lastLog(sa).some((t) => /to play/.test(t)), lastLog(sa).join(' | '));

  console.log('\nTurn order is enforced');
  errorsB.length = 0;
  const bensCard = inZone(sb, 'hand1')[0];
  roomB.send('op', { t: 'reveal', target: bensCard.id });
  await sleep(700);
  check('Ben cannot play out of turn', errorsB.some((e) => /turn/i.test(e)), errorsB.join(' | '));
  check("Ben's card stayed in his hand", inZone(snap(roomB), 'hand1').length === 5);

  console.log('\nPlaying a legal card');
  // Deals are random, so a hand can legitimately contain no playable card. Re-deal
  // until one does, rather than silently skipping the most important assertions here.
  const playable = (face: string, top: string) => face[0] === '8' || face[0] === top[0] || face[1] === top[1];
  let top = '';
  let hand: { id: string; secret?: { face?: string } }[] = [];
  for (let attempt = 0; attempt < 12; attempt++) {
    const s = snap(roomA);
    top = inZone(s, 'discard')[0].secret!.face!;
    hand = inZone(s, 'hand0');
    if (hand.some((c) => playable(c.secret!.face!, top))) break;
    roomA.send('op', { t: 'scriptAction', action: 'deal' });
    await sleep(900);
  }
  const legal = hand.find((c) => playable(c.secret!.face!, top));
  const illegal = hand.find((c) => !playable(c.secret!.face!, top));
  check('the deal produced a playable hand to test with', !!legal, 'no legal card after 12 deals');

  if (illegal) {
    errorsA.length = 0;
    roomA.send('op', { t: 'reveal', target: illegal.id });
    await sleep(700);
    check('a card matching neither suit nor rank is refused', errorsA.some((e) => /must play/i.test(e)), errorsA.join(' | '));
  } else {
    console.log('  (no unplayable card in hand this deal; that branch is not exercised)');
  }

  if (legal) {
    const before = inZone(snap(roomA), 'discard').length;
    roomA.send('op', { t: 'reveal', target: legal.id });
    await sleep(900);
    const after = snap(roomA);
    check('a legal card is accepted', inZone(after, 'hand0').length === 4, `${inZone(after, 'hand0').length} left in hand`);
    check('the played card lands on the discard pile', inZone(after, 'discard').length === before + 1);
    check('the turn passes to Ben', lastLog(after).some((t) => /Ben to play/.test(t)), lastLog(after).join(' | '));
    check('everyone can see the played card', readable(snap(roomB), 'discard') === before + 1);
  } else {
    check('a legal card was available to play', false, 'none found');
  }

  console.log('\nRules can be switched off');
  roomA.send('op', { t: 'setEnforcement', mode: 'off' });
  await sleep(600);
  errorsB.length = 0;
  const anyCard = inZone(snap(roomB), 'hand1')[0];
  roomB.send('op', { t: 'reveal', target: anyCard.id });
  await sleep(700);
  check('with rules off, an out-of-turn play is allowed', errorsB.length === 0, errorsB.join(' | '));

  await roomA.leave(true);
  await roomB.leave(true);
  await gameServer.gracefullyShutdown(false);
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('test crashed:', e); process.exit(1); });
