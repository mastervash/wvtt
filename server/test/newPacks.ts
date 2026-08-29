/**
 * The two scripted packs added for the party-games request: Wild Colours and
 * Prompt Party.
 *
 * Run through real rooms and real clients, because the thing most worth checking is
 * not the rules but the hidden information around them: a face-down submission must be
 * unreadable by every player who did not already hold it, and must become readable by
 * everyone the moment the judge reveals it.
 *
 * Run: npx tsx server/test/newPacks.ts
 */

import { createServer } from 'node:http';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client, type Room } from 'colyseus.js';
import { TableRoom } from '../src/rooms/TableRoom.js';

const PORT = 2593;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label: string, cond: boolean, detail = '') {
  if (!cond) failures++;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${!cond && detail ? ` — ${detail}` : ''}`);
}

interface Snap {
  status: string;
  pieces: Record<string, { id: string; zoneId: string; faceUp: boolean; secret?: { face?: string } }>;
  log: { text: string; name: string; kind: string }[];
}
const snap = (room: Room) => room.state.toJSON() as unknown as Snap;
const inZone = (s: Snap, z: string) => Object.values(s.pieces).filter((p) => p.zoneId === z);
const readable = (s: Snap, z: string) => inZone(s, z).filter((p) => p.secret?.face).length;
const logText = (s: Snap, n = 8) => s.log.slice(-n).map((l) => l.text).join(' | ');

/* ------------------------------------------------------------------ *
 * Wild Colours
 * ------------------------------------------------------------------ */

const isWild = (face: string) => face.charAt(0) === 'W';
const colourOf = (face: string) => (isWild(face) ? null : face.charAt(0));
const symbolOf = (face: string) => (isWild(face) ? face : face.substring(1));

function matches(face: string, top: string): boolean {
  return isWild(face) || colourOf(face) === colourOf(top) || symbolOf(face) === symbolOf(top);
}

async function wildColours(port: number) {
  console.log('\n=== Wild Colours ===');
  const ca = new Client(`ws://localhost:${port}`);
  const roomA = await ca.joinOrCreate('table', { name: 'Ana', packId: 'wildcolours' });
  await sleep(400);
  const cb = new Client(`ws://localhost:${port}`);
  const roomB = await cb.joinById(roomA.roomId, { name: 'Ben' });
  await sleep(500);

  const errorsA: string[] = [];
  const errorsB: string[] = [];
  roomA.onMessage('opError', (m: { error: string }) => errorsA.push(m.error));
  roomB.onMessage('opError', (m: { error: string }) => errorsB.push(m.error));

  roomA.send('op', { t: 'sit', seat: 0 });
  roomB.send('op', { t: 'sit', seat: 1 });
  await sleep(400);

  console.log('\nDealing a round');
  roomA.send('op', { t: 'scriptAction', action: 'deal' });
  await sleep(1400);

  const sa = snap(roomA), sb = snap(roomB);
  check('Ana holds seven cards', inZone(sa, 'hand0').length === 7, `${inZone(sa, 'hand0').length}`);
  check('Ben holds seven cards', inZone(sb, 'hand1').length === 7, `${inZone(sb, 'hand1').length}`);
  check('a starting card is on the discard', inZone(sa, 'discard').length === 1);
  check('Ana can read her own hand', readable(sa, 'hand0') === 7);
  check("Ana cannot read Ben's hand", readable(sa, 'hand1') === 0, `leaked ${readable(sa, 'hand1')}`);
  check('the status line names whose turn it is', /to play/.test(sa.status), sa.status);
  // A wild cannot be the starting card: with no colour named every card would be
  // legal, which quietly turns rule enforcement off for the first trick.
  const starter = inZone(sa, 'discard').slice(-1)[0]?.secret?.face ?? '';
  check('the round does not start on a wild', !!starter && !isWild(starter), starter);
  check('the status names a colour', !/any colour/.test(sa.status), sa.status);

  console.log('\nTurn order is enforced');
  errorsB.length = 0;
  roomB.send('op', { t: 'reveal', target: inZone(sb, 'hand1')[0].id });
  await sleep(700);
  check('Ben cannot play out of turn', errorsB.some((e) => /turn/i.test(e)), errorsB.join(' | '));

  console.log('\nMatching is enforced');
  // Deals are random. Look for a hand holding both a playable and an unplayable card,
  // re-dealing rather than skipping the assertions that matter most.
  let top = '';
  let hand: { id: string; secret?: { face?: string } }[] = [];
  for (let attempt = 0; attempt < 12; attempt++) {
    const s = snap(roomA);
    const discard = inZone(s, 'discard');
    top = discard.length ? discard[discard.length - 1].secret?.face ?? '' : '';
    hand = inZone(s, 'hand0');
    const faces = hand.map((c) => c.secret!.face!);
    if (top && faces.some((f) => matches(f, top)) && faces.some((f) => !matches(f, top))) break;
    roomA.send('op', { t: 'scriptAction', action: 'deal' });
    await sleep(1100);
  }

  const legal = hand.find((c) => matches(c.secret!.face!, top));
  const illegal = hand.find((c) => !matches(c.secret!.face!, top));
  check('found a hand with both a legal and an illegal card', !!legal && !!illegal, `top ${top}`);

  if (illegal) {
    errorsA.length = 0;
    roomA.send('op', { t: 'reveal', target: illegal.id });
    await sleep(700);
    check('a card matching neither colour nor symbol is refused', errorsA.some((e) => /Play /i.test(e)), errorsA.join(' | '));
  }

  if (legal) {
    const wasWild = isWild(legal.secret!.face!);
    errorsA.length = 0;
    roomA.send('op', { t: 'reveal', target: legal.id });
    await sleep(900);
    const after = snap(roomA);
    check('a matching card is accepted', inZone(after, 'hand0').length === 6, `${inZone(after, 'hand0').length} left`);

    if (wasWild) {
      check('a wild stops play until a colour is named', /choose a colour/i.test(after.status), after.status);
      errorsB.length = 0;
      roomB.send('op', { t: 'scriptAction', action: 'colour:R' });
      await sleep(600);
      check('only the player who laid the wild may choose', errorsB.some((e) => /can choose/i.test(e)), errorsB.join(' | '));
      roomA.send('op', { t: 'scriptAction', action: 'colour:R' });
      await sleep(700);
      check('naming a colour passes the turn on', /Ben to play/.test(snap(roomA).status), snap(roomA).status);
    } else {
      // Skips, reverses and draw-twos all bounce the turn straight back at a
      // two-player table, exactly as the printed rules say they should.
      const sym = symbolOf(legal.secret!.face!);
      const bouncesBack = sym === 'S' || sym === 'R' || sym === 'D';
      check(
        bouncesBack ? 'a skip, reverse or draw-two comes back to Ana' : 'the turn passes to Ben',
        new RegExp(bouncesBack ? 'Ana to play' : 'Ben to play').test(after.status),
        `${legal.secret!.face} → ${after.status}`,
      );
    }
  }

  console.log('\nReset clears the table');
  {
    // Reset must leave the table CLEARED, not deal a fresh hand. A reset that instantly
    // re-deals looks identical to the hand you just had, and reads as a dead button.
    roomA.send('op', { t: 'scriptAction', action: 'deal' });
    await sleep(1300);
    check('a hand is out before the reset', inZone(snap(roomA), 'hand0').length === 7);

    roomA.send('op', { t: 'resetTable' });
    await sleep(2200);
    const after = snap(roomA);
    check('every hand is empty', inZone(after, 'hand0').length === 0 && inZone(after, 'hand1').length === 0,
      `${inZone(after, 'hand0').length}/${inZone(after, 'hand1').length}`);
    check('nothing is left on the discard', inZone(after, 'discard').length === 0,
      `${inZone(after, 'discard').length}`);
    check('the whole deck is back', inZone(after, 'draw').length === 108, `${inZone(after, 'draw').length}`);
    check('the status says so', /cleared/i.test(after.status), after.status);

    // ...and dealing again still works afterwards.
    roomA.send('op', { t: 'scriptAction', action: 'deal' });
    await sleep(1400);
    check('New round still deals after a reset', inZone(snap(roomA), 'hand0').length === 7,
      `${inZone(snap(roomA), 'hand0').length}`);
  }

  await roomA.leave(true);
  await roomB.leave(true);
}

