/**
 * Host implementations of the `table.*` methods a pack script can call.
 *
 * Each function receives already-parsed JSON arguments and returns JSON-safe values.
 * They mutate the authoritative state directly, then flag that visibility needs
 * recomputing — a script that deals a card must not be able to skip the filter pass
 * that decides who may see it.
 */

import type { TableState, Piece } from '../state.js';
import { detachFromStack, makeStack, relayoutZone, replaceIds, restackYs, pushLog } from '../engine.js';
import { shuffleInPlace } from '../rng.js';
import type { HostFn } from './host.js';

export interface ApiDeps {
  state: TableState;
  vars: Map<string, unknown>;
  /** Called whenever a script mutation could change who can see what. */
  markVisibilityDirty: () => void;
}

const asString = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const asInt = (v: unknown, fallback = 0): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : fallback;
};

export function buildScriptApi(deps: ApiDeps): Record<string, HostFn> {
  const { state, vars, markVisibilityDirty } = deps;

  /** The biggest pile, which is what a script means by "the deck" when unqualified. */
  function mainStackId(): string | null {
    let bestId: string | null = null;
    let bestCount = -1;
    state.stacks.forEach((s, id) => {
      if (s.pieceIds.length > bestCount) { bestId = id; bestCount = s.pieceIds.length; }
    });
    return bestId;
  }

  function resolveStack(arg: unknown) {
    if (typeof arg === 'string' && arg) {
      const named = state.stacks.get(arg);
      if (named) return named;
      // Packs often refer to "deck" by name; fall back rather than failing silently.
    }
    const id = mainStackId();
    return id ? state.stacks.get(id) : undefined;
  }

  function takeTop(stackId: string): Piece | undefined {
    const stack = state.stacks.get(stackId);
    if (!stack) return undefined;
    const id = stack.pieceIds[stack.pieceIds.length - 1];
    if (!id) return undefined;
    const piece = state.pieces.get(id);
    if (!piece) return undefined;
    detachFromStack(state, piece);
    return piece;
  }

  function placeInZone(piece: Piece, zoneId: string) {
    const zone = state.zones.get(zoneId);
    piece.zoneId = zoneId;
    piece.stackId = '';
    piece.y = 0;
    if (zone) {
      piece.x = zone.x;
      piece.z = zone.z;
      // Presentation follows the zone; see the matching rule in ops.ts.
      if (zone.visibility === 'owner' || zone.visibility === 'public') piece.faceUp = true;
      else if (zone.visibility === 'hidden') piece.faceUp = false;
    }
  }

  function dealCards(zoneId: string, count: number): number {
    const stackId = mainStackId();
    if (!stackId) return 0;
    let dealt = 0;
    for (let i = 0; i < Math.max(0, Math.min(52, count)); i++) {
      const piece = takeTop(stackId);
      if (!piece) break;
      placeInZone(piece, zoneId);
      dealt++;
    }
    relayoutZone(state, zoneId);
    markVisibilityDirty();
    return dealt;
  }

  return {
    /* ---------------- reads ---------------- */

    seats: () => {
      const out: number[] = [];
      state.players.forEach((p) => { if (p.seat >= 0) out.push(p.seat); });
      return out.sort((a, b) => a - b);
    },

    players: () => {
      const out: { seat: number; name: string; connected: boolean }[] = [];
      state.players.forEach((p) => out.push({ seat: p.seat, name: p.name, connected: p.connected }));
      return out;
    },

    zones: () => {
      const out: { id: string; label: string; ownerSeat: number; visibility: string; layout: string }[] = [];
      state.zones.forEach((z) => out.push({
        id: z.id, label: z.label, ownerSeat: z.ownerSeat, visibility: z.visibility, layout: z.layout,
      }));
      return out;
    },

    piecesIn: (args) => {
      const zoneId = asString(args[0]);
      const out: {
        id: string; defId: string; face: string; value: number;
        faceUp: boolean; order: number; x: number; z: number;
      }[] = [];
      state.pieces.forEach((p) => {
        if (p.zoneId !== zoneId) return;
        // Coordinates are included so scripts can enforce games played on a grid;
        // a chess validator cannot work without knowing where the pieces stand.
        out.push({
          id: p.id, defId: p.defId, face: p.secret.face, value: p.secret.value,
          faceUp: p.faceUp, order: p.order, x: p.x, z: p.z,
        });
      });
      return out.sort((a, b) => a.order - b.order);
    },

    stacks: () => {
      const out: { id: string; count: number; zoneId: string }[] = [];
      state.stacks.forEach((s, id) => out.push({ id, count: s.pieceIds.length, zoneId: s.zoneId }));
      return out;
    },

    /* ---------------- variables ---------------- */

    getVar: (args) => vars.get(asString(args[0])) ?? null,

    setVar: (args) => {
      const key = asString(args[0]);
      if (!key) return null;
      // Bound both the number of variables and their size; a script should not be able
      // to use the room as unbounded storage.
      if (!vars.has(key) && vars.size >= 200) throw new Error('Too many table variables (limit 200).');
      const value = args[1];
      const encoded = JSON.stringify(value ?? null);
      if (encoded.length > 8192) throw new Error('Table variable is too large (limit 8 KB).');
      vars.set(key, value ?? null);
      return null;
    },

    /* ---------------- writes ---------------- */

    log: (args) => {
      pushLog(state, asString(args[0]).slice(0, 200));
      return null;
    },

    status: (args) => {
      state.status = asString(args[0]).slice(0, 80);
      return null;
    },

    shuffle: (args) => {
      const stack = resolveStack(args[0]);
      if (!stack) return 0;
      const ids = shuffleInPlace([...stack.pieceIds]);
      replaceIds(stack.pieceIds, ids);
      restackYs(state, stack.id);
      markVisibilityDirty();
      return ids.length;
    },

    dealTo: (args) => dealCards(`hand${asInt(args[0])}`, asInt(args[1], 1)),

    dealToZone: (args) => dealCards(asString(args[0]), asInt(args[1], 1)),

    burn: (args) => {
      const stack = resolveStack(args[0]);
      if (!stack) return null;
      const piece = takeTop(stack.id);
      if (!piece) return null;
      // A burnt card goes face down into the muck if the pack has one.
      const muck = state.zones.get('muck') ?? state.zones.get('discard');
      piece.faceUp = false;
      if (muck) placeInZone(piece, muck.id);
      else { piece.zoneId = ''; piece.x = 6; piece.z = -3; }
      markVisibilityDirty();
      return piece.id;
    },

    recallAll: (args) => {
      const target = resolveStack(args[0]);

      // Only gather pieces of the same kind as the pile itself. Without this, calling
      // recallAll("deck") in a poker script sweeps every chip and the dealer button
      // into the deck and shuffles them in with the cards.
      const wanted = new Set<string>();
      if (target) {
        for (const pid of target.pieceIds) {
          const kind = state.pieces.get(pid)?.kind;
          if (kind) wanted.add(kind);
        }
      }
      if (wanted.size === 0) wanted.add('card');

      const loose: Piece[] = [];
      state.pieces.forEach((p) => {
        if (target && p.stackId === target.id) return;
        if (!wanted.has(p.kind)) return;
        loose.push(p);
      });
      for (const p of loose) {
        detachFromStack(state, p);
        p.faceUp = false;
        p.zoneId = '';
        p.heldBy = '';
      }
      const zonesToRelayout = new Set<string>();
      state.zones.forEach((z) => zonesToRelayout.add(z.id));

      if (target) {
        for (const p of loose) { p.stackId = target.id; target.pieceIds.push(p.id); }
        restackYs(state, target.id);
      } else if (loose.length > 0) {
        makeStack(state, loose, 0, 0, '');
      }
      for (const z of zonesToRelayout) relayoutZone(state, z);
      markVisibilityDirty();
      return loose.length;
    },

    moveTo: (args) => {
      const piece = state.pieces.get(asString(args[0]));
      if (!piece) return null;
      const zoneId = asString(args[1]);
      detachFromStack(state, piece);
      placeInZone(piece, zoneId);
      relayoutZone(state, zoneId);
      markVisibilityDirty();
      return piece.id;
    },

    flip: (args) => {
      const piece = state.pieces.get(asString(args[0]));
      if (!piece) return null;
      piece.faceUp = Boolean(args[1]);
      markVisibilityDirty();
      return piece.faceUp;
    },
  };
}
