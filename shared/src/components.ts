/**
 * Component library helpers.
 *
 * These build ComponentDef arrays for the common physical objects. They are ordinary
 * functions, not engine internals — a user-authored pack can produce the same arrays
 * by hand, and the built-in packs are just callers of these helpers.
 */

import type { ComponentDef } from './pack.js';

export const SUITS = ['S', 'H', 'D', 'C'] as const;
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'] as const;

export type Suit = typeof SUITS[number];
export type Rank = typeof RANKS[number];

export const SUIT_NAMES: Record<Suit, string> = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
export const RANK_NAMES: Record<Rank, string> = {
  A: 'Ace', '2': 'Two', '3': 'Three', '4': 'Four', '5': 'Five', '6': 'Six', '7': 'Seven',
  '8': 'Eight', '9': 'Nine', T: 'Ten', J: 'Jack', Q: 'Queen', K: 'King',
};

/** Numeric rank with ace high, for scripts that want to compare cards. */
export const RANK_VALUE: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  T: 10, J: 11, Q: 12, K: 13, A: 14,
};

export const CARD_W = 0.63;
export const CARD_H = 0.88;
export const CARD_D = 0.006;

/**
 * The 52-card deck. Faces are drawn procedurally at runtime, so the app ships no
 * card artwork and carries no image licensing baggage.
 */
export function standardDeck(includeJokers = false): ComponentDef[] {
  const out: ComponentDef[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      const id = `${rank}${suit}`;
      out.push({
        id,
        kind: 'card',
        label: `${RANK_NAMES[rank]} of ${SUIT_NAMES[suit]}`,
        face: id,
        front: { type: 'generated', generator: 'playing-card', params: { rank, suit } },
        back: { type: 'generated', generator: 'playing-card', params: { back: 'default' } },
        w: CARD_W, h: CARD_H, d: CARD_D,
        data: { suit, rank, value: RANK_VALUE[rank], red: suit === 'H' || suit === 'D' },
      });
    }
  }
  if (includeJokers) {
    for (const j of ['X1', 'X2']) {
      out.push({
        id: j,
        kind: 'card',
        label: 'Joker',
        face: j,
        front: { type: 'generated', generator: 'playing-card', params: { rank: 'X', suit: 'X' } },
        back: { type: 'generated', generator: 'playing-card', params: { back: 'default' } },
        w: CARD_W, h: CARD_H, d: CARD_D,
        data: { suit: 'X', rank: 'X', value: 0, red: false },
      });
    }
  }
  return out;
}

/** Poker chips. Denominations follow the usual casino colour convention. */
export const CHIP_DENOMS: { value: number; color: string; label: string }[] = [
  { value: 1, color: '#f5f5f0', label: 'White' },
  { value: 5, color: '#c0392b', label: 'Red' },
  { value: 25, color: '#27632a', label: 'Green' },
  { value: 100, color: '#1a1a1a', label: 'Black' },
  { value: 500, color: '#5b2c8d', label: 'Purple' },
];

export function chipSet(): ComponentDef[] {
  return CHIP_DENOMS.map((c) => ({
    id: `chip${c.value}`,
    kind: 'chip' as const,
    label: `${c.label} (${c.value})`,
    face: `chip${c.value}`,
    front: { type: 'generated' as const, generator: 'chip' as const, params: { value: c.value, color: c.color } },
    w: 0.32, h: 0.32, d: 0.045,
    data: { value: c.value, color: c.color },
  }));
}

/** Polyhedral dice. `sides` drives both the mesh and the roll range. */
export function diceSet(sides: number[] = [4, 6, 8, 10, 12, 20]): ComponentDef[] {
  return sides.map((s) => ({
    id: `d${s}`,
    kind: 'die' as const,
    label: `d${s}`,
    face: `d${s}`,
    front: { type: 'generated' as const, generator: 'die' as const, params: { sides: s } },
    w: 0.3, h: 0.3, d: 0.3,
    sides: s,
    data: { sides: s },
  }));
}

const CHESS_PIECES: { id: string; label: string }[] = [
  { id: 'k', label: 'King' }, { id: 'q', label: 'Queen' }, { id: 'r', label: 'Rook' },
  { id: 'b', label: 'Bishop' }, { id: 'n', label: 'Knight' }, { id: 'p', label: 'Pawn' },
];

/** Chess/checkers pieces, built from primitives rather than imported models. */
export function chessSet(): ComponentDef[] {
  const out: ComponentDef[] = [];
  for (const color of ['w', 'b'] as const) {
    for (const p of CHESS_PIECES) {
      out.push({
        id: `${color}${p.id}`,
        kind: 'piece',
        label: `${color === 'w' ? 'White' : 'Black'} ${p.label}`,
        face: `${color}${p.id}`,
        front: { type: 'generated', generator: 'chess', params: { piece: p.id, color } },
        w: 0.4, h: 0.4, d: 0.4,
        data: { piece: p.id, color, chess: true },
      });
    }
  }
  return out;
}

/** Coloured player tokens for generic board games. */
export const TOKEN_COLORS = ['#e6432f', '#2f7de6', '#3fae57', '#e6c22f', '#8e44ad', '#e6852f'];

export function tokenSet(): ComponentDef[] {
  return TOKEN_COLORS.map((c, i) => ({
    id: `token${i}`,
    kind: 'token' as const,
    label: `Token ${i + 1}`,
    face: `token${i}`,
    front: { type: 'generated' as const, generator: 'blank' as const, params: { color: c } },
    w: 0.28, h: 0.28, d: 0.12,
    data: { color: c, index: i },
  }));
}

/** Build a deck of text cards from a list of lines. Powers custom user decks. */
export function textDeck(idPrefix: string, lines: string[], bg = '#f7f4ec', fg = '#16161a'): ComponentDef[] {
  return lines.map((line, i) => ({
    id: `${idPrefix}${i}`,
    kind: 'card' as const,
    label: line.slice(0, 40),
    face: `${idPrefix}${i}`,
    front: { type: 'text' as const, text: line, bg, fg },
    back: { type: 'text' as const, text: '', bg: '#2b2b33', fg: '#2b2b33' },
    w: CARD_W, h: CARD_H, d: CARD_D,
    data: { text: line, index: i },
  }));
}
