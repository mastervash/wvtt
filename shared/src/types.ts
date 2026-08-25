/**
 * Core vocabulary shared by client and server.
 *
 * The engine knows about four things and nothing else:
 *   Piece  - one physical item on the table (a card, chip, die, token, pawn...)
 *   Stack  - an ordered pile of Pieces at a position (a deck, a discard pile, a chip stack)
 *   Zone   - a region of the table that carries VISIBILITY rules
 *   Seat   - a player's place at the table
 *
 * Every game, built-in or user-authored, is expressed in these terms. There are no
 * card-specific or chess-specific concepts below this line.
 */

/** Render hint. Affects mesh/geometry only, never rules. */
export type PieceKind =
  | 'card'   // flat rectangle, has two faces
  | 'chip'   // short cylinder, stacks densely
  | 'die'    // cube/polyhedron, has a rolled value
  | 'token'  // flat disc or meeple, single-sided
  | 'piece'  // 3D game piece (pawn, king)
  | 'tile'   // flat square with a face, may stand upright in a rack
  | 'note';  // text label / scribble on the table

/**
 * Who is allowed to know a piece's identity.
 *
 * This is the single most important type in the codebase: it is the input to the
 * per-client state filter. Get this wrong and players can read the deck.
 */
export type Visibility =
  | { mode: 'public' }                    // everyone knows it (face-up on the table)
  | { mode: 'hidden' }                    // nobody knows it (face-down in a deck)
  | { mode: 'seats'; seats: number[] };   // only these seats know it (a hand, a peek)

/** How a zone treats the pieces inside it. */
export type ZoneVisibility =
  | 'public'      // contents face-up to all (a shared river, a play area)
  | 'owner'       // contents known only to the owning seat (a private hand)
  | 'hidden'      // contents known to nobody (a face-down deck's home)
  | 'inherit';    // pieces keep whatever visibility they already had

export interface ZoneDef {
  id: string;
  label: string;
  /** Seat index that owns this zone, or null for a shared zone. */
  ownerSeat: number | null;
  visibility: ZoneVisibility;
  /** Rectangle on the table plane, in table units. */
  x: number; z: number; w: number; h: number;
  /** Snap pieces dropped here into a tidy row/grid instead of leaving them loose. */
  layout: 'free' | 'row' | 'fan' | 'grid' | 'stack';
  /** Grid dimensions, only meaningful when layout === 'grid'. */
  gridCols?: number; gridRows?: number;
  /** Draw alternating light and dark squares, as on a chess or draughts board. */
  checkered?: boolean;
}

/** The identity of a piece — the part that must be hidden. */
export interface PieceSecret {
  /** Pack-defined identity key, e.g. "AS" for ace of spades, "wp" for white pawn. */
  face: string;
  /** Rolled value for dice; ignored for other kinds. */
  value?: number;
}

export interface PieceState {
  id: string;
  kind: PieceKind;
  /** Which component definition in the pack this piece came from. */
  defId: string;
  x: number; y: number; z: number;
  rotY: number;
  faceUp: boolean;
  /** Stack this piece belongs to, or null when loose on the table. */
  stackId: string | null;
  /** Position within its stack; 0 is the bottom. */
  order: number;
  zoneId: string | null;
  /** Session id of the player currently dragging it, or null. */
  heldBy: string | null;
}

export interface StackState {
  id: string;
  x: number; y: number; z: number;
  rotY: number;
  zoneId: string | null;
  /** Piece ids, bottom first. */
  pieceIds: string[];
  heldBy: string | null;
}

export type Enforcement = 'off' | 'advisory' | 'enforced';

/* ------------------------------------------------------------------ *
 * Client -> server operations
 *
 * These are REQUESTS, not commands. The server validates every one of them
 * against the sandbox rules and (when enforcement is on) the pack script.
 * ------------------------------------------------------------------ */

export type Op =
  | { t: 'grab'; target: string }
  | { t: 'release'; target: string }
  | { t: 'move'; target: string; x: number; z: number; rotY?: number }
  | { t: 'flip'; target: string }
  | { t: 'drop'; target: string; zoneId: string | null; x: number; z: number }
  | { t: 'shuffle'; stackId: string }
  | { t: 'deal'; stackId: string; count: number; toZoneIds: string[] }
  | { t: 'draw'; stackId: string; toZoneId: string }
  | { t: 'stackOnto'; target: string; ontoId: string }
  | { t: 'unstack'; stackId: string; count: number; x: number; z: number }
  | { t: 'peek'; target: string }
  | { t: 'unpeek'; target: string }
  | { t: 'reveal'; target: string }
  | { t: 'roll'; target: string }
  | { t: 'sit'; seat: number }
  | { t: 'stand' }
  | { t: 'rename'; name: string }
  | { t: 'pointer'; x: number; z: number }
  | { t: 'setEnforcement'; mode: Enforcement }
  | { t: 'setAutoStack'; on: boolean }
  | { t: 'chat'; text: string }
  /* ---- game clock ---- */
  | { t: 'clockConfig'; baseMs: number; incrementMs: number; mode: 'auto' | 'manual' }
  | { t: 'clockStart' }
  | { t: 'clockPause' }
  /** Manual mode: end my turn and start the next player's clock. */
  | { t: 'clockPress' }
  | { t: 'clockReset' }
  | { t: 'clockOff' }
  | { t: 'loadPack'; packJson: string }
  | { t: 'resetTable' }
  | { t: 'scriptAction'; action: string; payload?: unknown };

export interface PlayerInfo {
  sessionId: string;
  name: string;
  color: string;
  seat: number;      // -1 when spectating
  connected: boolean;
}
