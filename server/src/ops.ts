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
import { publiclyKnown, type PeekGrants } from './visibility.js';

export interface OpContext {
  state: TableState;
  peeks: PeekGrants;
  sessionId: string;
  seat: number;
  /** Component metadata, used for things like how many sides a die has. */
  sidesOf: (defId: string) => number;
  /** Human label for a component, e.g. "Ace of Spades". Used only for public pieces. */
  labelOf: (defId: string) => string;
  playerName: (sessionId: string) => string;
  playerColor: (sessionId: string) => string;
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

/* ------------------------------------------------------------------ *
 * Log helpers
 *
 * The log is public state. Everything below is written on the assumption that a
 * spectator with no seat will read it, which is why identities go through
 * describePiece() rather than being read straight off the secret.
 * ------------------------------------------------------------------ */

type LogKind = 'move' | 'cards' | 'dice' | 'table' | 'rules' | 'presence';

/** The acting player, formatted for pushLog. */
function actor(ctx: OpContext, kind: LogKind) {
  return {
    name: ctx.playerName(ctx.sessionId),
    color: ctx.playerColor(ctx.sessionId),
    kind,
  };
}

/** Generic wording for a piece whose identity must not be spelled out. */
function genericName(kind: string): string {
  switch (kind) {
    case 'card': return 'a card';
    case 'chip': return 'a chip';
    case 'die': return 'a die';
    case 'tile': return 'a tile';
    case 'token': return 'a token';
    case 'piece': return 'a piece';
    default: return 'a piece';
  }
}

/**
 * How to name a piece in the log.
 *
 * Names the actual component only when its identity is already common knowledge; a
 * face-down card is always "a card", even to the player moving it. Writing the real
 * name here would leak the deck to everyone reading the log.
 */
function describePiece(ctx: OpContext, piece: Piece): string {
  if (!publiclyKnown(ctx.state, piece.id)) return genericName(piece.kind);
  const label = ctx.labelOf(piece.defId);
  return label ? `the ${label}` : genericName(piece.kind);
}

/** How to name a pile: its player-given name if it has one, else its size. */
function describeStack(stack: Stack): string {
  const n = stack.pieceIds?.length ?? 0;
  if (stack.label) return `“${stack.label}”`;
  return `a pile of ${n}`;
}

/** Where something ended up, for a move line. Zones have names; open table does not. */
function describePlace(state: TableState, zoneId: string): string {
  if (!zoneId) return 'the table';
  const zone = state.zones.get(zoneId);
  return zone ? (zone.label || zone.id) : 'the table';
}

/**
 * Whether a piece or pile is pinned down.
 *
 * Locking is deliberately enforced at the op layer rather than hidden in the client,
 * so a lock holds against every client, including a modified one.
 */
function lockedTarget(state: TableState, t: Target): boolean {
  if (t.kind === 'stack') return (t.obj as Stack).locked;
  const piece = t.obj as Piece;
  if (piece.locked) return true;
  // A card inside a locked pile inherits the pile's lock; otherwise a player could
  // peel the top card off a pinned deck one card at a time.
  if (piece.stackId) return !!state.stacks.get(piece.stackId)?.locked;
  return false;
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
      pushLog(state, `sat down in seat ${seat + 1}.`, actor(ctx, 'presence'));
      // Changing seat changes which private hand zones you can read.
      return OK_VIS;
    }

    case 'stand': {
      const player = state.players.get(sessionId);
      if (!player) return fail('no player');
      const was = player.seat;
      player.seat = -1;
      if (was >= 0) pushLog(state, `stood up from seat ${was + 1}.`, actor(ctx, 'presence'));
      return OK_VIS;
    }

    /* ---------------- holding and moving ---------------- */

    case 'grab': {
      const t = resolve(state, op.target);
      if (!t) return fail('no target');
      if (lockedTarget(state, t)) return fail('that is locked in place');
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
      if (lockedTarget(state, t)) return fail('that is locked in place');
      if (heldByOther(t.obj.heldBy, sessionId)) return fail('held by another player');
      t.obj.x = op.x;
      t.obj.z = op.z;
      if (sane(op.rotY)) t.obj.rotY = op.rotY!;
      if (t.kind === 'stack') restackYs(state, t.obj.id);
      return OK;
    }

