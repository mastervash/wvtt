/**
 * Who may know what.
 *
 * This module answers exactly one question: for a given viewer, which pieces' secrets
 * is that viewer entitled to see? The room feeds the answer to Colyseus StateView,
 * which decides what actually gets encoded onto the wire.
 *
 * Every rule lives here. If you are adding a feature that changes who can see a card,
 * it belongs in this file and nowhere else.
 */

import type { TableState } from './state.js';

export interface Viewer {
  sessionId: string;
  /** -1 for spectators. */
  seat: number;
}

/** Explicit, temporary grants: piece id -> session ids currently peeking at it. */
export type PeekGrants = Map<string, Set<string>>;

/**
 * Decide whether `viewer` may know the identity of one piece.
 *
 * Order matters: an explicit peek grant always wins, then the containing zone's rule,
 * then the piece's own face-up state.
 */
export function canSee(state: TableState, viewer: Viewer, pieceId: string, peeks: PeekGrants): boolean {
  const piece = state.pieces.get(pieceId);
  if (!piece) return false;

  // 1. An explicit peek (the player lifted the corner of their own card).
  if (peeks.get(pieceId)?.has(viewer.sessionId)) return true;

  // 2. Zone rules override the piece's own state — a card in a private hand is
  //    private even if it happens to be flagged face-up.
  if (piece.zoneId) {
    const zone = state.zones.get(piece.zoneId);
    if (zone) {
      switch (zone.visibility) {
        case 'public':
          return true;
        case 'hidden':
          return false;
        case 'owner':
          return zone.ownerSeat >= 0 && zone.ownerSeat === viewer.seat;
        case 'inherit':
          break; // fall through to the piece's own state
      }
    }
  }

  // 3. Inside a stack only the top piece can be face-up and readable.
  if (piece.stackId) {
    const stack = state.stacks.get(piece.stackId);
    if (!stack) return false;
    const isTop = stack.pieceIds.length > 0 && stack.pieceIds[stack.pieceIds.length - 1] === pieceId;
    return isTop && piece.faceUp;
  }

  // 4. Loose on the table: readable exactly when face-up.
  return piece.faceUp;
}

/** The full set of piece ids whose secrets `viewer` may receive. */
export function visibleTo(state: TableState, viewer: Viewer, peeks: PeekGrants): Set<string> {
  const out = new Set<string>();
  state.pieces.forEach((piece, id) => {
    if (canSee(state, viewer, id, peeks)) out.add(id);
  });
  return out;
}
