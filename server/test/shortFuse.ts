/**
 * Short Fuse, played through a real room by real clients.
 *
 * Deals are random, so the test reaches into the room between moves to put a chosen
 * card on top of the pile or into a hand. Everything the players then do goes over the
 * wire exactly as the client sends it, and every assertion about who can read what is
 * made from a client's own copy of the state.
 *
 * Run: npx tsx server/test/shortFuse.ts
 */

import { createServer } from 'node:http';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client, type Room } from 'colyseus.js';
import { TableRoom } from '../src/rooms/TableRoom.js';
import { APPEND_ORDER, detachFromStack, relayoutZone, replaceIds, restackYs } from '../src/engine.js';
import type { TableState } from '../src/state.js';

const PORT = 2596;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label: string, cond: boolean, detail = '') {
  if (!cond) failures++;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${!cond && detail ? ` — ${detail}` : ''}`);
}

interface Snap {
  status: string;
  pieces: Record<string, { id: string; zoneId: string; stackId: string; order: number; secret?: { face?: string } }>;
  stacks: Record<string, { id: string; zoneId: string; pieceIds: string[] }>;
  log: { text: string }[];
}
const snap = (room: Room) => room.state.toJSON() as unknown as Snap;
const inZone = (s: Snap, z: string) =>
  Object.values(s.pieces).filter((p) => p.zoneId === z).sort((a, b) => a.order - b.order);
const readable = (s: Snap, z: string) => inZone(s, z).filter((p) => p.secret?.face).length;
const drawStack = (s: Snap) => Object.values(s.stacks).find((st) => st.zoneId === 'draw')!;
const logText = (s: Snap, n = 6) => s.log.slice(-n).map((l) => l.text).join(' | ');

/* ---------------- rigging the table from the server side ---------------- */

let server: TableRoom;
const state = (): TableState => server.state as TableState;
const refresh = () => (server as unknown as { refreshViews(): void }).refreshViews();

function pieceOfFace(face: string, notIn: string[] = ['hand0', 'hand1']) {
  return [...state().pieces.values()].find((p) => p.secret.face === face && !notIn.includes(p.zoneId));
}

/** Put a card of this face on top of the draw pile. */
function rigTop(face: string) {
  const st = state();
  const stack = [...st.stacks.values()].find((s) => s.zoneId === 'draw')!;
  let id = [...stack.pieceIds].find((pid) => st.pieces.get(pid)!.secret.face === face);
  if (!id) {
    const p = pieceOfFace(face)!;
    detachFromStack(st, p);
    id = p.id;
  }
  const ids = [...stack.pieceIds].filter((pid) => pid !== id);
  ids.push(id);
  st.pieces.get(id)!.stackId = stack.id;
  replaceIds(stack.pieceIds, ids);
  restackYs(st, stack.id);
  refresh();
}

/** Put the top card on the pile that is anything but a bomb. */
function rigSafeTop() {
  const st = state();
  const stack = [...st.stacks.values()].find((s) => s.zoneId === 'draw')!;
  const safe = [...stack.pieceIds].find((pid) => st.pieces.get(pid)!.secret.face !== 'BOMB')!;
  rigTop(st.pieces.get(safe)!.secret.face);
}

/** Hand a seat a card of this face, taken from the pile or the set-aside cards. */
function give(seat: number, face: string) {
  const st = state();
  const p = pieceOfFace(face);
  if (!p) throw new Error(`no spare ${face}`);
  detachFromStack(st, p);
  p.zoneId = `hand${seat}`;
  p.faceUp = true;
  p.order = APPEND_ORDER;
  relayoutZone(st, p.zoneId);
  refresh();
  return p.id;
}

/** Take every card of this face out of a seat's hand. */
function strip(seat: number, face: string) {
  const st = state();
  for (const p of st.pieces.values()) {
    if (p.zoneId === `hand${seat}` && p.secret.face === face) {
      p.zoneId = 'aside';
      p.faceUp = false;
    }
  }
  relayoutZone(st, `hand${seat}`);
  refresh();
}

async function main() {
  const hs = createServer();
  const gs = new Server({ transport: new WebSocketTransport({ server: hs }) });
  gs.define('table', TableRoom);
  await gs.listen(PORT);

  const ca = new Client(`ws://localhost:${PORT}`);
  const ana = await ca.joinOrCreate('table', { name: 'Ana', packId: 'shortfuse' });
  await sleep(400);
  const cb = new Client(`ws://localhost:${PORT}`);
  const ben = await cb.joinById(ana.roomId, { name: 'Ben' });
  await sleep(400);
  server = matchMaker.getLocalRoomById(ana.roomId) as TableRoom;

  const errA: string[] = [];
  const errB: string[] = [];
  ana.onMessage('opError', (m: { error: string }) => errA.push(m.error));
  ben.onMessage('opError', (m: { error: string }) => errB.push(m.error));
  const act = (room: Room, action: string, payload: Record<string, unknown> = {}) =>
    room.send('op', { t: 'scriptAction', action, payload });
  const play = (room: Room, id: string) => room.send('op', { t: 'reveal', target: id });
  const draw = (room: Room, seat: number) =>
    room.send('op', { t: 'draw', stackId: drawStack(snap(room)).id, toZoneId: `hand${seat}`, count: 1 });
  const faceIn = (room: Room, zone: string, face: string) =>
    inZone(snap(room), zone).find((p) => p.secret?.face === face)?.id;

  ana.send('op', { t: 'sit', seat: 0 });
  ben.send('op', { t: 'sit', seat: 1 });
  await sleep(300);

  console.log('\n=== Short Fuse ===\n\nDealing');
  act(ana, 'deal');
  await sleep(700);
  let sa = snap(ana), sb = snap(ben);
  check('Ana holds seven cards and a Defuse', inZone(sa, 'hand0').length === 8 && !!faceIn(ana, 'hand0', 'DEF'),
    inZone(sa, 'hand0').map((p) => p.secret?.face).join(','));
  check('Ben holds seven cards and a Defuse', inZone(sb, 'hand1').length === 8 && !!faceIn(ben, 'hand1', 'DEF'));
  check('nobody was dealt a bomb', !faceIn(ana, 'hand0', 'BOMB') && !faceIn(ben, 'hand1', 'BOMB'));
  const bombs = [...state().pieces.values()].filter((p) => p.secret.face === 'BOMB' && p.zoneId === 'draw').length;
  check('two players means one bomb in the pile', bombs === 1, `${bombs}`);
  check('the pile holds the rest: 32 + a bomb + two spare Defuses', inZone(sa, 'draw').length === 35, `${inZone(sa, 'draw').length}`);
  check('unused bombs and Defuses are set aside', inZone(sa, 'aside').length === 6, `${inZone(sa, 'aside').length}`);
  check("Ana cannot read Ben's hand", readable(sa, 'hand1') === 0);
  check('nobody can read the pile', readable(sa, 'draw') === 0 && readable(sb, 'draw') === 0);
  check('the status says whose turn it is', /Ana to play/.test(sa.status), sa.status);

  console.log('\nTurns');
  draw(ben, 1);
  await sleep(300);
  check('Ben cannot draw out of turn', errB.some((e) => /Ana's turn/.test(e)), errB.join(' | '));
  rigSafeTop();
  draw(ana, 0);
  await sleep(300);
  check('drawing ends Ana’s turn', /Ben to play/.test(snap(ana).status), snap(ana).status);
  check('Ana drew the card', inZone(snap(ana), 'hand0').length === 9);

  console.log('\nNope');
  const skip = give(1, 'SKP');
  give(0, 'NOPE');
  await sleep(200);
  play(ben, skip);
  await sleep(300);
  check('a played card waits for Go', /Nope it/.test(snap(ana).status), snap(ana).status);
  errB.length = 0;
  draw(ben, 1);
  await sleep(300);
  check('Ben cannot draw with a card unsettled', errB.some((e) => /Go/.test(e)), errB.join(' | '));
  play(ana, faceIn(ana, 'hand0', 'NOPE')!);
  await sleep(300);
  check('Ana can Nope out of turn', /NOPE/.test(logText(snap(ana))), logText(snap(ana)));
  act(ben, 'go');
  await sleep(300);
  check('a Noped Skip does nothing', /Ben to play/.test(snap(ana).status), snap(ana).status);

  console.log('\nAttack');
  play(ben, give(1, 'ATK'));
  await sleep(300);
  act(ben, 'go');
  await sleep(300);
  check('an Attack gives Ana two turns', /Ana to play \(2 turns\)/.test(snap(ana).status), snap(ana).status);
  rigSafeTop();
  draw(ana, 0);
  await sleep(300);
  check('after one draw Ana still has a turn', /^Ana to play ·/.test(snap(ana).status), snap(ana).status);

  console.log('\nPeek');
  const topThree = [...drawStack(snap(ana)).pieceIds].slice(-3).reverse();
  play(ana, give(0, 'FUT'));
  await sleep(300);
  act(ana, 'go');
  await sleep(400);
  sa = snap(ana); sb = snap(ben);
  check('the top three cards come out', inZone(sa, 'peek0').length === 3);
  check('Ana can read them', readable(sa, 'peek0') === 3);
  check('Ben cannot', readable(sb, 'peek1') === 0 && readable(sb, 'peek0') === 0);
  act(ana, 'go');
  await sleep(400);
  const back = [...drawStack(snap(ana)).pieceIds].slice(-3).reverse();
  check('they go back in the same order', back.join() === topThree.join(), `${back} vs ${topThree}`);
  // Ana's client remembers what she was shown, as a player would. Ben never saw them.
  check('the peek is gone', inZone(snap(ana), 'peek0').length === 0);
  check('and Ben still cannot read the pile', readable(snap(ben), 'draw') === 0);

  console.log('\nFavour');
  play(ana, give(0, 'FAV'));
  await sleep(300);
  act(ana, 'go');
  await sleep(300);
  const anaBefore = inZone(snap(ana), 'hand0').length;
  const benBefore = inZone(snap(ben), 'hand1').length;
  act(ana, 'pick', { pieceId: inZone(snap(ana), 'hand1')[0].id });
  await sleep(300);
  check('Ben is asked for a card', /Ben: right-click/.test(snap(ana).status), snap(ana).status);
  act(ben, 'give', { pieceId: inZone(snap(ben), 'hand1')[0].id });
  await sleep(300);
  check('the card changes hands', inZone(snap(ana), 'hand0').length === anaBefore + 1
    && inZone(snap(ben), 'hand1').length === benBefore - 1);

  console.log('\nA pair steals');
  strip(0, 'JDUCK');
  const duck = give(0, 'JDUCK');
  errA.length = 0;
  play(ana, duck);
  await sleep(300);
  check('one junk card alone is refused', errA.some((e) => /pair/.test(e)), errA.join(' | '));
  give(0, 'JDUCK');
  play(ana, duck);
  await sleep(300);
  check('both of the pair are played', inZone(snap(ana), 'discard').filter((p) => p.secret?.face === 'JDUCK').length === 2);
  act(ana, 'go');
  await sleep(300);
  const before = inZone(snap(ana), 'hand0').length;
  act(ana, 'pick', { pieceId: inZone(snap(ana), 'hand1')[0].id });
  await sleep(300);
  check('Ana steals a card', inZone(snap(ana), 'hand0').length === before + 1);

  console.log('\nA bomb, defused');
  rigTop('BOMB');
  draw(ana, 0);
  await sleep(300);
  check('drawing the bomb demands a Defuse', /must play a Defuse/.test(snap(ana).status), snap(ana).status);
  errA.length = 0;
  play(ana, inZone(snap(ana), 'hand0').find((p) => p.secret?.face !== 'DEF' && p.secret?.face !== 'BOMB')!.id);
  await sleep(300);
  check('nothing but a Defuse will do', errA.some((e) => /Defuse/.test(e)), errA.join(' | '));
  play(ana, faceIn(ana, 'hand0', 'DEF')!);
  await sleep(300);
  errB.length = 0;
  act(ben, 'tuck:0', { stackId: drawStack(snap(ben)).id });
  await sleep(300);
  check('only Ana may hide the bomb', errB.some((e) => /no bomb/.test(e)), errB.join(' | '));
  act(ana, 'tuck:0', { stackId: drawStack(snap(ana)).id });
  await sleep(400);
  const top = drawStack(snap(ana)).pieceIds.slice(-1)[0];
  check('the bomb is back on top', state().pieces.get(top)?.secret.face === 'BOMB');
  check('and Ben cannot read it there', !snap(ben).pieces[top].secret?.face);
  check('the turn passes', /Ben to play/.test(snap(ana).status), snap(ana).status);

  console.log('\nA bomb, not defused');
  strip(1, 'DEF');
  draw(ben, 1);
  await sleep(400);
  sa = snap(ana);
  check('Ben blows up and Ana wins', /Ana wins/.test(sa.status), `${sa.status} — ${logText(sa)}`);
  check('the bomb is face up on the discard', inZone(sa, 'discard').some((p) => p.secret?.face === 'BOMB'));
  check("Ben's hand is gone", inZone(sa, 'hand1').length === 0);

  console.log('\nReset clears the table');
  ana.send('op', { t: 'resetTable' });
  await sleep(900);
  sa = snap(ana);
  check('every card is back in the pile', inZone(sa, 'draw').length === 57, `${inZone(sa, 'draw').length}`);

  ana.leave(); ben.leave();
  await sleep(200);
  await gs.gracefullyShutdown(false);
  console.log(failures ? `\n${failures} FAILED` : '\nAll Short Fuse checks passed.');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