/* ------------------------------------------------------------------ *
 * Prompt Party
 * ------------------------------------------------------------------ */

async function promptParty(port: number) {
  console.log('\n=== Prompt Party ===');
  const ca = new Client(`ws://localhost:${port}`);
  const roomA = await ca.joinOrCreate('table', { name: 'Ana', packId: 'promptparty' });
  await sleep(400);
  const cb = new Client(`ws://localhost:${port}`);
  const roomB = await cb.joinById(roomA.roomId, { name: 'Ben' });
  const cc = new Client(`ws://localhost:${port}`);
  const roomC = await cc.joinById(roomA.roomId, { name: 'Cal' });
  await sleep(600);

  const errorsB: string[] = [];
  roomB.onMessage('opError', (m: { error: string }) => errorsB.push(m.error));

  roomA.send('op', { t: 'sit', seat: 0 });
  roomB.send('op', { t: 'sit', seat: 1 });
  roomC.send('op', { t: 'sit', seat: 2 });
  await sleep(500);

  console.log('\nStarting a game');
  roomA.send('op', { t: 'scriptAction', action: 'newgame' });
  await sleep(1600);

  let sa = snap(roomA), sb = snap(roomB);
  check('Ana holds seven answers', inZone(sa, 'hand0').length === 7, `${inZone(sa, 'hand0').length}`);
  check('Ben holds seven answers', inZone(sb, 'hand1').length === 7, `${inZone(sb, 'hand1').length}`);
  check('a prompt is on the table', inZone(sa, 'prompt').length === 1);
  check('everyone can read the prompt', readable(sb, 'prompt') === 1);
  check('Ana judges first', /Ana judges/.test(sa.status), sa.status);
  check("Ben cannot read Cal's hand", readable(sb, 'hand2') === 0, `leaked ${readable(sb, 'hand2')}`);

  console.log('\nSubmitting face down');
  const bensCard = inZone(snap(roomB), 'hand1')[0];
  roomB.send('op', { t: 'scriptAction', action: 'submit', payload: { pieceId: bensCard.id } });
  await sleep(900);

  sb = snap(roomB);
  check('the card left his hand', inZone(sb, 'hand1').length === 6, `${inZone(sb, 'hand1').length}`);
  check('it is in the submissions zone', inZone(sb, 'submissions').length === 1);
  // The submitter still "remembers" the card they just played: they were sent its
  // identity while it was in their hand, and revoking a view does not unsee it. That
  // matches a real table. What must never happen is anyone ELSE learning it.
  check('the judge cannot read a submission', readable(snap(roomA), 'submissions') === 0, 'leaked to the judge');
  check('the other player cannot read it', readable(snap(roomC), 'submissions') === 0, 'leaked to a rival');

  console.log('\nThe judge cannot reveal early, and players cannot play cards loose');
  errorsB.length = 0;
  roomB.send('op', { t: 'reveal', target: inZone(snap(roomB), 'hand1')[0].id });
  await sleep(700);
  check('playing a card straight to the table is refused', errorsB.some((e) => /Play this answer/i.test(e)), errorsB.join(' | '));

  console.log('\nRevealing and awarding');
  const calsCard = inZone(snap(roomC), 'hand2')[0];
  roomC.send('op', { t: 'scriptAction', action: 'submit', payload: { pieceId: calsCard.id } });
  await sleep(900);
  roomA.send('op', { t: 'scriptAction', action: 'reveal' });
  await sleep(1000);

  sa = snap(roomA);
  check('both answers are face up in the play area', inZone(sa, 'play').length === 2, `${inZone(sa, 'play').length}`);
  check('everyone can now read them', readable(snap(roomB), 'play') === 2, `${readable(snap(roomB), 'play')}`);

  const winner = inZone(sa, 'play')[0];
  roomA.send('op', { t: 'scriptAction', action: 'award', payload: { pieceId: winner.id } });
  await sleep(1400);

  sa = snap(roomA);
  check('the round is scored', /wins the round/.test(logText(sa)), logText(sa));
  check('the judge moves on', /Ben judges/.test(sa.status), sa.status);
  check('the play area is cleared for the next round', inZone(sa, 'play').length === 0);
  check('a fresh prompt is up', inZone(sa, 'prompt').length === 1);
  check('Ben is back to seven cards', inZone(snap(roomB), 'hand1').length === 7, `${inZone(snap(roomB), 'hand1').length}`);

  await roomA.leave(true);
  await roomB.leave(true);
  await roomC.leave(true);
}

async function main() {
  const httpServer = createServer();
  const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
  gameServer.define('table', TableRoom);
  await gameServer.listen(PORT);

  await wildColours(PORT);
  await promptParty(PORT);

  await gameServer.gracefullyShutdown(false);
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('test crashed:', e); process.exit(1); });
