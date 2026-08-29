/**
 * Client state store.
 *
 * The server's schema state is mirrored into a plain snapshot on every patch and kept
 * in zustand, so React components read ordinary objects. Snapshots are coalesced to
 * one per animation frame — during a drag the server patches faster than the screen
 * refreshes, and re-rendering per patch would waste the budget for no visible gain.
 */

import { create } from 'zustand';
import { Client, Room } from 'colyseus.js';
import type { GamePack, Op, PieceState, StackState, ZoneDef, PlayerInfo } from '@wvtt/shared';

export interface Snapshot {
  roomCode: string;
  packId: string;
  packName: string;
  enforcement: string;
  tableColor: string;
  /** Short public line set by the pack's rules script, e.g. whose turn it is. */
  status: string;
  /** Whether dropping a piece on another merges them into a pile. */
  autoStack: boolean;
  maxSeats: number;
  players: Record<string, PlayerInfo & { px: number; pz: number }>;
  pieces: Record<string, PieceState & { secret?: { face?: string; value?: number } }>;
  /** pieceIds may be absent on a stack whose contents have not arrived yet. */
  stacks: Record<string, Omit<StackState, 'pieceIds'> & { pieceIds?: string[] }>;
  zones: Record<string, ZoneDef & { gridCols: number; gridRows: number; checkered: boolean }>;
  log: { id: string; text: string; at: number; name: string; color: string; kind: string }[];
  chat: { id: string; sessionId: string; name: string; color: string; text: string; at: number }[];
  clock: {
    enabled: boolean; mode: string; running: boolean; activeSeat: number;
    baseMs: number; incrementMs: number; flaggedSeat: number; minSeats: number;
    times: Record<string, number>;
  };
}

const EMPTY: Snapshot = {
  roomCode: '', packId: '', packName: '', enforcement: 'off', tableColor: '#1f6f4a',
  status: '', autoStack: true, maxSeats: 6, players: {}, pieces: {}, stacks: {}, zones: {}, log: [], chat: [],
  clock: {
    enabled: false, mode: 'auto', running: false, activeSeat: -1,
    baseMs: 0, incrementMs: 0, flaggedSeat: -1, minSeats: 2, times: {},
  },
};

export type Phase = 'lobby' | 'connecting' | 'playing' | 'error';

/**
 * A table this browser has been at.
 *
 * Tables outlive the people sitting at them — the server keeps a snapshot and rebuilds
 * the room when someone comes back with the code. That is useless if the player no
 * longer has the code, which is the usual case once a tab has been closed, so the
 * codes are kept here and offered on the lobby.
 */
export interface RecentRoom {
  code: string;
  packName: string;
  at: number;
}

const RECENT_KEY = 'wvtt:recent-rooms';
const RECENT_MAX = 6;

export function recentRooms(): RecentRoom[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as RecentRoom[];
    if (!Array.isArray(list)) return [];
    return list
      .filter((r) => typeof r?.code === 'string' && /^[A-Z0-9]{4,12}$/.test(r.code))
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

function rememberRoom(code: string, packName: string) {
  if (!code) return;
  try {
    const list = recentRooms().filter((r) => r.code !== code);
    list.unshift({ code, packName, at: Date.now() });
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    // Private browsing, or storage full. Losing the list is not worth an error.
  }
}

export function forgetRecentRoom(code: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentRooms().filter((r) => r.code !== code)));
  } catch { /* nothing to do */ }
}

/**
 * A live ping from another player.
 *
 * Pings arrive as room messages rather than as state, so they are held here with the
 * moment they landed and dropped again once their animation is over. Nothing about a
 * ping needs to survive a reconnect.
 */
export interface Ping {
  id: string;
  sessionId: string;
  name: string;
  color: string;
  x: number;
  z: number;
  targetId: string;
  at: number;
}

/** How long a ping stays on the table. Must match the CSS animation. */
export const PING_MS = 2600;

interface Store {
  phase: Phase;
  error: string;
  room: Room | null;
  sessionId: string;
  snap: Snapshot;
  pack: GamePack | null;
  /** Piece or stack the local player is currently dragging. */
  dragging: string | null;
  /**
   * Set by the lobby's "Make your own game" entry: the table is created first, then the
   * editor opens on top of it. The editor needs a room to load a pack into, so it
   * cannot be opened from the lobby alone.
   */
  pendingEditor: boolean;
  toast: string;
  /** Pings currently animating on the table. */
  pings: Ping[];
  /**
   * The piece or pile under the pointer.
   *
   * Kept here because two very different parts of the app need it: the scene draws a
   * faint outline around it, and the keyboard shortcuts act on it. A shortcut with no
   * visible target is a guessing game, so the two must always agree.
   */
  hovered: string | null;
  /**
   * Open context menu for a piece or stack. Held here rather than inside the Canvas
   * because the menu is ordinary DOM drawn by the HUD, while the target is picked in
   * the 3D scene.
   */
  menu: { x: number; y: number; targetId: string } | null;

