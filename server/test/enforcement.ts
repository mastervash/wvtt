/**
 * Refused moves must actually be refused.
 *
 * Dragging streams `move` ops so other players can watch a piece travel, so by the time
 * a `drop` is judged the piece has already been relocated. The rules script vetoing the
 * drop is not enough on its own — the piece has to go back, or a refused move stays on
 * the board and enforcement is worthless.
 *
 * Run: npx tsx server/test/enforcement.ts
 */

import { createServer } from 'node:http';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client, type Room } from 'colyseus.js';
import { TableRoom } from '../src/rooms/TableRoom.js';

const PORT = 2585;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label: string, cond: boolean, detail = '') {
  if (!cond) failures++;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${!cond && detail ? ` — ${detail}` : ''}`);
}

interface P { id: string; defId: string; x: number; z: number }
const pieces = (room: Room) => Object.values((room.state.toJSON() as any).pieces) as P[];
const byId = (room: Room, id: string) => pieces(room).find((p) => p.id === id)!;
const near = (a: number, b: number) => Math.abs(a - b) < 0.02;

/** Drag exactly the way the client does: grab, stream moves, then drop. */
async function drag(room: Room, id: string, toX: number, toZ: number) {
  const from = byId(room, id);
  room.send('op', { t: 'grab', target: id });
  for (let i = 1; i <= 4; i++) {
    room.send('op', {
      t: 'move', target: id,
      x: from.x + ((toX - from.x) * i) / 4,
      z: from.z + ((toZ - from.z) * i) / 4,
    });
    await sleep(50);
  }
  room.send('op', { t: 'drop', target: id, zoneId: null, x: toX, z: toZ });
  await sleep(700);
}

async function main() {
  const hs = createServer();
  const gs = new Server({ transport: new WebSocketTransport({ server: hs }) });
  gs.define('table', TableRoom);
  await gs.listen(PORT);

  const ca = new Client(`ws://localhost:${PORT}`);
  const white = await ca.joinOrCreate('table', { name: 'White', packId: 'chess' });
  await sleep(900);
  const cb = new Client(`ws://localhost:${PORT}`);
  const black = await cb.joinById(white.roomId, { name: 'Black' });
  await sleep(600);

  white.send('op', { t: 'sit', seat: 0 });
  black.send('op', { t: 'sit', seat: 1 });
  await sleep(500);

  const errsW: string[] = [];
  white.onMessage('opError', (m: any) => errsW.push(m.error));
  const errsB: string[] = [];
  black.onMessage('opError', (m: any) => errsB.push(m.error));

  const CELL = 0.5, LEFT = -2.0;
  const centre = (c: number, r: number) => ({ x: LEFT + c * CELL + CELL / 2, z: LEFT + r * CELL + CELL / 2 });
  const at = (room: Room, c: number, r: number) => {
    const want = centre(c, r);
    return pieces(room).find((p) => near(p.x, want.x) && near(p.z, want.z));
  };

  console.log('\nMoving a piece that is not yours');
  {
    const blackPawn = at(white, 4, 1)!;
    const origin = { x: blackPawn.x, z: blackPawn.z };
    errsW.length = 0;
    await drag(white, blackPawn.id, centre(4, 3).x, centre(4, 3).z);
    const now = byId(white, blackPawn.id);
    check('the server refuses it', errsW.some((e) => /not your piece/i.test(e)), errsW.join(' | '));
    check('the piece goes back where it started', near(now.x, origin.x) && near(now.z, origin.z),
      `ended at ${now.x.toFixed(2)},${now.z.toFixed(2)} not ${origin.x.toFixed(2)},${origin.z.toFixed(2)}`);
  }

  console.log('\nMoving twice in a row');
  {
    const pawn = at(white, 4, 6)!;
    await drag(white, pawn.id, centre(4, 4).x, centre(4, 4).z);
    check('the first move is allowed', !!at(white, 4, 4), 'pawn did not advance');

    const second = at(white, 3, 6)!;
    const origin = { x: second.x, z: second.z };
    errsW.length = 0;
    await drag(white, second.id, centre(3, 4).x, centre(3, 4).z);
    const now = byId(white, second.id);
    check('a second white move is refused', errsW.some((e) => /turn/i.test(e)), errsW.join(' | '));
    check('that piece goes back too', near(now.x, origin.x) && near(now.z, origin.z),
      `ended at ${now.x.toFixed(2)},${now.z.toFixed(2)}`);
    check('black sees the board unchanged as well', !!at(black, 3, 6), "black's view has the pawn moved");
  }

  console.log('\nAn illegal move by the right player');
  {
    const knight = at(black, 1, 0)!;   // black knight
    const origin = { x: knight.x, z: knight.z };
    errsB.length = 0;
    await drag(black, knight.id, centre(1, 3).x, centre(1, 3).z);   // knights do not move three
    const now = byId(black, knight.id);
    check('an illegal shape is refused', errsB.some((e) => /knight cannot move/i.test(e)), errsB.join(' | '));
    check('the knight goes back', near(now.x, origin.x) && near(now.z, origin.z), `ended at ${now.x.toFixed(2)},${now.z.toFixed(2)}`);
  }

  console.log('\nAbandoning a drag without dropping');
  {
    const pawn = at(black, 0, 1)!;
    const origin = { x: pawn.x, z: pawn.z };
    black.send('op', { t: 'grab', target: pawn.id });
    for (let i = 1; i <= 3; i++) {
      black.send('op', { t: 'move', target: pawn.id, x: pawn.x + i * 0.3, z: pawn.z });
      await sleep(60);
    }
    black.send('op', { t: 'release', target: pawn.id });
    await sleep(600);
    const now = byId(black, pawn.id);
    check('a drag let go without dropping snaps back', near(now.x, origin.x) && near(now.z, origin.z),
      `ended at ${now.x.toFixed(2)},${now.z.toFixed(2)}`);
  }

  console.log('\nA legal move still works');
  {
    const pawn = at(black, 4, 1)!;
    await drag(black, pawn.id, centre(4, 3).x, centre(4, 3).z);
    check('black may make a legal move on their turn', !!at(black, 4, 3), 'pawn did not advance');
    check('white sees it too', !!at(white, 4, 3), "white's board disagrees");
  }

  console.log('\nWith rules off, nothing is refused');
  {
    white.send('op', { t: 'setEnforcement', mode: 'off' });
    await sleep(600);
    const blackPawn = at(white, 0, 1)!;
    errsW.length = 0;
    await drag(white, blackPawn.id, centre(0, 4).x, centre(0, 4).z);
    check('a sandbox table lets anyone move anything', errsW.length === 0, errsW.join(' | '));
    check('and the piece stays where it was put', !!at(white, 0, 4), 'the piece snapped back');
  }

  await white.leave(true);
  await black.leave(true);
  await gs.gracefullyShutdown(false);
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('test crashed:', e); process.exit(1); });
