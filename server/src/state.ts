/**
 * Colyseus state schema.
 *
 * Declared with defineTypes() rather than decorators so the code needs no TypeScript
 * decorator configuration and runs unmodified under tsx/esbuild.
 *
 * The security-critical part is `Piece.secret`. It is tagged with view(), which means
 * Colyseus will NOT serialise it to a client unless the server has explicitly added
 * that piece to that client's StateView. A face-down card's identity therefore never
 * crosses the wire to a player who should not know it — this is enforced by the
 * encoder, not by client-side politeness.
 */

import { Schema, MapSchema, ArraySchema, defineTypes, view, Encoder } from '@colyseus/schema';

/**
 * Grow the shared encode buffer.
 *
 * It defaults to Node's Buffer.poolSize (8 KB), which a table overflows at roughly 85
 * pieces — a poker game with six players' chip stacks is well past that. On overflow
 * the encoder resizes and re-encodes, but with per-client StateViews in play that path
 * silently drops state: clients were receiving empty Player objects, so nobody had a
 * seat. Sized here for the 800-piece ceiling the pack validator enforces.
 *
 * Set at module scope so every entry point (server, tests) gets it before any room
 * builds state.
 */
Encoder.BUFFER_SIZE = 512 * 1024;

/** The part of a piece that must stay hidden: its identity. */
export class Secret extends Schema {
  declare face: string;
  declare value: number;
}
defineTypes(Secret, { face: 'string', value: 'number' });

export class Piece extends Schema {
  declare id: string;
  declare kind: string;
  declare defId: string;
  declare x: number;
  declare y: number;
  declare z: number;
  declare rotY: number;
  declare faceUp: boolean;
  declare stackId: string;   // '' when loose on the table
  declare order: number;
  declare zoneId: string;    // '' when not in any zone
  declare heldBy: string;    // '' when not held
  /** Pinned to the table: no move, flip or draw touches it until it is unlocked. */
  declare locked: boolean;
  declare secret: Secret;
}
defineTypes(Piece, {
  id: 'string', kind: 'string', defId: 'string',
  x: 'number', y: 'number', z: 'number', rotY: 'number',
  faceUp: 'boolean', stackId: 'string', order: 'number',
  zoneId: 'string', heldBy: 'string', locked: 'boolean',
  secret: Secret,
});
// Gate the identity behind per-client visibility. Must come after defineTypes.
view()(Piece.prototype, 'secret');

export class Stack extends Schema {
  declare id: string;
  declare x: number;
  declare y: number;
  declare z: number;
  declare rotY: number;
  declare zoneId: string;
  declare heldBy: string;
  /**
   * A name the players gave this pile, e.g. "Discard" or "Bob's stash".
   *
   * A sandbox table quickly grows five identical-looking piles, and "shuffle the pile"
   * is meaningless when nobody can say which one. Empty when unnamed.
   */
  declare label: string;
  /** Group tag. Piles sharing a tag are drawn with the same colour chip. */
  declare tag: string;
  /** Pinned in place: refuses drags, draws, shuffles and splits. */
  declare locked: boolean;
  /** Piece ids, bottom first. */
  declare pieceIds: ArraySchema<string>;
  constructor() {
    super();
    this.label = '';
    this.tag = '';
    this.locked = false;
    this.pieceIds = new ArraySchema<string>();
  }
}
defineTypes(Stack, {
  id: 'string', x: 'number', y: 'number', z: 'number', rotY: 'number',
  zoneId: 'string', heldBy: 'string',
  label: 'string', tag: 'string', locked: 'boolean',
  pieceIds: ['string'],
});

export class Zone extends Schema {
  declare id: string;
  declare label: string;
  declare ownerSeat: number;   // -1 for shared
  declare visibility: string;
  declare x: number; declare z: number; declare w: number; declare h: number;
  declare layout: string;
  declare gridCols: number;
  declare gridRows: number;
  declare checkered: boolean;
}
defineTypes(Zone, {
  id: 'string', label: 'string', ownerSeat: 'number', visibility: 'string',
  x: 'number', z: 'number', w: 'number', h: 'number',
  layout: 'string', gridCols: 'number', gridRows: 'number', checkered: 'boolean',
});

export class Player extends Schema {
  declare sessionId: string;
  declare name: string;
  declare color: string;
  declare seat: number;        // -1 while spectating
  declare connected: boolean;
  /** Live pointer position on the table, for presence cursors. */
  declare px: number;
  declare pz: number;
}
defineTypes(Player, {
  sessionId: 'string', name: 'string', color: 'string', seat: 'number',
  connected: 'boolean', px: 'number', pz: 'number',
});

