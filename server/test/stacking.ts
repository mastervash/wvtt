/**
 * Dropping pieces on one another forms piles.
 *
 * Run: npx tsx server/test/stacking.ts
 */

import { TableState } from '../src/state.js';
import { buildTable } from '../src/engine.js';
import { applyOp, type OpContext } from '../src/ops.js';
import { sandboxPack, chessPack } from '@wvtt/shared';

let failures = 0;
const check = (l: string, c: boolean, d = '') => { if (!c) failures++; console.log(`  [${c ? 'PASS' : 'FAIL'}] ${l}${!c && d ? ` — ${d}` : ''}`); };

function table(pack = sandboxPack) {
  const state = new TableState();
  buildTable(state, pack, [0]);
  const ctx: OpContext = {
    state, peeks: new Map(), sessionId: 's', seat: 0,
    sidesOf: () => 6, playerName: () => 'Ana',
  };
  return { state, ctx };
}

const loose = (s: TableState) => [...s.pieces.values()].filter((p) => !p.stackId);
const piles = (s: TableState) => [...s.stacks.values()];

/** Take the top card off the deck and put it down at a spot. */
function pullTo(state: TableState, ctx: OpContext, x: number, z: number) {
  const deck = piles(state).reduce((a, b) => (b.pieceIds.length > a.pieceIds.length ? b : a));
  applyOp(ctx, { t: 'unstack', stackId: deck.id, count: 1, x, z } as never);
  const put = loose(state).find((p) => Math.abs(p.x - x) < 0.05 && Math.abs(p.z - z) < 0.05);
  return put!;
}

console.log('\nTwo cards laid on the same spot');
{
  const { state, ctx } = table();
  const a = pullTo(state, ctx, 3, 2);
  const b = pullTo(state, ctx, 3.05, 2.02);   // laid neatly on top of the first
  applyOp(ctx, { t: 'grab', target: b.id } as never);
  applyOp(ctx, { t: 'drop', target: b.id, zoneId: null, x: 3.05, z: 2.02 } as never);

  const pile = piles(state).find((p) => p.pieceIds.includes(a.id) && p.pieceIds.includes(b.id));
  check('they form a single pile', !!pile, 'no pile contains both');
  check('the pile has two cards', pile?.pieceIds.length === 2, `${pile?.pieceIds.length}`);
  check('neither card is loose any more', !loose(state).some((p) => p.id === a.id || p.id === b.id));
  check('no cards were lost', state.pieces.size === 52, `${state.pieces.size}`);
}

console.log('\nA card dropped well clear of another stays loose');
{
  const { state, ctx } = table();
  const a = pullTo(state, ctx, 3, 2);
  const b = pullTo(state, ctx, 5, 2);       // a long way off
  applyOp(ctx, { t: 'grab', target: b.id } as never);
  applyOp(ctx, { t: 'drop', target: b.id, zoneId: null, x: 5, z: 2 } as never);
  check('both stay loose', loose(state).some((p) => p.id === a.id) && loose(state).some((p) => p.id === b.id));
}

console.log('\nDropping onto an existing pile joins it');
{
  const { state, ctx } = table();
  const deck = piles(state).reduce((a, b) => (b.pieceIds.length > a.pieceIds.length ? b : a));
  const before = deck.pieceIds.length;
  const card = pullTo(state, ctx, deck.x + 2, deck.z);
  applyOp(ctx, { t: 'grab', target: card.id } as never);
  applyOp(ctx, { t: 'drop', target: card.id, zoneId: null, x: deck.x, z: deck.z } as never);
  check('the card goes back on the deck', deck.pieceIds.length === before, `${deck.pieceIds.length} vs ${before}`);
  check('it sits on top', deck.pieceIds[deck.pieceIds.length - 1] === card.id);
}

console.log('\nThe setting can be switched off');
{
  const { state, ctx } = table();
  applyOp(ctx, { t: 'setAutoStack', on: false } as never);
  const a = pullTo(state, ctx, 3, 2);
  const b = pullTo(state, ctx, 3.02, 2.01);
  applyOp(ctx, { t: 'grab', target: b.id } as never);
  applyOp(ctx, { t: 'drop', target: b.id, zoneId: null, x: 3.02, z: 2.01 } as never);
  check('cards stay exactly where they are put', loose(state).some((p) => p.id === b.id), 'it merged anyway');
  check('no pile was formed from them', !piles(state).some((p) => p.pieceIds.includes(b.id)));
}

console.log('\nBoard games are unaffected');
{
  const { state, ctx } = table(chessPack);
  const white = [...state.pieces.values()].find((p) => p.defId === 'wp')!;
  const target = [...state.pieces.values()].find((p) => p.defId === 'wr')!;
  applyOp(ctx, { t: 'grab', target: white.id } as never);
  applyOp(ctx, { t: 'drop', target: white.id, zoneId: 'board', x: target.x, z: target.z } as never);
  check('chess pieces never merge into a pile', state.stacks.size === 0, `${state.stacks.size} piles appeared`);
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
