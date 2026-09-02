/**
 * What a live room actually costs in memory.
 *
 * Rooms are disposed as soon as they empty, so a week-long retention window costs disk
 * and not RAM — but "costs nothing" is the sort of claim that should be measured rather
 * than asserted, and the number that matters for capacity planning is the cost of a
 * room that is genuinely in use.
 *
 * Run directly:  npx tsx --expose-gc server/test/roomMemory.ts
 * (--expose-gc is optional; without it the per-room figures are noisier.)
 */

import { TableState } from '../src/state.js';
import { buildTable } from '../src/engine.js';
import { getBuiltinPack, BUILTIN_PACKS } from '@wvtt/shared';
import { statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOMS_PATH, MAX_AGE_MS } from '../src/persistence.js';

const MB = 1024 * 1024;

function heap(): number {
  global.gc?.();
  return process.memoryUsage().heapUsed;
}

/** Build `n` tables of one pack and report the average heap each one costs. */
function measure(packId: string, n: number): { each: number; pieces: number } {
  const pack = getBuiltinPack(packId);
  if (!pack) throw new Error(`no pack ${packId}`);

  // Warm up first: the first build pulls in code paths and grows the heap for reasons
  // that have nothing to do with per-room cost.
  const warm = new TableState();
  buildTable(warm, pack, [0, 1]);
  const pieces = warm.pieces.size;

  const before = heap();
  const kept: TableState[] = [];
  for (let i = 0; i < n; i++) {
    const state = new TableState();
    buildTable(state, pack, [0, 1]);
    kept.push(state);
  }
  const after = heap();
  // Referenced until after the measurement, so nothing is collected early.
  if (kept.length !== n) throw new Error('impossible');
  return { each: (after - before) / n, pieces };
}

console.log('Live room cost in memory\n');
console.log('  pack               pieces    heap/room');
for (const id of ['sandbox', 'eights', 'poker', 'chess']) {
  const { each, pieces } = measure(id, 40);
  console.log(`  ${id.padEnd(18)} ${String(pieces).padStart(6)}    ${(each / 1024).toFixed(0).padStart(5)} KB`);
}

console.log('\nSnapshots on disk (what a week of retention actually holds)');
let bytes = 0;
let count = 0;
let oldest = 0;
try {
  for (const name of readdirSync(ROOMS_PATH)) {
    if (!name.endsWith('.json')) continue;
    const st = statSync(path.join(ROOMS_PATH, name));
    bytes += st.size;
    count++;
    oldest = Math.max(oldest, Date.now() - st.mtimeMs);
  }
} catch {
  console.log('  (no snapshot directory on this machine)');
}
if (count > 0) {
  console.log(`  ${count} snapshots, ${(bytes / MB).toFixed(1)} MB total, ${(bytes / count / 1024).toFixed(0)} KB each`);
  console.log(`  oldest is ${(oldest / 36e5).toFixed(0)}h old; they are dropped at ${(MAX_AGE_MS / 36e5).toFixed(0)}h`);
  console.log(`  a year at this rate would be ${((bytes / MB) * (365 / (MAX_AGE_MS / 864e5))).toFixed(0)} MB — but they expire, so the steady state is the number above`);
}

console.log(`\n  ${BUILTIN_PACKS.length} built-in packs are loaded once at startup and shared by every room.`);