  connect: (opts: { name: string; roomCode?: string; packId?: string }) => Promise<void>;
  leave: () => void;
  send: (op: Op) => void;
  setDragging: (id: string | null) => void;
  setHovered: (id: string | null) => void;
  setPendingEditor: (v: boolean) => void;
  showToast: (msg: string) => void;
  openMenu: (m: { x: number; y: number; targetId: string }) => void;
  closeMenu: () => void;
  /** Ping the table at a spot, optionally naming the piece being pointed at. */
  ping: (p: { x: number; z: number; targetId?: string }) => void;
}

/**
 * Where the game server lives.
 *
 * In production the client is served by the game server itself, so same-origin is
 * correct and nginx only has to proxy one upstream. In development the client is on
 * Vite's port and talks to the server directly — Colyseus opens its socket on a
 * root-level path that Vite cannot proxy without colliding with its own HMR socket.
 */
const SERVER_HOST = import.meta.env.DEV
  // VITE_SERVER_HOST lets a developer point the dev client at a game server on another
  // port — useful when the deployed service already holds 2567 on this machine.
  ? (import.meta.env.VITE_SERVER_HOST || `${location.hostname}:2567`)
  : location.host;

function wsEndpoint(): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${SERVER_HOST}`;
}

/** The HTTP API's address, which in development is a different origin to the client. */
export function apiUrl(path: string): string {
  return import.meta.env.DEV ? `${location.protocol}//${SERVER_HOST}${path}` : path;
}

/**
 * Shortest gap between snapshot rebuilds, in milliseconds.
 *
 * Rebuilding means toJSON() over the entire room — every piece, zone, log line and chat
 * message — and then re-rendering the scene from it. At one rebuild per animation frame
 * that is sixty full copies a second, and since presence cursors started streaming,
 * ANY player moving their mouse kept every other client doing it continuously. Twenty a
 * second is indistinguishable on screen (the server only sends drag positions at
 * thirty) and roughly a third of the work.
 */
const SYNC_MS = 50;

