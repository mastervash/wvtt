/**
 * Game Pack format.
 *
 * A pack is pure data plus an optional script. Chess, poker and the card games that
 * ship with the app are authored in exactly this format — there is no privileged
 * built-in path. If a built-in game needs a capability, the format gains it and every
 * user-authored pack gains it too.
 *
 * A pack serialises to one JSON blob so it can be exported as a share string or a
 * .wvtt file and pasted into any room.
 */

import type { PieceKind, ZoneDef, Enforcement } from './types.js';

export const PACK_FORMAT_VERSION = 1;

/** How a component's faces get their artwork. */
export type FaceSource =
  /** Draw the face procedurally. Used by the standard deck so we ship no card art. */
  | { type: 'generated'; generator: 'playing-card' | 'chip' | 'die' | 'chess' | 'blank'; params?: Record<string, string | number> }
  /** Render text on a plain background. Powers custom prompt/answer decks. */
  | { type: 'text'; text: string; bg?: string; fg?: string; fontScale?: number }
  /** A data: URI supplied by the pack author. Kept small; validated on import. */
  | { type: 'image'; dataUri: string };

/** A kind of piece the pack can place on the table, e.g. "ace of spades". */
export interface ComponentDef {
  id: string;
  kind: PieceKind;
  label: string;
  /** Identity key used by scripts, e.g. "AS". Defaults to id. */
  face?: string;
  front: FaceSource;
  back?: FaceSource;
  /** Physical size in table units. Sensible per-kind defaults apply when omitted. */
  w?: number; h?: number; d?: number;
  /** Number of faces for dice. */
  sides?: number;
  /** Free-form data the script can read, e.g. { suit: "spades", rank: 14 }. */
  data?: Record<string, string | number | boolean>;
}

/** Instructions for putting components on the table at setup time. */
export interface PlacementDef {
  /** Component ids to instantiate. Supports "deck:standard52" style expansions. */
  componentIds: string[];
  /** Put them in a stack (a deck) or lay them out individually. */
  as: 'stack' | 'loose' | 'grid';
  zoneId: string | null;
  x: number; z: number;
  faceUp: boolean;
  shuffled: boolean;
  gridCols?: number;
  /** Repeat the whole placement once per occupied seat, substituting {seat}. */
  perSeat?: boolean;
}

export interface PackManifest {
  formatVersion: number;
  id: string;
  name: string;
  author: string;
  description: string;
  /** Minimum and maximum players the pack expects. Solo play is always allowed. */
  minSeats: number;
  maxSeats: number;
  /** What the room's enforcement toggle defaults to when this pack loads. */
  defaultEnforcement: Enforcement;
  /** Table felt colour. */
  tableColor?: string;
  /**
   * Buttons shown to players, each dispatching onAction(table, id) in the script.
   * Without these a script's onAction handlers are unreachable from the UI.
   */
  actions?: { id: string; label: string }[];
}

export interface GamePack {
  manifest: PackManifest;
  components: ComponentDef[];
  zones: ZoneDef[];
  setup: PlacementDef[];
  /**
   * Optional rules script, sandboxed JavaScript. Runs SERVER-SIDE ONLY inside a
   * QuickJS WASM isolate with a memory cap, an instruction budget and no host
   * bindings whatsoever — no network, no filesystem, no timers, no imports.
   */
  script?: string;
}

/** Result of validating an untrusted pack blob before it is allowed near a room. */
export interface PackValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}
