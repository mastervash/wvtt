/**
 * Operation handling.
 *
 * Every client message ends up here. Ops are REQUESTS: each one is validated against
 * the current table before anything changes. A client that sends a malformed or
 * illegal op gets it dropped, never applied optimistically.
 */

import type { Op } from '@wvtt/shared';
import type { TableState, Piece, Stack } from './state.js';
import { ChatMessage } from './state.js';
import {
  detachFromStack, makeStack, relayoutZone, replaceIds, restackYs, snapToGrid,
  thicknessOf, zoneAt, pushLog,
} from './engine.js';
import { shuffleInPlace, rollDie, makeId } from './rng.js';
import type { PeekGrants } from './visibility.js';

export interface OpContext {
  state: TableState;
  peeks: PeekGrants;
  sessionId: string;
  seat: number;
  /** Component metadata, used for things like how many sides a die has. */
  sidesOf: (defId: string) => number;
  playerName: (sessionId: string) => string;
}

export interface OpResult {
  ok: boolean;
  /** Set when the change could alter who can see what, forcing a view recompute. */
  visibilityDirty: boolean;
  error?: string;
}

const OK: OpResult = { ok: true, visibilityDirty: false };
const OK_VIS: OpResult = { ok: true, visibilityDirty: true };
const fail = (error: string): OpResult => ({ ok: false, visibilityDirty: false, error });

/**
 * Kinds that form piles when dropped on one another. Chess pieces and dice are left
 * alone: stacking a knight on a bishop is never what anyone meant.
 */
const STACKABLE = new Set(['card', 'chip', 'tile']);

/** How close a drop has to land before it counts as "on top of" something. */
const SNAP_RADIUS = 0.34;

/** Reject absurd coordinates so a malicious client cannot fling a card to infinity. */
const LIMIT = 40;
const sane = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= LIMIT;

function heldByOther(holder: string, sessionId: string): boolean {
  return holder !== '' && holder !== sessionId;
}