export const useStore = create<Store>((set, get) => {
  let frame = 0;
  let lastSync = 0;
  let rememberedCode = '';

  /** Copy the schema state into a plain snapshot, at a bounded rate. */
  function scheduleSync(room: Room) {
    if (frame) return;
    const run = () => {
      frame = 0;
      lastSync = performance.now();
      const raw = room.state.toJSON() as Snapshot;
      const snap = { ...EMPTY, ...raw };
      // The code only becomes known once state arrives, so this is the first moment the
      // table can be written down.
      if (snap.roomCode && snap.roomCode !== rememberedCode) {
        rememberedCode = snap.roomCode;
        rememberRoom(snap.roomCode, snap.packName);
      }
      if (import.meta.env.DEV) {
        const w = window as unknown as {
          __wvtt?: Snapshot;
          __wvttCanRead?: (id: string) => boolean;
        };
        // Dev-only handles so tests can assert on exactly what this client received,
        // and on what it is therefore allowed to DRAW — which is a different question
        // once a secret has been revoked but not forgotten.
        w.__wvtt = snap;
        w.__wvttCanRead = (id: string) => {
          const piece = snap.pieces[id];
          const seat = snap.players[get().sessionId]?.seat ?? -1;
          return !!piece && canRead(snap, piece, seat);
        };
      }
      set({ snap });
    };

    const due = SYNC_MS - (performance.now() - lastSync);
    if (due <= 0) {
      frame = requestAnimationFrame(run);
    } else {
      // A timer rather than a frame: the next frame may be sooner than the budget.
      frame = window.setTimeout(() => { frame = requestAnimationFrame(run); }, due);
    }
  }

  return {
    phase: 'lobby',
    error: '',
    room: null,
    sessionId: '',
    snap: EMPTY,
    pack: null,
    dragging: null,
    pendingEditor: false,
    toast: '',
    pings: [],
    hovered: null,
    menu: null,

    async connect({ name, roomCode, packId }) {
      set({ phase: 'connecting', error: '' });
      try {
        const client = new Client(wsEndpoint());
        let room: Room;

        if (roomCode) {
          // Resolve the shareable code before trying to join, so a wrong code gives a
          // clear message instead of silently opening a new table.
          const res = await fetch(apiUrl(`/api/room/${encodeURIComponent(roomCode)}`));
          if (!res.ok) throw new Error(`No table found with code ${roomCode}.`);
          const found = await res.json() as { roomId?: string; restorable?: boolean };
          if (found.roomId) {
            room = await client.joinById(found.roomId, { name });
          } else {
            // The table was saved before a restart; asking for it by code rebuilds it.
            room = await client.create('table', { name, roomCode });
          }
        } else {
          room = await client.create('table', { name, packId });
        }

        room.onMessage('pack', (pack: GamePack) => set({ pack }));
        room.onMessage('ping', (m: Omit<Ping, 'id' | 'at'>) => {
          const entry: Ping = { ...m, id: `${Date.now()}:${Math.random()}`, at: Date.now() };
          set({ pings: [...get().pings, entry] });
          // Self-clearing: a ping is over when its animation is, and nothing else in
          // the app needs to know it ever happened.
          window.setTimeout(
            () => set({ pings: get().pings.filter((p) => p.id !== entry.id) }),
            PING_MS,
          );
        });
        room.onMessage('opError', (m: { op: string; error: string }) => {
          get().showToast(m.error || `${m.op} was refused`);
        });
        room.onStateChange(() => scheduleSync(room));
        room.onLeave(() => set({ phase: 'lobby', room: null }));
        room.onError((_code, message) => set({ phase: 'error', error: message ?? 'Connection error' }));

        // Dev-only handle, so a performance probe can time the raw schema copy that
        // every state patch triggers.
        if (import.meta.env.DEV) (window as unknown as { __wvttRoom?: Room }).__wvttRoom = room;
        set({ room, sessionId: room.sessionId, phase: 'playing' });
        scheduleSync(room);
      } catch (err) {
        // Drop any pending hand-off too: a failed join must not leave the editor
        // primed to open over the next table the player creates.
        set({
          phase: 'error',
          error: err instanceof Error ? err.message : String(err),
          pendingEditor: false,
        });
      }
    },

    leave() {
      get().room?.leave(true);
      set({
        phase: 'lobby', room: null, snap: EMPTY, pack: null,
        pings: [], hovered: null, pendingEditor: false,
      });
    },

    send(op) {
      get().room?.send('op', op);
    },

    setDragging(id) { set({ dragging: id }); },

    setPendingEditor(v) { set({ pendingEditor: v }); },

    setHovered(id) {
      // Guarded: pointer-out from one piece and pointer-over onto the next arrive as a
      // pair, and writing the same value twice would re-render the whole scene for
      // nothing.
      if (get().hovered !== id) set({ hovered: id });
    },

    ping({ x, z, targetId }) {
      get().send({ t: 'ping', x, z, target: targetId });
    },

    openMenu(m) { set({ menu: m }); },
    closeMenu() { set({ menu: null }); },

    showToast(msg) {
      set({ toast: msg });
      window.setTimeout(() => {
        if (get().toast === msg) set({ toast: '' });
      }, 2600);
    },
  };
});

/**
 * Whether this client is entitled to READ a piece's identity right now.
 *
 * Mirrors canSee() on the server, and exists because a revoked secret does not vanish
 * from the client that already had it: Colyseus stops sending updates for a field it
 * takes out of a view, but the last value it sent stays in local state. A card that was
 * face up on the table and is then picked up into a hand therefore keeps its identity
 * on every screen that saw it — which is how cards ended up apparently lying face up
 * in someone else's hand square.
 *
 * The server is still the thing that keeps secrets: it never sends an identity the
 * viewer was not entitled to. This decides what to DRAW from what we already hold.
 */
export function canRead(snap: Snapshot, piece: Snapshot['pieces'][string], mySeat: number): boolean {
  if (!piece?.secret?.face) return false;

  if (piece.zoneId) {
    const zone = snap.zones[piece.zoneId];
    if (zone) {
      switch (zone.visibility) {
        case 'public': return true;
        case 'hidden': return false;
        case 'owner': return (zone.ownerSeat ?? -1) >= 0 && zone.ownerSeat === mySeat;
        default: break;   // 'inherit' falls through to the piece's own state
      }
    }
  }

  // Inside a pile, only a face-up top card is readable.
  if (piece.stackId) {
    const stack = snap.stacks[piece.stackId];
    const ids = stack?.pieceIds;
    if (!ids || ids.length === 0) return false;
    return ids[ids.length - 1] === piece.id && piece.faceUp;
  }

  return piece.faceUp;
}

/** The local player's record, or undefined while connecting. */
export function useMe() {
  return useStore((s) => s.snap.players[s.sessionId]);
}

/** The local player's seat, or -1 when spectating. */
export function useMySeat(): number {
  return useStore((s) => s.snap.players[s.sessionId]?.seat ?? -1);
}