/**
 * One line in the table log.
 *
 * The actor is carried as its own field rather than baked into `text`, because the log
 * is read as much as it is written: players want to see who did what at a glance, and
 * filter the feed down to one person or one category. A line with no `name` is the
 * table itself talking.
 *
 * `text` is public state. Nothing written here may name the identity of a piece the
 * reader is not entitled to know — see describePiece() in ops.ts.
 */
export class LogEntry extends Schema {
  declare id: string;
  declare text: string;
  declare at: number;
  /** Who did it, or '' for the table itself. */
  declare name: string;
  /** That player's colour, so the log matches their cursor and chat. */
  declare color: string;
  /** 'move' | 'cards' | 'dice' | 'table' | 'rules' | 'presence' — drives filtering. */
  declare kind: string;
}
defineTypes(LogEntry, {
  id: 'string', text: 'string', at: 'number',
  name: 'string', color: 'string', kind: 'string',
});

export class ChatMessage extends Schema {
  declare id: string;
  declare sessionId: string;
  declare name: string;
  declare color: string;
  declare text: string;
  declare at: number;
}
defineTypes(ChatMessage, {
  id: 'string', sessionId: 'string', name: 'string',
  color: 'string', text: 'string', at: 'number',
});

/**
 * A game clock, of the kind that sits beside a chess board.
 *
 * Time is counted on the server: a client cannot slow its own clock by lagging, and
 * refreshing the page does not hand anyone extra seconds.
 */
export class GameClock extends Schema {
  declare enabled: boolean;
  /** 'auto' switches when a move is made; 'manual' waits for the player to press. */
  declare mode: string;
  declare running: boolean;
  /** Seat whose time is currently counting down, or -1. */
  declare activeSeat: number;
  declare baseMs: number;
  declare incrementMs: number;
  /** Seat that ran out of time, or -1. */
  declare flaggedSeat: number;
  /** Remaining milliseconds, keyed by seat number as a string. */
  declare times: MapSchema<number>;
  /** How many seats the clock shows even when nobody is sitting in them yet. */
  declare minSeats: number;

  constructor() {
    super();
    this.enabled = false;
    this.mode = 'auto';
    this.running = false;
    this.activeSeat = -1;
    this.baseMs = 5 * 60 * 1000;
    this.incrementMs = 0;
    this.flaggedSeat = -1;
    this.minSeats = 2;
    this.times = new MapSchema<number>();
  }
}
defineTypes(GameClock, {
  enabled: 'boolean', mode: 'string', running: 'boolean', activeSeat: 'number',
  baseMs: 'number', incrementMs: 'number', flaggedSeat: 'number', minSeats: 'number',
  times: { map: 'number' },
});

export class TableState extends Schema {
  declare roomCode: string;
  declare packId: string;
  declare packName: string;
  declare enforcement: string;
  declare tableColor: string;
  /**
   * A short public line the pack's script can set, e.g. whose turn it is. Scripts opt
   * in to what appears here; nothing is exposed automatically, because script variables
   * may hold information players are not entitled to see.
   */
  declare status: string;
  /**
   * When true, dropping a piece on top of a compatible one merges them into a pile.
   * Off leaves everything exactly where it is put, which some games want.
   */
  declare autoStack: boolean;
  declare maxSeats: number;
  /** Bumped whenever the loaded pack changes, so clients know to refetch definitions. */
  declare packRevision: number;
  declare players: MapSchema<Player>;
  declare pieces: MapSchema<Piece>;
  declare stacks: MapSchema<Stack>;
  declare zones: MapSchema<Zone>;
  declare log: ArraySchema<LogEntry>;
  declare chat: ArraySchema<ChatMessage>;
  declare clock: GameClock;

  constructor() {
    super();
    this.roomCode = '';
    this.packId = '';
    this.packName = '';
    this.enforcement = 'off';
    this.tableColor = '#1f6f4a';
    this.status = '';
    this.autoStack = true;
    this.maxSeats = 6;
    this.packRevision = 0;
    this.players = new MapSchema<Player>();
    this.pieces = new MapSchema<Piece>();
    this.stacks = new MapSchema<Stack>();
    this.zones = new MapSchema<Zone>();
    this.log = new ArraySchema<LogEntry>();
    this.chat = new ArraySchema<ChatMessage>();
    this.clock = new GameClock();
  }
}
defineTypes(TableState, {
  roomCode: 'string', packId: 'string', packName: 'string', enforcement: 'string',
  tableColor: 'string', status: 'string', autoStack: 'boolean',
  maxSeats: 'number', packRevision: 'number',
  players: { map: Player },
  pieces: { map: Piece },
  stacks: { map: Stack },
  zones: { map: Zone },
  log: [LogEntry],
  chat: [ChatMessage],
  clock: GameClock,
});