    case 'rotate': {
      const t = resolve(state, op.target);
      if (!t) return fail('no target');
      if (lockedTarget(state, t)) return fail('that is locked in place');
      if (heldByOther(t.obj.heldBy, sessionId)) return fail('held by another player');
      const delta = Number(op.delta);
      if (!Number.isFinite(delta)) return fail('bad angle');
      // Kept in [0, 2pi) so the value never drifts off after a few hundred turns.
      const TAU = Math.PI * 2;
      t.obj.rotY = ((t.obj.rotY + delta) % TAU + TAU) % TAU;
      return OK;
    }

    case 'drop': {
      if (!sane(op.x) || !sane(op.z)) return fail('bad coords');
      const t = resolve(state, op.target);
      if (!t) return fail('no target');
      if (lockedTarget(state, t)) return fail('that is locked in place');
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

      // Only a landing that changes which region of the table something is in is worth
      // a line. Nudging a card around inside the same zone is not news, and logging it
      // would drown everything that is.
      if ((zone?.id ?? '') !== prevZone) {
        const what = t.kind === 'stack'
          ? describeStack(t.obj as Stack)
          : describePiece(ctx, t.obj as Piece);
        pushLog(
          state,
          `moved ${what} to ${describePlace(state, zone?.id ?? '')}.`,
          actor(ctx, 'move'),
        );
      }
      return OK_VIS;
    }

    /* ---------------- card actions ---------------- */

    case 'flip': {
      const t = resolve(state, op.target);
      if (!t) return fail('no target');
      if (lockedTarget(state, t)) return fail('that is locked in place');
      if (t.kind === 'piece') {
        const piece = t.obj as Piece;
        piece.faceUp = !piece.faceUp;
        // Read the name AFTER the flip: turning a card face up makes it public, and
        // that is exactly the moment the log is allowed to say what it is.
        const what = describePiece(ctx, piece);
        pushLog(
          state,
          piece.faceUp ? `turned ${what} face up.` : `turned ${what} face down.`,
          actor(ctx, 'cards'),
        );
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
        pushLog(
          state,
          `turned ${describeStack(stack)} over (${stack.pieceIds.length} cards).`,
          actor(ctx, 'cards'),
        );
      }
      return OK_VIS;
    }

    case 'shuffle': {
      const stack = state.stacks.get(op.stackId);
      if (!stack) return fail('no stack');
      if (stack.locked) return fail('that pile is locked');
      if (heldByOther(stack.heldBy, sessionId)) return fail('held by another player');
      const ids = shuffleInPlace([...stack.pieceIds]);
      replaceIds(stack.pieceIds, ids);
      // Shuffling revokes every peek on those cards — nobody remembers a shuffled deck.
      for (const pid of ids) ctx.peeks.delete(pid);
      restackYs(state, stack.id);
      pushLog(state, `shuffled ${describeStack(stack)} (${ids.length} cards).`, actor(ctx, 'cards'));
      return OK_VIS;
    }

    case 'draw': {
      const stack = state.stacks.get(op.stackId);
      if (!stack) return fail('no stack');
      if (stack.locked) return fail('that pile is locked');
      const zone = state.zones.get(op.toZoneId);
      if (!zone) return fail('no zone');
      if (zone.ownerSeat >= 0 && zone.ownerSeat !== ctx.seat) return fail('not your zone');
      // Drawing several at once is the same op repeated; the cap matches `deal`.
      const want = Math.max(1, Math.min(20, Math.floor(Number(op.count) || 1)));
      let drawn = 0;
      for (let i = 0; i < want; i++) {
        const piece = takeTop(state, stack);
        if (!piece) break;
        moveIntoZone(state, piece, zone.id);
        drawn++;
      }
      if (drawn === 0) return fail('stack empty');
      relayoutZone(state, zone.id);
      pushLog(
        state,
        `drew ${drawn} card${drawn === 1 ? '' : 's'} from ${describeStack(stack)} into ${describePlace(state, zone.id)}.`,
        actor(ctx, 'cards'),
      );
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
      const where = zoneIds.length === 1
        ? describePlace(state, zoneIds[0])
        : `${zoneIds.length} hands`;
      pushLog(
        state,
        `dealt ${dealt} card${dealt === 1 ? '' : 's'} to ${where}.`,
        actor(ctx, 'cards'),
      );
      return OK_VIS;
    }

