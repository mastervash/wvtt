/**
 * Room snapshots survive a restart.
 *
 * Simulates a deploy: a table is set up and played, the server is shut down entirely,
 * a fresh one starts against the same data directory, and the original room code is
 * used again. The table should come back; the players should not.
 *
 * Run: npx tsx server/test/persistence.ts
 */

import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// persistence.ts reads DATA_DIR when it is first imported, so it must be set before
// anything pulls it in. Every import below is therefore dynamic.
const dataDir = mkdtempSync(path.join(tmpdir(), 'wvtt-persist-'));
process.env.DATA_DIR = dataDir;

const { Server } = await import('@colyseus/core');
const { WebSocketTransport } = await import('@colyseus/ws-transport');
const { Client } = await import('colyseus.js');
const { TableRoom } = await import('../src/rooms/TableRoom.js');

const PORT = 2589;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label: string, cond: boolean, detail = '') {
  if (!cond) failures++;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${!cond && detail ? ` — ${detail}` : ''}`);
}

interface Snap {
  roomCode: string;
  packName: string;
  enforcement: string;
  players: Record<string, unknown>;
  pieces: Record<string, { id: string; zoneId: string; secret?: { face?: string } }>;
  stacks: Record<string, { pieceIds?: string[] }>;
  log: { text: string }[];
}

async function boot() {
  const httpServer = createServer();
  const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
  gameServer.define('table', TableRoom);
  await gameServer.listen(PORT);
  return gameServer;
}

const inZone = (s: Snap, z: string) => Object.values(s.pieces).filter((p) => p.zoneId === z);

async function main() {
  /* ---- first run: set a table up and play a little ---- */
  let server = await boot();
  const c1 = new Client(`ws://localhost:${PORT}`);
  const room1 = await c1.joinOrCreate('table', { name: 'Ana', packId: 'eights' });
  await sleep(500);
  room1.send('op', { t: 'sit', seat: 0 });
  await sleep(300);
  room1.send('op', { t: 'scriptAction', action: 'deal' });
  await sleep(1200);

  const before = room1.state.toJSON() as unknown as Snap;
  const code = before.roomCode;
  const handBefore = inZone(before, 'hand0').map((p) => p.secret?.face).sort();
  const discardBefore = inZone(before, 'discard').map((p) => p.secret?.face);
  const pieceCountBefore = Object.keys(before.pieces).length;

  console.log('\nBefore the restart');
  check('a hand was dealt', handBefore.length === 5, `${handBefore.length}`);
  check('rules are enforced', before.enforcement === 'enforced', before.enforcement);
  check('the room has a code', /^[A-Z0-9]{6}$/.test(code), code);

  /* ---- the restart ---- */
  await room1.leave(true);
  await sleep(300);
  await server.gracefullyShutdown(false);
  await sleep(500);

  console.log('\nAfter a full restart');
  server = await boot();
  const { hasRoom } = await import('../src/persistence.js');
  check('the snapshot is on disk', hasRoom(code));

  const c2 = new Client(`ws://localhost:${PORT}`);
  const room2 = await c2.create('table', { name: 'Ben', roomCode: code });
  await sleep(1200);
  const after = room2.state.toJSON() as unknown as Snap;

  check('the room code is preserved', after.roomCode === code, after.roomCode);
  check('the pack is preserved', after.packName === before.packName, after.packName);
  check('the rules setting is preserved', after.enforcement === 'enforced', after.enforcement);
  check('the same number of pieces came back', Object.keys(after.pieces).length === pieceCountBefore,
    `${Object.keys(after.pieces).length} vs ${pieceCountBefore}`);
  check('the discard pile is intact', inZone(after, 'discard').map((p) => p.secret?.face).join() === discardBefore.join(),
    inZone(after, 'discard').map((p) => p.secret?.face).join());
  check('the log says the table was restored', after.log.some((l) => /restored/i.test(l.text)));

  console.log('\nWhat must NOT come back');
  check('the old player is gone', Object.keys(after.players).length === 1, `${Object.keys(after.players).length} players`);
  // Ben joined and was auto-seated in seat 0; the hand left there is face-down to him
  // until he is entitled to it, but crucially the identities must not simply be handed
  // over from the snapshot without going through the visibility filter.
  const handAfter = inZone(after, 'hand0');
  check('the cards left in the seat are still there', handAfter.length === 5, `${handAfter.length}`);

  /* ---- a code that was never saved still 404s ---- */
  check('an unknown code is not restorable', !hasRoom('ZZZZZZ'));

  /* ---- the restored table is still playable ---- */
  console.log('\nThe restored table still works');
  room2.send('op', { t: 'sit', seat: 0 });
  await sleep(400);
  const seated = room2.state.toJSON() as unknown as Snap;
  const readable = inZone(seated, 'hand0').filter((p) => p.secret?.face).length;
  check('taking the seat reveals that seat\'s hand', readable === 5, `${readable} of 5 readable`);
  check('the hand is the one that was saved',
    inZone(seated, 'hand0').map((p) => p.secret?.face).sort().join() === handBefore.join(),
    'contents differ');

  await room2.leave(true);
  await server.gracefullyShutdown(false);
  rmSync(dataDir, { recursive: true, force: true });

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('test crashed:', e); rmSync(dataDir, { recursive: true, force: true }); process.exit(1); });
