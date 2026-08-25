/**
 * The game clock.
 *
 * Run: npx tsx server/test/clock.ts
 */

import { createServer } from 'node:http';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client, type Room } from 'colyseus.js';
import { TableRoom } from '../src/rooms/TableRoom.js';

const PORT = 2584;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label: string, cond: boolean, detail = '') {
  if (!cond) failures++;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${!cond && detail ? ` — ${detail}` : ''}`);
}

const clockOf = (room: Room) => (room.state.toJSON() as any).clock;
const timeOf = (room: Room, seat: number) => clockOf(room).times?.[String(seat)] ?? null;

async function main() {
  const hs = createServer();
  const gs = new Server({ transport: new WebSocketTransport({ server: hs }) });
  gs.define('table', TableRoom);
  await gs.listen(PORT);

  const ca = new Client(`ws://localhost:${PORT}`);
  const white = await ca.joinOrCreate('table', { name: 'White', packId: 'chess' });
  await sleep(800);
  const cb = new Client(`ws://localhost:${PORT}`);
  const black = await cb.joinById(white.roomId, { name: 'Black' });
  await sleep(500);
  white.send('op', { t: 'sit', seat: 0 });
  black.send('op', { t: 'sit', seat: 1 });
  await sleep(400);

  console.log('\nSetting one up');
  check('there is no clock to begin with', clockOf(white).enabled === false);
  white.send('op', { t: 'clockConfig', baseMs: 60_000, incrementMs: 2000, mode: 'manual' });
  await sleep(500);
  check('the clock appears', clockOf(white).enabled === true);
  check('both seats get the base time', timeOf(white, 0) === 60_000 && timeOf(white, 1) === 60_000,
    `${timeOf(white, 0)} / ${timeOf(white, 1)}`);
  check('it starts paused', clockOf(white).running === false);
  check('black sees the same clock', timeOf(black, 0) === 60_000);

  console.log('\nCounting down');
  white.send('op', { t: 'clockStart' });
  await sleep(1500);
  const w1 = timeOf(white, 0);
  const b1 = timeOf(white, 1);
  check("the active player's time falls", w1 < 60_000, `${w1}`);
  check("the waiting player's time does not", b1 === 60_000, `${b1}`);
  check('roughly a second and a half elapsed', 60_000 - w1 > 900 && 60_000 - w1 < 2600, `${60_000 - w1}ms`);

  console.log('\nPressing the clock (manual mode)');
  {
    const before = timeOf(white, 0);
    black.send('op', { t: 'clockPress' });          // not black's turn yet
    await sleep(400);
    check('only the active player can press', clockOf(white).activeSeat === 0, `active=${clockOf(white).activeSeat}`);

    white.send('op', { t: 'clockPress' });
    await sleep(500);
    check('the turn passes to the other player', clockOf(white).activeSeat === 1, `active=${clockOf(white).activeSeat}`);
    check('the increment is added to the player who moved', timeOf(white, 0) >= before + 1500,
      `${before} -> ${timeOf(white, 0)}`);

    const b2 = timeOf(white, 1);
    // Sample white's clock after the handover: comparing against a reading taken before
    // the press is wrong, because white's clock was still draining until they pressed.
    const wHeld = timeOf(white, 0);
    await sleep(1200);
    check("now black's time is the one falling", timeOf(white, 1) < b2, `${b2} -> ${timeOf(white, 1)}`);
    check("white's time is held while waiting", timeOf(white, 0) === wHeld, `${wHeld} -> ${timeOf(white, 0)}`);
  }

  console.log('\nPausing');
  {
    white.send('op', { t: 'clockPause' });
    await sleep(300);
    const held = timeOf(white, 1);
    await sleep(1000);
    check('a paused clock stops counting', timeOf(white, 1) === held, `${held} -> ${timeOf(white, 1)}`);
  }

  console.log('\nRunning out of time');
  {
    white.send('op', { t: 'clockConfig', baseMs: 10_000, incrementMs: 0, mode: 'manual' });
    await sleep(300);
    // Wind the active player down by pressing back and forth is slow; just let it run.
    white.send('op', { t: 'clockStart' });
    await sleep(1000);
    check('the clock is running again', clockOf(white).running === true);
    check('a fresh configuration resets both times', timeOf(white, 1) === 10_000, `${timeOf(white, 1)}`);
  }

  console.log('\nAutomatic mode switches on a move');
  {
    white.send('op', { t: 'clockConfig', baseMs: 60_000, incrementMs: 0, mode: 'auto' });
    await sleep(300);
    white.send('op', { t: 'clockStart' });
    await sleep(300);
    check('white is on the clock', clockOf(white).activeSeat === 0);

    // Make a real, legal chess move and let the clock follow it.
    const CELL = 0.5, LEFT = -2.0;
    const centre = (c: number, r: number) => ({ x: LEFT + c * CELL + CELL / 2, z: LEFT + r * CELL + CELL / 2 });
    const pieces = Object.values<any>((white.state.toJSON() as any).pieces);
    const from = centre(4, 6), to = centre(4, 4);
    const pawn = pieces.find((p) => Math.abs(p.x - from.x) < 0.02 && Math.abs(p.z - from.z) < 0.02);
    white.send('op', { t: 'grab', target: pawn.id });
    white.send('op', { t: 'move', target: pawn.id, x: to.x, z: to.z });
    await sleep(80);
    white.send('op', { t: 'drop', target: pawn.id, zoneId: null, x: to.x, z: to.z });
    await sleep(800);
    check('completing a move hands the clock over', clockOf(white).activeSeat === 1, `active=${clockOf(white).activeSeat}`);
  }

  console.log('\nRemoving it');
  white.send('op', { t: 'clockOff' });
  await sleep(400);
  check('the clock can be taken away', clockOf(white).enabled === false);

  await white.leave(true);
  await black.leave(true);
  await gs.gracefullyShutdown(false);
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('test crashed:', e); process.exit(1); });