export function applyOp(ctx: OpContext, op: Op): OpResult {
  const { state, sessionId } = ctx;

  switch (op.t) {
    /* ---------------- presence ---------------- */

    case 'pointer': {
      const player = state.players.get(sessionId);
      if (!player || !sane(op.x) || !sane(op.z)) return fail('bad pointer');
      player.px = op.x;
      player.pz = op.z;
      return OK;
    }

    case 'chat': {
      const player = state.players.get(sessionId);
      if (!player) return fail('no player');
      // Strip control characters and cap the length: chat text is untrusted input that
      // every other player's browser will render.
      const text = String(op.text ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .trim()
        .slice(0, 300);
      if (!text) return fail('empty message');

      const message = new ChatMessage();
      message.id = makeId('m');
      message.sessionId = sessionId;
      message.name = player.name;
      message.color = player.color;
      message.text = text;
      message.at = Date.now();
      state.chat.push(message);
      // Chat is a conversation, not an archive; keep it bounded.
      while (state.chat.length > 120) state.chat.shift();
      return OK;
    }

    case 'rename': {
      const player = state.players.get(sessionId);
      if (!player) return fail('no player');
      const name = String(op.name ?? '').trim().slice(0, 24);
      if (!name) return fail('empty name');
      player.name = name;
      return OK;
    }

    case 'sit': {
      const player = state.players.get(sessionId);
      if (!player) return fail('no player');
      const seat = Number(op.seat);
      if (!Number.isInteger(seat) || seat < 0 || seat >= state.maxSeats) return fail('bad seat');
      let taken = false;
      state.players.forEach((p) => {
        if (p.seat === seat && p.sessionId !== sessionId) taken = true;
      });
      if (taken) return fail('seat taken');
      player.seat = seat;
      pushLog(state, `${player.name} sat in seat ${seat + 1}.`);
      // Changing seat changes which private hand zones you can read.
      return OK_VIS;
    }

    case 'stand': {
      const player = state.players.get(sessionId);
      if (!player) return fail('no player');
      player.seat = -1;
      return OK_VIS;
    }

    /* ---------------- holding and moving ---------------- */

    case 'grab': {
      const t = resolve(state, op.target);
      if (!t) return fail('no target');
      if (heldByOther(t.obj.heldBy, sessionId)) return fail('held by another player');
      t.obj.heldBy = sessionId;
      return OK;
    }

    case 'release': {
      const t = resolve(state, op.target);
      if (!t) return fail('no target');
      if (t.obj.heldBy === sessionId) t.obj.heldBy = '';
      return OK;
    }

    case 'move': {
      if (!sane(op.x) || !sane(op.z)) return fail('bad coords');
      const t = resolve(state, op.target);
      if (!t) return fail('no target');
      if (heldByOther(t.obj.heldBy, sessionId)) return fail('held by another player');
      t.obj.x = op.x;
      t.obj.z = op.z;
      if (sane(op.rotY)) t.obj.rotY = op.rotY!;
      if (t.kind === 'stack') restackYs(state, t.obj.id);
      return OK;
    }

    case 'drop': {
      if (!sane(op.x) || !sane(op.z)) return fail('bad coords');
      const t = resolve(state, op.target);
      if (!t) return fail('no target');
      if (heldByOther(t.obj.heldBy, sessionId)) return fail('held by another player');

      const prevZone = t.obj.zoneId;
      const zone = zoneAt(state, op.x, op.z);
      let { x, z } = { x: op.x, z: op.z };
      if (zone) ({ x, z } = snapToGrid(zone, x, z));

      t.obj.x = x;
      t.obj.z = z;
      t.obj.zoneId = zone?.id ?? '';
      t.obj.heldBy = '';

      if (t.kind === 'piece') {
        const piece = t.obj as Piece;
        // Dropping a piece somewhere new takes it out of any stack it was in.
        detachFromStack(state, piece);
        piece.y = 0;
        // Entering a private hand means the owner should be able to read it.
        if (zone?.visibility === 'owner') piece.order = 9999;

        // Laying a card neatly on another one should make a pile, the way it would on
        // a real table. Grid zones are excluded: there, landing on a square is the
        // whole point and merging would fight the board.
        if (state.autoStack && STACKABLE.has(piece.kind) && zone?.layout !== 'grid'
            && zone?.visibility !== 'owner') {
          const onto = nearestStackTarget(state, piece, x, z);
          if (onto) mergeInto(state, piece, onto);
        }
      } else {
        restackYs(state, t.obj.id);
      }

      if (zone) relayoutZone(state, zone.id);
      if (prevZone && prevZone !== zone?.id) relayoutZone(state, prevZone);
      return OK_VIS;
    }

    /* ---------------- card actions ---------------- */

    case 'flip': {
      const t = resolve(state, op.target);
      if (!t) return fail('no target');
      if (t.kind === 'piece') {
        const piece = t.obj as Piece;
        piece.faceUp = !piece.faceUp;
      } else {
        // Flipping a stack turns the whole pile over: every piece flips AND the
        // order reverses, exactly like turning a real deck upside down.
        const stack = t.obj as Stack;
        const ids = [...stack.pieceIds].reverse();
        replaceIds(stack.pieceIds, ids);
        stack.pieceIds.forEach((pid) => {
          const p = state.pieces.get(pid);
          if (p) p.faceUp = !p.faceUp;
        });
        restackYs(state, stack.id);
      }
      return OK_VIS;
    }

    case 'shuffle': {
      const stack = state.stacks.get(op.stackId);
      if (!stack) return fail('no stack');
      if (heldByOther(stack.heldBy, sessionId)) return fail('held by another player');
      const ids = shuffleInPlace([...stack.pieceIds]);
      replaceIds(stack.pieceIds, ids);
      // Shuffling revokes every peek on those cards — nobody remembers a shuffled deck.
      for (const pid of ids) ctx.peeks.delete(pid);
      restackYs(state, stack.id);
      pushLog(state, `${ctx.playerName(sessionId)} shuffled ${ids.length} cards.`);
      return OK_VIS;
    }

    case 'draw': {
      const stack = state.stacks.get(op.stackId);
      if (!stack) return fail('no stack');
      const zone = state.zones.get(op.toZoneId);
      if (!zone) return fail('no zone');
      if (zone.ownerSeat >= 0 && zone.ownerSeat !== ctx.seat) return fail('not your zone');
      const piece = takeTop(state, stack);
      if (!piece) return fail('stack empty');
      moveIntoZone(state, piece, zone.id);
      relayoutZone(state, zone.id);
      pushLog(state, `${ctx.playerName(sessionId)} drew a card.`);
      return OK_VIS;
    }

    case 'deal': {
      const stack = state.stacks.get(op.stackId);
      if (!stack) return fail('no stack');
      const count = Math.max(1, Math.min(20, Math.floor(Number(op.count) || 1)));
      const zoneIds = (op.toZoneIds ?? []).filter((z) => state.zones.has(z));
      if (zoneIds.length === 0) return fail('no target zones');

      let dealt = 0;
      // Deal round-robin, one card at a time, the way a real dealer does.
      outer: for (let round = 0; round < count; round++) {
        for (const zid of zoneIds) {
          const piece = takeTop(state, stack);
          if (!piece) break outer;
          moveIntoZone(state, piece, zid);
          dealt++;
        }
      }
      for (const zid of zoneIds) relayoutZone(state, zid);
      pushLog(state, `${ctx.playerName(sessionId)} dealt ${dealt} card${dealt === 1 ? '' : 's'}.`);
      return OK_VIS;
    }

    case 'stackOnto': {
      if (op.target === op.ontoId) return fail('cannot stack onto itself');
      const src = resolve(state, op.target);
      const dst = resolve(state, op.ontoId);
      if (!src || !dst) return fail('no target');
      if (heldByOther(dst.obj.heldBy, sessionId)) return fail('held by another player');

      const moving = src.kind === 'stack'
        ? [...(src.obj as Stack).pieceIds].map((id) => state.pieces.get(id)!).filter(Boolean)
        : [src.obj as Piece];

      if (src.kind === 'stack') state.stacks.delete(src.obj.id);
      for (const p of moving) { p.stackId = ''; p.heldBy = ''; }

      if (dst.kind === 'stack') {
        const stack = dst.obj as Stack;
        for (const p of moving) { p.stackId = stack.id; stack.pieceIds.push(p.id); }
        restackYs(state, stack.id);
      } else {
        const base = dst.obj as Piece;
        detachFromStack(state, base);
        makeStack(state, [base, ...moving], base.x, base.z, base.zoneId);
      }
      return OK_VIS;
    }

    case 'unstack': {
      const stack = state.stacks.get(op.stackId);
      if (!stack) return fail('no stack');
      if (!sane(op.x) || !sane(op.z)) return fail('bad coords');
      const count = Math.max(1, Math.min(stack.pieceIds.length, Math.floor(Number(op.count) || 1)));
      const taken: Piece[] = [];
      for (let i = 0; i < count; i++) {
        const p = takeTop(state, stack);
        if (p) taken.unshift(p);
      }
      if (taken.length === 0) return fail('stack empty');
      const zone = zoneAt(state, op.x, op.z);
      if (taken.length === 1) {
        const p = taken[0];
        p.x = op.x; p.z = op.z; p.y = 0; p.zoneId = zone?.id ?? '';
      } else {
        makeStack(state, taken, op.x, op.z, zone?.id ?? '');
      }
      return OK_VIS;
    }

    /* ---------------- information ---------------- */

    case 'setAutoStack': {
      state.autoStack = Boolean(op.on);
      pushLog(state, `${ctx.playerName(sessionId)} turned ${state.autoStack ? 'on' : 'off'} snapping into piles.`);
      return OK;
    }

    case 'peek': {
      const piece = state.pieces.get(op.target);
      if (!piece) return fail('no piece');
      // You may only peek at something you are entitled to handle: a card in your own
      // hand, or one you are currently holding. Otherwise peek would be an X-ray.
      const zone = piece.zoneId ? state.zones.get(piece.zoneId) : undefined;
      const ownHand = zone?.ownerSeat === ctx.seat && ctx.seat >= 0;
      const holding = piece.heldBy === sessionId;
      if (!ownHand && !holding) return fail('cannot peek at that');
      let set = ctx.peeks.get(piece.id);
      if (!set) { set = new Set(); ctx.peeks.set(piece.id, set); }
      set.add(sessionId);
      pushLog(state, `${ctx.playerName(sessionId)} peeked at a card.`);
      return OK_VIS;
    }

    case 'unpeek': {
      ctx.peeks.get(op.target)?.delete(sessionId);
      return OK_VIS;
    }

    case 'reveal': {
      const piece = state.pieces.get(op.target);
      if (!piece) return fail('no piece');
      const zone = piece.zoneId ? state.zones.get(piece.zoneId) : undefined;
      if (zone?.ownerSeat !== undefined && zone.ownerSeat >= 0 && zone.ownerSeat !== ctx.seat) {
        return fail('not your card to reveal');
      }
      detachFromStack(state, piece);
      piece.faceUp = true;

      // Playing a card from your hand should put it where the game expects it. If the
      // pack has somewhere for played cards to go, use that; otherwise drop it onto the
      // open table in front of the player.
      const target = publicZone(state, 'discard') ?? publicZone(state, 'play');
      if (target) {
        piece.zoneId = target.id;
        piece.x = target.x;
        piece.z = target.z;
        piece.y = 0;
        relayoutZone(state, target.id);
      } else {
        piece.zoneId = '';
        piece.z = piece.z - 1.2;
      }
      pushLog(state, `${ctx.playerName(sessionId)} played a card.`);
      return OK_VIS;
    }

    case 'roll': {
      const piece = state.pieces.get(op.target);
      if (!piece) return fail('no piece');
      if (piece.kind !== 'die') return fail('not a die');
      const sides = ctx.sidesOf(piece.defId);
      const value = rollDie(sides);
      piece.secret.value = value;
      piece.faceUp = true;
      piece.rotY = Math.random() * Math.PI * 2;
      pushLog(state, `${ctx.playerName(sessionId)} rolled d${sides}: ${value}`);
      return OK_VIS;
    }

    default:
      return fail(`unsupported op`);
  }
}

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

/**
 * The nearest thing a dropped piece should join, or undefined to leave it loose.
 *
 * Considers both loose pieces and existing piles, and only ever matches the same kind,
 * so a chip never lands in the middle of a deck of cards.
 */
function nearestStackTarget(state: TableState, piece: Piece, x: number, z: number): Target | undefined {
  let best: Target | undefined;
  let bestDist = SNAP_RADIUS;

  // Proximity decides, not zone membership. Requiring an exact zone match looks correct
  // but is not: a pack-placed deck sits in no zone at all while a shared play area
  // covers the same patch of table, so dropping a card back on its own deck would never
  // merge. Anything this close is in the same place by any sensible reading.
  const privateElsewhere = (zoneId: string) => {
    if (zoneId === piece.zoneId) return false;
    const zone = state.zones.get(zoneId);
    return zone?.visibility === 'owner' || zone?.visibility === 'hidden';
  };

  state.stacks.forEach((stack) => {
    if (stack.id === piece.stackId) return;
    const top = state.pieces.get(stack.pieceIds[stack.pieceIds.length - 1]);
    if (!top || top.kind !== piece.kind) return;
    if (privateElsewhere(stack.zoneId)) return;
    const d = Math.hypot(stack.x - x, stack.z - z);
    if (d < bestDist) { bestDist = d; best = { kind: 'stack', obj: stack }; }
  });

  state.pieces.forEach((other) => {
    if (other.id === piece.id || other.stackId) return;
    if (other.kind !== piece.kind || other.heldBy) return;
    if (privateElsewhere(other.zoneId)) return;
    const d = Math.hypot(other.x - x, other.z - z);
    if (d < bestDist) { bestDist = d; best = { kind: 'piece', obj: other }; }
  });

  return best;
}

/** Put a loose piece on top of a pile, or start a new pile from two loose pieces. */
function mergeInto(state: TableState, piece: Piece, onto: Target): void {
  if (onto.kind === 'stack') {
    const stack = onto.obj as Stack;
    piece.stackId = stack.id;
    // The pile owns the zone; a card joining it belongs wherever the pile is.
    piece.zoneId = stack.zoneId;
    stack.pieceIds.push(piece.id);
    restackYs(state, stack.id);
    return;
  }
  const base = onto.obj as Piece;
  piece.zoneId = base.zoneId;
  makeStack(state, [base, piece], base.x, base.z, base.zoneId);
}

/** A shared zone by id, but only when it is one everybody can see into. */
function publicZone(state: TableState, id: string) {
  const zone = state.zones.get(id);
  return zone && zone.ownerSeat < 0 && zone.visibility !== 'hidden' ? zone : undefined;
}

type Target =
  | { kind: 'piece'; obj: Piece }
  | { kind: 'stack'; obj: Stack };

function resolve(state: TableState, id: string): Target | undefined {
  const piece = state.pieces.get(id);
  if (piece) return { kind: 'piece', obj: piece };
  const stack = state.stacks.get(id);
  if (stack) return { kind: 'stack', obj: stack };
  return undefined;
}

/** Pop the top piece off a stack, dissolving the stack if it runs out. */
function takeTop(state: TableState, stack: Stack): Piece | undefined {
  const id = stack.pieceIds[stack.pieceIds.length - 1];
  if (!id) return undefined;
  const piece = state.pieces.get(id);
  if (!piece) return undefined;
  detachFromStack(state, piece);
  return piece;
}

function moveIntoZone(state: TableState, piece: Piece, zoneId: string): void {
  const zone = state.zones.get(zoneId);
  piece.zoneId = zoneId;
  piece.stackId = '';
  piece.y = 0;
  if (zone) { piece.x = zone.x; piece.z = zone.z; }
  // Presentation follows the zone: a public zone shows faces, a hidden one does not.
  // The zone rule, not this flag, is what actually keeps a hand secret.
  if (zone?.visibility === 'owner' || zone?.visibility === 'public') piece.faceUp = true;
  else if (zone?.visibility === 'hidden') piece.faceUp = false;
}
