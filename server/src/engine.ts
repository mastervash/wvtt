/**
 * The sandbox engine.
 *
 * Layer 0 of the architecture: it knows how to build a table from a pack and how to
 * apply physical operations to it. It has no notion of turns, legality or winning —
 * that is the script layer's business. Nothing here can be bypassed by a script,
 * which is why hidden information stays safe even when a pack's script is hostile.
 */

import type { GamePack, ComponentDef, PlacementDef } from '@wvtt/shared';
import { standardDeck } from '@wvtt/shared';
import type { ArraySchema } from '@colyseus/schema';
import { TableState, Piece, Stack, Zone, Secret, LogEntry } from './state.js';
import { makeId, shuffleInPlace, rollDie } from './rng.js';

/** Vertical thickness used when stacking pieces of a given kind. */
const KIND_THICKNESS: Record<string, number> = {
  card: 0.006, chip: 0.045, tile: 0.05, token: 0.12, piece: 0.4, die: 0.3, note: 0.002,
};

export function thicknessOf(kind: string): number {
  return KIND_THICKNESS[kind] ?? 0.02;
}

/* ------------------------------------------------------------------ *
 * Pack -> table
 * ------------------------------------------------------------------ */

/**
 * Resolve a placement's component list into concrete component ids.
 *
 * Supports two shorthands so packs stay readable:
 *   "deck:standard52"  - the 52-card deck in canonical order
 *   "repeat:d6:6"      - six copies of component d6
 */
export function expandComponentIds(spec: string[], pack: GamePack, defs?: Map<string, ComponentDef>): string[] {
  const out: string[] = [];
  for (const raw of spec) {
    if (raw === 'deck:standard52') {
      out.push(...standardDeck(false).map((c) => c.id));
      continue;
    }
    if (raw === 'deck:standard54') {
      out.push(...standardDeck(true).map((c) => c.id));
      continue;
    }
    if (raw.startsWith('repeat:')) {
      const [, id, countRaw] = raw.split(':');
      const count = Math.max(0, Math.min(200, parseInt(countRaw ?? '1', 10) || 0));
      for (let i = 0; i < count; i++) out.push(id);
      continue;
    }
    out.push(raw);
  }
  // Drop anything with no definition behind it, rather than creating a piece with no
  // artwork and no data.
  const known = defs ?? componentMap(pack);
  return out.filter((id) => known.has(id));
}

/**
 * Every component the pack can place, including ones it did not define itself.
 *
 * A pack that uses the "deck:standard52" shorthand should not also have to paste 52
 * component definitions in to describe a deck of cards that the app already knows how
 * to draw. Any standard card the pack does not define is supplied here, while a pack
 * that DOES define a card of its own keeps its version.
 */
function componentMap(pack: GamePack): Map<string, ComponentDef> {
  const map = new Map(pack.components.map((c) => [c.id, c]));

  const usesStandardDeck = pack.setup.some((step) =>
    step.componentIds.some((id) => id === 'deck:standard52' || id === 'deck:standard54'));
  if (usesStandardDeck) {
    for (const def of standardDeck(true)) {
      if (!map.has(def.id)) map.set(def.id, def);
    }
  }
  return map;
}

function newPiece(def: ComponentDef, faceUp: boolean): Piece {
  const p = new Piece();
  p.id = makeId('p');
  p.kind = def.kind;
  p.defId = def.id;
  p.x = 0; p.y = 0; p.z = 0;
  p.rotY = 0;
  p.faceUp = faceUp;
  p.stackId = '';
  p.order = 0;
  p.zoneId = '';
  p.heldBy = '';
  const s = new Secret();
  s.face = def.face ?? def.id;
  s.value = def.kind === 'die' ? rollDie(def.sides ?? 6) : 0;
  p.secret = s;
  return p;
}

/** Wipe the table and rebuild it from a pack. */
export function buildTable(state: TableState, pack: GamePack, occupiedSeats: number[]): void {
  state.pieces.clear();
  state.stacks.clear();
  state.zones.clear();

  state.packId = pack.manifest.id;
  state.packName = pack.manifest.name;
  state.enforcement = pack.manifest.defaultEnforcement;
  state.tableColor = pack.manifest.tableColor ?? '#1f6f4a';
  state.maxSeats = pack.manifest.maxSeats;
  state.packRevision = state.packRevision + 1;

  for (const z of pack.zones) {
    const zone = new Zone();
    zone.id = z.id;
    zone.label = z.label;
    zone.ownerSeat = z.ownerSeat ?? -1;
    zone.visibility = z.visibility;
    zone.x = z.x; zone.z = z.z; zone.w = z.w; zone.h = z.h;
    zone.layout = z.layout;
    zone.gridCols = z.gridCols ?? 0;
    zone.gridRows = z.gridRows ?? 0;
    zone.checkered = z.checkered ?? false;
    state.zones.set(zone.id, zone);
  }

  const defs = componentMap(pack);
  // A placement marked perSeat runs once per seated player, with {seat} substituted.
  for (const placement of pack.setup) {
    const seats = placement.perSeat ? (occupiedSeats.length ? occupiedSeats : [0]) : [null];
    for (const seat of seats) applyPlacement(state, pack, defs, placement, seat);
  }
}

