import type { ZoneDef } from '../types.js';

/** Table extents in world units. The felt is drawn to match. */
export const TABLE_W = 14;
export const TABLE_H = 9;

export const MAX_SEATS = 6;

/**
 * Private hand zones, one per seat, arranged around the table edge.
 *
 * The hand zone is the single most important shared primitive: a piece inside it is
 * known only to the owning seat. Every pack that has hidden information reuses these
 * rather than inventing its own.
 */
/** Where each seat sits around the rim: bottom, top, left, right, then the corners. */
export const SEAT_SPOTS: { x: number; z: number }[] = [
  { x: 0, z: TABLE_H / 2 - 0.9 },
  { x: 0, z: -TABLE_H / 2 + 0.9 },
  { x: -TABLE_W / 2 + 2.4, z: 0 },
  { x: TABLE_W / 2 - 2.4, z: 0 },
  { x: -TABLE_W / 2 + 2.4, z: TABLE_H / 2 - 2.2 },
  { x: TABLE_W / 2 - 2.4, z: -TABLE_H / 2 + 2.2 },
];

/**
 * A spot just inside a seat's hand zone, for per-seat furniture like chip banks.
 * `inset` of 0 is the hand position; 1 is the middle of the table.
 */
export function seatSpot(seat: number, inset = 0.3): { x: number; z: number } {
  const s = SEAT_SPOTS[seat % SEAT_SPOTS.length];
  return { x: s.x * (1 - inset), z: s.z * (1 - inset) };
}

export function handZones(seats: number): ZoneDef[] {
  const out: ZoneDef[] = [];
  const w = 4.2, h = 1.3;
  const spots = SEAT_SPOTS;
  for (let i = 0; i < Math.min(seats, spots.length); i++) {
    out.push({
      id: `hand${i}`,
      label: `Seat ${i + 1} hand`,
      ownerSeat: i,
      visibility: 'owner',
      x: spots[i].x, z: spots[i].z, w, h,
      layout: 'fan',
    });
  }
  return out;
}

/** A shared, face-up area in the middle of the table. */
export function playZone(id = 'play', label = 'Play area'): ZoneDef {
  return { id, label, ownerSeat: null, visibility: 'inherit', x: 0, z: 0, w: 8, h: 4, layout: 'free' };
}
