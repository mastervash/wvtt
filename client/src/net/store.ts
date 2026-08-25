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
  log: { id: string; text: string; at: number }[];
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

interface Store {
  phase: Phase;
  error: string;
  room: Room | null;
  sessionId: string;
  snap: Snapshot;
  pack: GamePack | null;
  /** Piece or stack the local player is currently dragging. */
  dragging: string | null;
  toast: string;
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
  showToast: (msg: string) => void;
  openMenu: (m: { x: number; y: number; targetId: string }) => void;
  closeMenu: () => void;
}

/**
 * Where the game server lives.
 *
 * In production the client is served by the game server itself, so same-origin is
 * correct and nginx only has to proxy one upstream. In development the client is on
 * Vite's port and talks to the server directly — Colyseus opens its socket on a
 * root-level path that Vite cannot proxy without colliding with its own HMR socket.
 */
const SERVER_HOST = import.meta.env.DEV ? `${location.hostname}:2567` : location.host;

function wsEndpoint(): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${SERVER_HOST}`;
}

function apiUrl(path: string): string {
  return import.meta.env.DEV ? `${location.protocol}//${SERVER_HOST}${path}` : path;
}

export const useStore = create<Store>((set, get) => {
  let frame = 0;

  /** Copy the schema state into a plain snapshot, at most once per frame. */
  function scheduleSync(room: Room) {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const raw = room.state.toJSON() as Snapshot;
      const snap = { ...EMPTY, ...raw };
      // Dev-only handle so tests can assert on exactly what this client received.
      if (import.meta.env.DEV) (window as unknown as { __wvtt?: Snapshot }).__wvtt = snap;
      set({ snap });
    });
  }

  return {
    phase: 'lobby',
    error: '',
    room: null,
    sessionId: '',
    snap: EMPTY,
    pack: null,
    dragging: null,
    toast: '',
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
        room.onMessage('opError', (m: { op: string; error: string }) => {
          get().showToast(m.error || `${m.op} was refused`);
        });
        room.onStateChange(() => scheduleSync(room));
        room.onLeave(() => set({ phase: 'lobby', room: null }));
        room.onError((_code, message) => set({ phase: 'error', error: message ?? 'Connection error' }));

        set({ room, sessionId: room.sessionId, phase: 'playing' });
        scheduleSync(room);
      } catch (err) {
        set({ phase: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    },

    leave() {
      get().room?.leave(true);
      set({ phase: 'lobby', room: null, snap: EMPTY, pack: null });
    },

    send(op) {
      get().room?.send('op', op);
    },

    setDragging(id) { set({ dragging: id }); },

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

/** The local player's record, or undefined while connecting. */
export function useMe() {
  return useStore((s) => s.snap.players[s.sessionId]);
}

/** The local player's seat, or -1 when spectating. */
export function useMySeat(): number {
  return useStore((s) => s.snap.players[s.sessionId]?.seat ?? -1);
}
