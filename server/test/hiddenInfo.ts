/**
 * Integration test for hidden information.
 *
 * This is the test that protects the product's core promise. It stands up a real
 * server, connects two real clients, deals real cards, and inspects what actually
 * arrived over the wire — not what the server intended to send.
 *
 * Run: npx tsx server/test/hiddenInfo.ts
 */

import { createServer } from 'node:http';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client } from 'colyseus.js';
import { TableRoom } from '../src/rooms/TableRoom.js';

const PORT = 2599;

let failures = 0;
function check(label: string, cond: boolean, detail = '') {
  const mark = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`  [${mark}] ${label}${detail && !cond ? ` — ${detail}` : ''}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Count how many pieces in a zone this client can actually read the identity of. */
function readable(room: any, zoneId: string): { total: number; known: number; faces: string[] } {
  const json = room.state.toJSON();
  const faces: string[] = [];
  let total = 0;
  for (const p of Object.values<any>(json.pieces ?? {})) {
    if (p.zoneId !== zoneId) continue;
    total++;
    const face = p.secret?.face;
    if (typeof face === 'string' && face.length > 0) faces.push(face);
  }
  return { total, known: faces.length, faces };
}

async function main() {
  const httpServer = createServer();
  const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
  gameServer.define('table', TableRoom);
  await gameServer.listen(PORT);

  const ca = new Client(`ws://localhost:${PORT}`);
  const roomA = await ca.joinOrCreate('table', { name: 'Ana' });
  await sleep(300);

  const cb = new Client(`ws://localhost:${PORT}`);
  const roomB = await cb.joinById(roomA.roomId, { name: 'Ben' });
  await sleep(400);

  console.log('\nSetup');
  check('both clients in the same room', roomA.roomId === roomB.roomId);
  roomA.send('op', { t: 'sit', seat: 0 });
  roomB.send('op', { t: 'sit', seat: 1 });
  await sleep(300);

  const stateA = roomA.state.toJSON();
  const deckId = Object.keys(stateA.stacks ?? {})[0];
  const deckSize = stateA.stacks[deckId].pieceIds.length;
  check('deck built with 52 cards', deckSize === 52, `got ${deckSize}`);

  console.log('\nFace-down deck');
  {
    const a = readable(roomA, '');
    check('Ana cannot read any card in the face-down deck', a.known === 0, `leaked ${a.faces.join(',')}`);
  }

  console.log('\nDealing two cards to each hand');
  roomA.send('op', { t: 'deal', stackId: deckId, count: 2, toZoneIds: ['hand0', 'hand1'] });
  await sleep(600);

  const aOwn = readable(roomA, 'hand0');
  const aOther = readable(roomA, 'hand1');
  const bOwn = readable(roomB, 'hand1');
  const bOther = readable(roomB, 'hand0');

  check('Ana sees 2 cards in her own hand', aOwn.total === 2 && aOwn.known === 2, `total=${aOwn.total} known=${aOwn.known}`);
  check("Ana sees Ben's 2 cards exist but cannot read them", aOther.total === 2 && aOther.known === 0, `leaked ${aOther.faces.join(',')}`);
  check('Ben sees 2 cards in his own hand', bOwn.total === 2 && bOwn.known === 2, `total=${bOwn.total} known=${bOwn.known}`);
  check("Ben sees Ana's 2 cards exist but cannot read them", bOther.total === 2 && bOther.known === 0, `leaked ${bOther.faces.join(',')}`);
  check('the two hands hold different cards', aOwn.faces.join() !== bOwn.faces.join());

  console.log('\nRevealing one of Ana\'s cards');
  const anaCardId = Object.entries<any>(roomA.state.toJSON().pieces).find(([, p]) => p.zoneId === 'hand0')?.[0];
  roomA.send('op', { t: 'reveal', target: anaCardId });
  await sleep(500);
  {
    const revealed = Object.values<any>(roomB.state.toJSON().pieces).find((p) => p.id === anaCardId);
    check('Ben can now read the card Ana revealed', !!revealed?.secret?.face, 'still hidden');
    const stillHidden = readable(roomB, 'hand0');
    check("Ben still cannot read Ana's remaining hand", stillHidden.known === 0, `leaked ${stillHidden.faces.join(',')}`);
  }

  console.log('\nBen tries to peek at a card in Ana\'s hand');
  const anaRemaining = Object.entries<any>(roomA.state.toJSON().pieces).find(([, p]) => p.zoneId === 'hand0')?.[0];
  let refused = false;
  roomB.onMessage('opError', (m: any) => { if (m.op === 'peek') refused = true; });
  roomB.send('op', { t: 'peek', target: anaRemaining });
  await sleep(500);
  check('the server refuses the peek', refused);
  {
    const after = readable(roomB, 'hand0');
    check("Ana's hand is still unreadable to Ben after the attempt", after.known === 0, `leaked ${after.faces.join(',')}`);
  }

  console.log('\nAna stands up, then a new card is dealt to the seat she left');
  // Note: Ana's client still remembers the cards it was legitimately shown while she
  // was seated. That is not a leak — you cannot un-send information, and a real player
  // who looks at their hand and walks away still knows what they saw. The property
  // that matters is that she receives nothing NEW that she is no longer entitled to.
  const beforeStanding = new Set(readable(roomA, 'hand0').faces);
  roomA.send('op', { t: 'stand' });
  await sleep(400);
  roomB.send('op', { t: 'deal', stackId: deckId, count: 1, toZoneIds: ['hand0'] });
  await sleep(600);
  {
    const a = readable(roomA, 'hand0');
    const newlyReadable = a.faces.filter((f) => !beforeStanding.has(f));
    check('Ana sees a card arrive in the seat she vacated', a.total > beforeStanding.size,
      `total=${a.total}`);
    check('but she cannot read the card dealt after she stood up',
      newlyReadable.length === 0, `leaked ${newlyReadable.join(',')}`);
  }

  await roomA.leave(true);
  await roomB.leave(true);
  await gameServer.gracefullyShutdown(false);

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('test crashed:', e); process.exit(1); });