function applyPlacement(
  state: TableState,
  pack: GamePack,
  defs: Map<string, ComponentDef>,
  placement: PlacementDef,
  seat: number | null,
): void {
  const ids = expandComponentIds(placement.componentIds, pack, defs);
  if (ids.length === 0) return;

  const zoneId = placement.zoneId
    ? (seat !== null ? placement.zoneId.replace('{seat}', String(seat)) : placement.zoneId)
    : '';
  const zone = zoneId ? state.zones.get(zoneId) : undefined;
  const baseX = zone ? zone.x + placement.x : placement.x;
  const baseZ = zone ? zone.z + placement.z : placement.z;

  const pieces = ids.map((id) => {
    const def = defs.get(id)!;
    return newPiece(def, placement.faceUp);
  });
  if (placement.shuffled) shuffleInPlace(pieces);

  if (placement.as === 'stack') {
    const stack = new Stack();
    stack.id = makeId('s');
    stack.x = baseX; stack.y = 0; stack.z = baseZ;
    stack.rotY = 0;
    stack.zoneId = zoneId;
    stack.heldBy = '';
    pieces.forEach((p, i) => {
      p.stackId = stack.id;
      p.order = i;
      p.zoneId = zoneId;
      p.x = baseX; p.z = baseZ;
      p.y = i * thicknessOf(p.kind);
      state.pieces.set(p.id, p);
      stack.pieceIds.push(p.id);
    });
    state.stacks.set(stack.id, stack);
    return;
  }

  const cols = placement.gridCols ?? Math.ceil(Math.sqrt(pieces.length));
  pieces.forEach((p, i) => {
    if (placement.as === 'grid') {
      p.x = baseX + (i % cols) * 0.5;
      p.z = baseZ + Math.floor(i / cols) * 0.5;
    } else {
      // 'loose': fan them out slightly so a pile of dice is not one invisible cube.
      p.x = baseX + (pieces.length > 1 ? (i - (pieces.length - 1) / 2) * 0.42 : 0);
      p.z = baseZ;
    }
    p.y = 0;
    p.zoneId = zoneId;
    state.pieces.set(p.id, p);
  });
}

/**
 * Run a pack's per-seat placements for one seat.
 *
 * Per-seat setup runs at table build time for whoever is already seated, but people
 * arrive after the table opens. Without this, the second player to sit down at a poker
 * table gets no chips. Placements are skipped when the seat's zone already holds
 * pieces, so sitting down twice does not double anyone's stack.
 */
export function applySeatSetup(state: TableState, pack: GamePack, seat: number): boolean {
  const perSeat = pack.setup.filter((p) => p.perSeat);
  if (perSeat.length === 0) return false;

  const defs = componentMap(pack);
  let placed = false;

  for (const placement of perSeat) {
    const zoneId = placement.zoneId?.replace('{seat}', String(seat)) ?? '';
    if (zoneId) {
      let occupied = false;
      state.pieces.forEach((p) => { if (p.zoneId === zoneId) occupied = true; });
      if (occupied) continue;
    }
    applyPlacement(state, pack, defs, placement, seat);
    placed = true;
  }
  return placed;
}

/* ------------------------------------------------------------------ *
 * Geometry helpers
 * ------------------------------------------------------------------ */

export function zoneAt(state: TableState, x: number, z: number): Zone | undefined {
  let found: Zone | undefined;
  state.zones.forEach((zone) => {
    if (found) return;
    if (
      x >= zone.x - zone.w / 2 && x <= zone.x + zone.w / 2 &&
      z >= zone.z - zone.h / 2 && z <= zone.z + zone.h / 2
    ) found = zone;
  });
  return found;
}