    case 'stackOnto': {
      if (op.target === op.ontoId) return fail('cannot stack onto itself');
      const src = resolve(state, op.target);
      const dst = resolve(state, op.ontoId);
      if (!src || !dst) return fail('no target');
      if (lockedTarget(state, src) || lockedTarget(state, dst)) return fail('that is locked in place');
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
      pushLog(
        state,
        `put ${moving.length} ${moving.length === 1 ? 'piece' : 'pieces'} onto a pile.`,
        actor(ctx, 'cards'),
      );
      return OK_VIS;
    }

    case 'unstack': {
      const stack = state.stacks.get(op.stackId);
      if (!stack) return fail('no stack');
      if (stack.locked) return fail('that pile is locked');
      if (!sane(op.x) || !sane(op.z)) return fail('bad coords');
      const count = Math.max(1, Math.min(stack.pieceIds.length, Math.floor(Number(op.count) || 1)));
      const from = describeStack(stack);
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
      // A single card peeled off during a drag is the commonest gesture on the table;
      // logging every one of those buries everything else, so only splits are recorded.
      if (taken.length > 1) {
        pushLog(state, `took ${taken.length} cards off ${from}.`, actor(ctx, 'cards'));
      }
      return OK_VIS;
    }

    /* ---------------- naming and locking ---------------- */

    case 'setStackTag': {
      const stack = state.stacks.get(op.stackId);
      if (!stack) return fail('no stack');
      // Same treatment as chat: this is untrusted text every client will render.
      const clean = (v: unknown, max: number) => String(v ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .trim()
        .slice(0, max);
      if (op.label !== undefined) stack.label = clean(op.label, 32);
      if (op.tag !== undefined) stack.tag = clean(op.tag, 24);
      pushLog(
        state,
        stack.label ? `named a pile “${stack.label}”.` : 'cleared a pile’s name.',
        actor(ctx, 'table'),
      );
      return OK;
    }

    case 'setLock': {
      const t = resolve(state, op.target);
      if (!t) return fail('no target');
      const locked = Boolean(op.locked);
      if (t.kind === 'stack') (t.obj as Stack).locked = locked;
      else (t.obj as Piece).locked = locked;
      // Locking something someone is holding would strand it in mid-air.
      if (locked) t.obj.heldBy = '';
      const what = t.kind === 'stack'
        ? describeStack(t.obj as Stack)
        : describePiece(ctx, t.obj as Piece);
      pushLog(
        state,
        locked ? `locked ${what} in place.` : `unlocked ${what}.`,
        actor(ctx, 'table'),
      );
      return OK;
    }

    /* ---------------- information ---------------- */

    case 'setAutoStack': {
      state.autoStack = Boolean(op.on);
      pushLog(
        state,
        `turned ${state.autoStack ? 'on' : 'off'} snapping into piles.`,
        actor(ctx, 'table'),
      );
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
      pushLog(state, 'peeked at a card.', actor(ctx, 'cards'));
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
      pushLog(
        state,
        `played ${describePiece(ctx, piece)} to ${describePlace(state, piece.zoneId)}.`,
        actor(ctx, 'cards'),
      );
      return OK_VIS;
    }

    case 'roll': {
      const piece = state.pieces.get(op.target);
      if (!piece) return fail('no piece');
      if (piece.kind !== 'die') return fail('not a die');
      if (piece.locked) return fail('that die is locked in place');
      const sides = ctx.sidesOf(piece.defId);
      const value = rollDie(sides);
      piece.secret.value = value;
      piece.faceUp = true;
      piece.rotY = Math.random() * Math.PI * 2;
      pushLog(state, `rolled a d${sides} and got ${value}.`, actor(ctx, 'dice'));
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
