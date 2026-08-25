/**
 * Chess rule enforcement.
 *
 * Drives the real pack script through the real sandbox against a real table, so this
 * covers the script, the `table` API and the board geometry together.
 *
 * Each scenario gets a fresh board. Sharing one board across scenarios makes a single
 * wrong assumption cascade: a move that unexpectedly succeeds flips the turn, and every
 * later assertion then fails for the wrong reason.
 *
 * Grid coordinates: column 0-7 left to right, row 0 = black's home, row 7 = white's.
 *
 * Run: npx tsx server/test/chessRules.ts
 */

import { TableState, Player } from '../src/state.js';
import { buildTable, snapToGrid } from '../src/engine.js';
import { ScriptHost } from '../src/scripting/host.js';
import { buildScriptApi } from '../src/scripting/api.js';
import { chessPack } from '@wvtt/shared';

let failures = 0;
function check(label: string, cond: boolean, detail = '') {
  if (!cond) failures++;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${!cond && detail ? ` — ${detail}` : ''}`);
}

const LEFT = -2.0;
const CELL = 0.5;
const centre = (c: number, r: number) => ({ x: LEFT + c * CELL + CELL / 2, z: LEFT + r * CELL + CELL / 2 });

interface Board {
  state: TableState;
  host: ScriptHost;
  /** Ask the script to judge a move; apply it to the table when allowed. */
  move: (fc: number, fr: number, tc: number, tr: number, seat: number) => { allowed: boolean; reason: string };
  at: (c: number, r: number) => string | undefined;
  countIn: (zoneId: string) => number;
}

async function freshBoard(): Promise<Board> {
  const state = new TableState();
  for (const [i, name] of [[0, 'White'], [1, 'Black']] as [number, string][]) {
    const p = new Player();
    p.sessionId = `s${i}`; p.name = name; p.color = '#fff';
    p.seat = i; p.connected = true; p.px = 0; p.pz = 0;
    state.players.set(p.sessionId, p);
  }
  buildTable(state, chessPack, [0, 1]);

  const api = buildScriptApi({ state, vars: new Map(), markVisibilityDirty: () => {} });
  const { host, error } = await ScriptHost.create(chessPack.script!, api);
  if (!host) throw new Error(`chess script failed to load: ${error}`);
  host.call('onSetup', []);

  const pieceAt = (c: number, r: number) => {
    const want = centre(c, r);
    for (const p of state.pieces.values()) {
      if (p.zoneId !== 'board') continue;
      if (Math.abs(p.x - want.x) < 0.01 && Math.abs(p.z - want.z) < 0.01) return p;
    }
    return undefined;
  };

  return {
    state,
    host,
    at: (c, r) => pieceAt(c, r)?.defId,
    countIn: (zoneId) => [...state.pieces.values()].filter((p) => p.zoneId === zoneId).length,
    move(fc, fr, tc, tr, seat) {
      const piece = pieceAt(fc, fr);
      if (!piece) return { allowed: false, reason: `no piece on ${fc},${fr}` };
      const to = centre(tc, tr);
      const res = host.call('validateMove', [
        { t: 'drop', target: piece.id, x: to.x, z: to.z, seat, name: seat === 0 ? 'White' : 'Black' },
      ]);
      if (!res.ok) return { allowed: false, reason: `script error: ${res.error}` };
      if (res.rejection) return { allowed: false, reason: res.rejection };
      // The engine would now perform the drop; mirror it so the board advances.
      const snapped = snapToGrid(state.zones.get('board')!, to.x, to.z);
      piece.x = snapped.x; piece.z = snapped.z;
      return { allowed: true, reason: '' };
    },
  };
}

async function main() {
  console.log('\nOpening position');
  {
    const b = await freshBoard();
    check('the board holds 32 pieces', b.countIn('board') === 32, `${b.countIn('board')}`);
    check('white pawns stand on row 6', b.at(4, 6) === 'wp', b.at(4, 6));
    check('the white king stands on row 7', b.at(4, 7) === 'wk', b.at(4, 7));
    check('black pawns stand on row 1', b.at(4, 1) === 'bp', b.at(4, 1));
    b.host.dispose();
  }

  console.log('\nTurn order');
  {
    const b = await freshBoard();
    check('black cannot move first', !b.move(4, 1, 4, 2, 1).allowed);
    check('white cannot move a black piece', !b.move(4, 1, 4, 2, 0).allowed);
    check('a spectator cannot move at all', !b.move(4, 6, 4, 5, -1).allowed);
    check('white may open', b.move(4, 6, 4, 5, 0).allowed);
    check('white cannot move twice in a row', !b.move(3, 6, 3, 5, 0).allowed);
    b.host.dispose();
  }

  console.log('\nPawns');
  {
    const b = await freshBoard();
    check('a pawn may advance one square', b.move(4, 6, 4, 5, 0).allowed);
    check('a pawn may open with two squares', b.move(4, 1, 4, 3, 1).allowed);
    check('a pawn cannot advance two from a later row', !b.move(4, 5, 4, 3, 0).allowed);
    check('a pawn cannot move backwards', !b.move(4, 5, 4, 6, 0).allowed);
    check('a pawn cannot step diagonally onto an empty square', !b.move(2, 6, 3, 5, 0).allowed);
    b.host.dispose();
  }

  console.log('\nBlocked paths');
  {
    const b = await freshBoard();
    check('a bishop cannot move through its own pawn', !b.move(5, 7, 3, 5, 0).allowed);
    check('a rook cannot move through its own pawn', !b.move(0, 7, 0, 4, 0).allowed);
    check('a knight jumps over its own pieces', b.move(6, 7, 5, 5, 0).allowed);
    b.host.dispose();
  }

  console.log('\nCapturing');
  {
    const b = await freshBoard();
    b.move(4, 6, 4, 4, 0);     // white e-pawn forward two
    b.move(3, 1, 3, 3, 1);     // black d-pawn forward two, now diagonal to it
    const before = b.countIn('takenB');
    const cap = b.move(4, 4, 3, 3, 0);
    check('a pawn captures diagonally', cap.allowed, cap.reason);
    check('the captured piece leaves the board', b.countIn('takenB') === before + 1, `${before} -> ${b.countIn('takenB')}`);
    check('the capturing pawn now stands there', b.at(3, 3) === 'wp', b.at(3, 3));
    check('only one piece occupies the square', b.countIn('board') === 31, `${b.countIn('board')}`);
    b.host.dispose();
  }

  console.log('\nCheck');
  {
    const b = await freshBoard();
    b.move(4, 6, 4, 4, 0);     // white e-pawn out, opening the queen's diagonal
    b.move(5, 1, 5, 3, 1);     // black f-pawn out, exposing the a4-e8 diagonal
    const q = b.move(3, 7, 7, 3, 0);   // white queen to the long diagonal, checking the king
    check('the queen reaches the checking square', q.allowed, q.reason);
    const ignore = b.move(0, 1, 0, 2, 1);   // black plays elsewhere, ignoring the check
    check('a move that leaves your king in check is refused', !ignore.allowed, ignore.reason);
    const block = b.move(6, 1, 6, 2, 1);    // interposing a pawn blocks the diagonal
    check('a move that blocks the check is allowed', block.allowed, block.reason);
    b.host.dispose();
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('test crashed:', e); process.exit(1); });