/** Snap a point to the centre of the nearest cell of a grid zone. */
export function snapToGrid(zone: Zone, x: number, z: number): { x: number; z: number } {
  if (zone.layout !== 'grid' || zone.gridCols <= 0 || zone.gridRows <= 0) return { x, z };
  const cw = zone.w / zone.gridCols;
  const ch = zone.h / zone.gridRows;
  const left = zone.x - zone.w / 2;
  const top = zone.z - zone.h / 2;
  const col = Math.min(zone.gridCols - 1, Math.max(0, Math.floor((x - left) / cw)));
  const row = Math.min(zone.gridRows - 1, Math.max(0, Math.floor((z - top) / ch)));
  return { x: left + col * cw + cw / 2, z: top + row * ch + ch / 2 };
}

/** Re-flow the pieces of a zone that lays its contents out automatically. */
export function relayoutZone(state: TableState, zoneId: string): void {
  const zone = state.zones.get(zoneId);
  if (!zone) return;
  if (zone.layout !== 'fan' && zone.layout !== 'row') return;

  const members: Piece[] = [];
  state.pieces.forEach((p) => {
    if (p.zoneId === zoneId && !p.stackId) members.push(p);
  });
  members.sort((a, b) => a.order - b.order || a.x - b.x);

  const n = members.length;
  if (n === 0) return;
  const spacing = Math.min(0.55, (zone.w - 0.7) / Math.max(1, n - 1 || 1));
  members.forEach((p, i) => {
    p.x = zone.x + (n > 1 ? (i - (n - 1) / 2) * spacing : 0);
    p.z = zone.z;
    p.y = 0.001 * i;
    p.order = i;
    // A fanned hand tilts each card a little, like holding it.
    p.rotY = zone.layout === 'fan' && n > 1 ? (i - (n - 1) / 2) * 0.06 : 0;
  });
}

/* ------------------------------------------------------------------ *
 * Stack helpers
 * ------------------------------------------------------------------ */

/**
 * Replace the contents of a synced array.
 *
 * ArraySchema#splice() tracks deletions in an internal index map that is only reset
 * when the state is encoded. Several splices between two encodes therefore compute
 * stale indices and log "trying to delete non-existing index 'undefined'", silently
 * desyncing clients. clear() + push() has no such bookkeeping, so all stack edits go
 * through here instead.
 */
export function replaceIds(target: ArraySchema<string>, ids: string[]): void {
  target.clear();
  for (const id of ids) target.push(id);
}

/** Remove one id from a synced array, preferring pop() when it is the last element. */
export function removeId(target: ArraySchema<string>, id: string): void {
  const last = target.length - 1;
  if (last >= 0 && target[last] === id) {
    target.pop();
    return;
  }
  replaceIds(target, Array.from(target).filter((x) => x !== id));
}


export function restackYs(state: TableState, stackId: string): void {
  const stack = state.stacks.get(stackId);
  if (!stack) return;
  stack.pieceIds.forEach((pid, i) => {
    const p = state.pieces.get(pid);
    if (!p) return;
    p.order = i;
    p.x = stack.x;
    p.z = stack.z;
    p.y = i * thicknessOf(p.kind);
    p.zoneId = stack.zoneId;
  });
}

/** Remove a piece from whatever stack holds it, dissolving stacks that empty out. */
export function detachFromStack(state: TableState, piece: Piece): void {
  if (!piece.stackId) return;
  const stack = state.stacks.get(piece.stackId);
  piece.stackId = '';
  if (!stack) return;
  removeId(stack.pieceIds, piece.id);
  if (stack.pieceIds.length === 0) {
    state.stacks.delete(stack.id);
  } else if (stack.pieceIds.length === 1) {
    // A one-card stack is just a card. Collapse it so the table stays tidy.
    const lone = state.pieces.get(stack.pieceIds[0]);
    if (lone) {
      lone.stackId = '';
      lone.x = stack.x;
      lone.z = stack.z;
      lone.y = 0;
    }
    state.stacks.delete(stack.id);
  } else {
    restackYs(state, stack.id);
  }
}

/** Create a stack from an ordered list of loose pieces (bottom first). */
export function makeStack(state: TableState, pieces: Piece[], x: number, z: number, zoneId: string): Stack {
  const stack = new Stack();
  stack.id = makeId('s');
  stack.x = x; stack.y = 0; stack.z = z;
  stack.rotY = 0;
  stack.zoneId = zoneId;
  stack.heldBy = '';
  for (const p of pieces) {
    p.stackId = stack.id;
    stack.pieceIds.push(p.id);
  }
  state.stacks.set(stack.id, stack);
  restackYs(state, stack.id);
  return stack;
}

export function pushLog(state: TableState, text: string): void {
  const entry = new LogEntry();
  entry.id = makeId('l');
  entry.text = text;
  entry.at = Date.now();
  state.log.push(entry);
  // Keep the log bounded; it is a feed, not an audit trail.
  while (state.log.length > 60) state.log.shift();
}
