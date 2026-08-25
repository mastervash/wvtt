/**
 * Room snapshots.
 *
 * Rooms live in memory, which meant every restart — including a routine deploy — ended
 * every game in progress. A table is now written to disk periodically and when it
 * closes, so a room code keeps working across a restart.
 *
 * Deliberately not persisted: players and their peeks. Sessions do not survive a
 * restart, so everyone rejoins as a new guest and re-takes a seat. Restoring a peek
 * granted to a session that no longer exists would be meaningless, and quietly
 * re-granting it to whoever inherits the seat would leak information.
 */

import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GamePack } from '@wvtt/shared';

export interface PieceSnapshot {
  id: string; kind: string; defId: string;
  x: number; y: number; z: number; rotY: number;
  faceUp: boolean; stackId: string; order: number; zoneId: string;
  face: string; value: number;
}

export interface StackSnapshot {
  id: string; x: number; y: number; z: number; rotY: number;
  zoneId: string; pieceIds: string[];
}

export interface RoomSnapshot {
  version: 1;
  roomCode: string;
  savedAt: number;
  enforcement: string;
  /** Room settings a table should keep across a restart. */
  autoStack: boolean;
  /** The full pack, so a table running a user-authored pack can be rebuilt. */
  pack: GamePack;
  pieces: PieceSnapshot[];
  stacks: StackSnapshot[];
  /** Values the pack's rules script stored, e.g. whose turn it is. */
  scriptVars: [string, unknown][];
}

/**
 * Where snapshots live.
 *
 * Anchored to this module rather than the working directory. Resolving against cwd
 * looked fine but split the storage in two: npm runs workspace scripts from inside the
 * workspace, so `npm run dev` wrote to server/server/data while the deployed service
 * wrote to server/data — a room saved in one was invisible to the other. Both the
 * TypeScript source (server/src) and the bundled output (server/dist) sit one level
 * below server/, so '../data' is correct in either.
 */
const DATA_DIR = process.env.DATA_DIR
  ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data');
const ROOM_DIR = path.join(DATA_DIR, 'rooms');

/** Snapshots older than this are swept up on startup. */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function ensureDir(): void {
  // 0700: snapshots contain every card's identity, including face-down ones. Anyone
  // able to read them can read the whole table.
  mkdirSync(ROOM_DIR, { recursive: true, mode: 0o700 });
}

/** Room codes come from user input on the join path, so never trust them in a path. */
function fileFor(roomCode: string): string | null {
  if (!/^[A-Z0-9]{4,12}$/.test(roomCode)) return null;
  return path.join(ROOM_DIR, `${roomCode}.json`);
}

export function saveRoom(snapshot: RoomSnapshot): void {
  const file = fileFor(snapshot.roomCode);
  if (!file) return;
  try {
    ensureDir();
    // Write to a temporary file and rename, so a crash mid-write cannot leave a
    // half-written snapshot that fails to parse on restore.
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, file);
  } catch (err) {
    console.warn(`[wvtt] could not save room ${snapshot.roomCode}:`, err instanceof Error ? err.message : err);
  }
}

export function loadRoom(roomCode: string): RoomSnapshot | null {
  const file = fileFor(roomCode);
  if (!file) return null;
  try {
    const raw = readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as RoomSnapshot;
    if (parsed?.version !== 1 || parsed.roomCode !== roomCode) return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;   // missing or corrupt; the caller opens a fresh table
  }
}

export function hasRoom(roomCode: string): boolean {
  return loadRoom(roomCode) !== null;
}

export function forgetRoom(roomCode: string): void {
  const file = fileFor(roomCode);
  if (!file) return;
  try { unlinkSync(file); } catch { /* already gone */ }
}

/** Delete snapshots nobody has touched in a week. Called once at startup. */
export function pruneOldRooms(): number {
  let removed = 0;
  try {
    ensureDir();
    for (const name of readdirSync(ROOM_DIR)) {
      if (!name.endsWith('.json')) continue;
      const full = path.join(ROOM_DIR, name);
      try {
        if (Date.now() - statSync(full).mtimeMs > MAX_AGE_MS) { unlinkSync(full); removed++; }
      } catch { /* skip */ }
    }
  } catch { /* directory not readable; nothing to prune */ }
  return removed;
}

export const ROOMS_PATH = ROOM_DIR;
