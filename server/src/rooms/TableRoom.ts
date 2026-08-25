/**
 * The room: one table, one pack, many players.
 *
 * Its job is to own the authoritative state, run incoming ops through the engine, and
 * keep each client's StateView in sync with what that client is entitled to know.
 */

import { Room, Client } from '@colyseus/core';
import { StateView } from '@colyseus/schema';
import type { GamePack, Op, Enforcement } from '@wvtt/shared';
import { getBuiltinPack, DEFAULT_PACK_ID, TOKEN_COLORS } from '@wvtt/shared';
import { TableState, Piece, Stack, Secret, Player } from '../state.js';
import { applySeatSetup, buildTable, pushLog, relayoutZone, restackYs } from '../engine.js';
import { applyOp, type OpContext } from '../ops.js';
import { visibleTo, type PeekGrants, type Viewer } from '../visibility.js';
import { makeRoomCode } from '../rng.js';
import { newClientLimits, take, type ClientLimits } from '../rateLimit.js';
import { loadRoom, saveRoom, type RoomSnapshot } from '../persistence.js';
import {
  CLOCK_TICK_MS, configureClock, disableClock, pauseClock, resetClock,
  startClock, switchClock, syncSeats, tickClock,
} from '../clock.js';
import { validatePack } from '../packValidation.js';
import { ScriptHost } from '../scripting/host.js';
import { buildScriptApi } from '../scripting/api.js';

interface JoinOptions {
  name?: string;
  roomCode?: string;
  packId?: string;
}

export class TableRoom extends Room<TableState> {
  maxClients = 12; // seats are limited by the pack; the rest are spectators

  private pack!: GamePack;
  private peeks: PeekGrants = new Map();
  /** Last set of piece ids we granted to each client, so we only send the delta. */
  private granted = new Map<string, Set<string>>();
  private sidesCache = new Map<string, number>();
  /** The pack's rules script, when it has one and enforcement is not off. */
  private script: ScriptHost | null = null;
  private scriptVars = new Map<string, unknown>();
  private scriptDirty = false;
  /**
   * Where a piece stood when it was picked up.
   *
   * Dragging streams unvalidated `move` ops so other players can watch the piece
   * travel, which means by the time a `drop` is refused the piece has already been
   * relocated. Without putting it back, a refused move stays where it was dragged and
   * enforcement looks broken — you get a warning and an illegal position.
   */
  private origins = new Map<string, { x: number; z: number; rotY: number; zoneId: string; stackId: string; order: number }>();
  /** Per-client budgets, so one player cannot flood the table. */
  private limits = new Map<string, ClientLimits>();

  /**
   * Largest pack accepted over the wire.
   *
   * Must stay at or below the transport's maxPayload, and is checked before parsing:
   * JSON.parse on an unbounded string is a cheap way to exhaust the server's memory.
   */
  private static readonly MAX_PACK_BYTES = 4 * 1024 * 1024;

  async onCreate(options: JoinOptions = {}) {
    this.state = new TableState();
    this.state.roomCode = (options.roomCode || makeRoomCode()).toUpperCase();

    // A room code the caller supplied may name a table that survived a restart.
    const saved = options.roomCode ? loadRoom(this.state.roomCode) : null;
    if (saved) {
      await this.restoreFrom(saved);
    } else {
      const pack = getBuiltinPack(options.packId ?? DEFAULT_PACK_ID) ?? getBuiltinPack(DEFAULT_PACK_ID)!;
      // Awaited: starting the sandbox loads a WASM module, and until this resolves the
      // script's onSetup has not run. Colyseus holds joins until onCreate settles, so
      // awaiting here means onSetup always sees an empty table rather than racing the
      // first players through the door and dealing them a hand nobody asked for.
      await this.loadPack(pack, false);
    }

    // Snapshot periodically as well as on close, so a hard kill loses at most a minute.
    this.clock.setInterval(() => this.persist(), 60_000);

    // The game clock counts down here rather than on any client.
    let lastTick = Date.now();
    this.clock.setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastTick;
      lastTick = now;
      tickClock(this.state, elapsed);
    }, CLOCK_TICK_MS);

    this.onMessage('op', (client, message) => this.handleOp(client, message as Op));
    this.onMessage('loadPack', (client, message) => this.handleLoadPack(client, message));

    // Room codes are how people find each other, so expose it for matchmaking.
    this.setMetadata({ roomCode: this.state.roomCode, packName: this.state.packName });
  }

  /* ---------------- lifecycle ---------------- */

  onJoin(client: Client, options: JoinOptions = {}) {
    const player = new Player();
    player.sessionId = client.sessionId;
    player.name = sanitizeName(options.name) || `Player ${this.state.players.size + 1}`;
    player.color = TOKEN_COLORS[this.state.players.size % TOKEN_COLORS.length];
    player.seat = this.firstFreeSeat();
    player.connected = true;
    player.px = 0;
    player.pz = 0;
    this.state.players.set(client.sessionId, player);

    client.view = new StateView();
    this.granted.set(client.sessionId, new Set());
    this.limits.set(client.sessionId, newClientLimits());

    // The pack itself is public knowledge: everyone may know a deck contains an ace of
    // spades. What stays secret is WHICH piece is the ace, which lives in Piece.secret.
    client.send('pack', this.pack);

    pushLog(this.state, `${player.name} joined.`);
    this.refreshViews();
  }

  async onLeave(client: Client, consented: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = false;

    // Release anything they were holding so the table does not deadlock.
    this.releaseHeldBy(client.sessionId);

    if (consented) return this.removePlayer(client.sessionId);
    try {
      await this.allowReconnection(client, 60);
      const back = this.state.players.get(client.sessionId);
      if (back) back.connected = true;
      client.view = new StateView();
      this.granted.set(client.sessionId, new Set());
      this.refreshViews();
    } catch {
      this.removePlayer(client.sessionId);
    }
  }

  onDispose() {
    this.persist();
    this.disposeScript();
  }

  /* ---------------- persistence ---------------- */

  /** Write the table to disk so its room code keeps working across a restart. */
  private persist() {
    if (!this.pack) return;
    const pieces: RoomSnapshot['pieces'] = [];
    this.state.pieces.forEach((p) => {
      pieces.push({
        id: p.id, kind: p.kind, defId: p.defId,
        x: p.x, y: p.y, z: p.z, rotY: p.rotY,
        faceUp: p.faceUp, stackId: p.stackId, order: p.order, zoneId: p.zoneId,
        face: p.secret.face, value: p.secret.value,
      });
    });
    const stacks: RoomSnapshot['stacks'] = [];
    this.state.stacks.forEach((st) => {
      stacks.push({
        id: st.id, x: st.x, y: st.y, z: st.z, rotY: st.rotY,
        zoneId: st.zoneId, pieceIds: [...st.pieceIds],
      });
    });

    saveRoom({
      version: 1,
      roomCode: this.state.roomCode,
      savedAt: Date.now(),
      enforcement: this.state.enforcement,
      autoStack: this.state.autoStack,
      pack: this.pack,
      pieces,
      stacks,
      scriptVars: [...this.scriptVars.entries()],
    });
  }

  /**
   * Rebuild a table from a snapshot.
   *
   * The pack is loaded first to recreate the zones and start the script, then the saved
   * pieces replace whatever the pack's setup produced — otherwise a restored table
   * would be dealt a fresh hand on top of the one it is trying to restore.
   */
  private async restoreFrom(snapshot: RoomSnapshot) {
    await this.loadPack(snapshot.pack, false);

    this.state.pieces.clear();
    this.state.stacks.clear();

    for (const p of snapshot.pieces) {
      const piece = new Piece();
      piece.id = p.id; piece.kind = p.kind; piece.defId = p.defId;
      piece.x = p.x; piece.y = p.y; piece.z = p.z; piece.rotY = p.rotY;
      piece.faceUp = p.faceUp; piece.stackId = p.stackId; piece.order = p.order;
      piece.zoneId = p.zoneId;
      piece.heldBy = '';        // nobody is holding anything after a restart
      const secret = new Secret();
      secret.face = p.face; secret.value = p.value;
      piece.secret = secret;
      this.state.pieces.set(piece.id, piece);
    }

    for (const st of snapshot.stacks) {
      const stack = new Stack();
      stack.id = st.id; stack.x = st.x; stack.y = st.y; stack.z = st.z; stack.rotY = st.rotY;
      stack.zoneId = st.zoneId; stack.heldBy = '';
      for (const id of st.pieceIds) if (this.state.pieces.has(id)) stack.pieceIds.push(id);
      this.state.stacks.set(stack.id, stack);
    }

    this.state.enforcement = snapshot.enforcement;
    // Older snapshots predate this setting; default it on rather than off.
    this.state.autoStack = snapshot.autoStack ?? true;
    this.scriptVars.clear();
    for (const [k, v] of snapshot.scriptVars) this.scriptVars.set(k, v);

    pushLog(this.state, 'Table restored. Take a seat to carry on.');
  }

  private removePlayer(sessionId: string) {
    const player = this.state.players.get(sessionId);
    if (player) pushLog(this.state, `${player.name} left.`);
    this.state.players.delete(sessionId);
    this.granted.delete(sessionId);
    this.limits.delete(sessionId);
    // Their peeks die with them.
    for (const set of this.peeks.values()) set.delete(sessionId);
    this.refreshViews();
  }

  private releaseHeldBy(sessionId: string) {
    this.state.pieces.forEach((p) => { if (p.heldBy === sessionId) p.heldBy = ''; });
    this.state.stacks.forEach((s) => { if (s.heldBy === sessionId) s.heldBy = ''; });
  }

  /* ---------------- messages ---------------- */

  private handleOp(client: Client, op: Op) {
    if (!op || typeof op !== 'object' || typeof (op as Op).t !== 'string') return;
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const limits = this.limits.get(client.sessionId);
    if (limits) {
      const heavy = op.t === 'resetTable' || op.t === 'loadPack';
      const budget = heavy ? limits.heavy : op.t === 'chat' ? limits.chat : limits.ops;
      if (!take(budget)) {
        // Ordinary ops are dropped in silence — telling a flooding client about every
        // rejected message would just double the traffic.
        if (heavy || op.t === 'chat') {
          client.send('opError', { op: op.t, error: 'Slow down a moment.' });
        }
        return;
      }
    }

    // Table-level controls are handled here rather than in the engine, because they
    // change the room rather than the physical table.
    if (op.t === 'setEnforcement') {
      const mode = op.mode;
      if (mode === 'off' || mode === 'advisory' || mode === 'enforced') {
        const wasOff = this.state.enforcement === 'off';
        this.state.enforcement = mode;
        pushLog(this.state, `${player.name} set rules to ${mode}.`);
        // Turning rules on starts the script; turning them off shuts it down entirely
        // rather than leaving an isolate running with nothing to do.
        if (mode === 'off') this.disposeScript();
        else if (wasOff) void this.startScript();
      }
      return;
    }
    if (op.t === 'clockConfig') {
      const mode = op.mode === 'manual' ? 'manual' : 'auto';
      configureClock(this.state, op.baseMs, op.incrementMs, mode, this.pack?.manifest.minSeats ?? 2);
      pushLog(this.state, `${player.name} set a ${Math.round(this.state.clock.baseMs / 60000)} minute clock (${mode}).`);
      return;
    }
    if (op.t === 'clockStart') { startClock(this.state); return; }
    if (op.t === 'clockPause') { pauseClock(this.state); return; }
    if (op.t === 'clockReset') { resetClock(this.state); return; }
    if (op.t === 'clockOff') {
      disableClock(this.state);
      pushLog(this.state, `${player.name} removed the clock.`);
      return;
    }
    if (op.t === 'clockPress') {
      // Manual mode only: pressing your own clock ends your turn.
      if (this.state.clock.mode !== 'manual') return;
      if (player.seat < 0 || player.seat !== this.state.clock.activeSeat) {
        client.send('opError', { op: op.t, error: 'It is not your clock to press.' });
        return;
      }
      switchClock(this.state, player.seat);
      return;
    }

    if (op.t === 'resetTable') {
      void this.loadPack(this.pack, true);
      pushLog(this.state, `${player.name} reset the table.`);
      this.refreshViews();
      return;
    }

    // Remember where things were before a drag begins.
    if (op.t === 'grab') this.rememberOrigin(op.target);

    const ctx: OpContext = {
      state: this.state,
      peeks: this.peeks,
      sessionId: client.sessionId,
      seat: player.seat,
      sidesOf: (defId) => this.sidesOf(defId),
      playerName: (sid) => this.state.players.get(sid)?.name ?? 'Someone',
    };

    if (op.t === 'scriptAction') {
      this.runScriptAction(client, op.action, op.payload);
      return;
    }

    // With enforcement on, the pack's script gets a veto before anything moves.
    if (this.script && this.state.enforcement === 'enforced' && MOVE_OPS.has(op.t)) {
      // Put the piece back on its original square first. Dragging streams `move` ops,
      // so by now the piece is already sitting on its destination — a validator reading
      // the board would see the move as already made, conclude the piece had not moved
      // at all, and wave it through without ever checking whose turn it is.
      this.restoreOrigin(targetOf(op), false);

      const verdict = this.script.call('validateMove', [{ ...op, seat: player.seat, name: player.name }]);
      if (!verdict.ok) {
        client.send('opError', { op: op.t, error: `Rules script failed: ${verdict.error}` });
        this.revertToOrigin(targetOf(op));
        return;
      }
      const refused = verdict.rejection ?? (verdict.value === false ? 'That move is not allowed.' : null);
      if (refused) {
        client.send('opError', { op: op.t, error: refused });
        this.revertToOrigin(targetOf(op));
        return;
      }
    }

    const result = applyOp(ctx, op);
    if (!result.ok) {
      client.send('opError', { op: op.t, error: result.error });
      this.revertToOrigin(targetOf(op));
      return;
    }

    // A committed drop is the new truth; a release with the piece never dropped means
    // the drag was abandoned, so under enforcement it goes back where it came from.
    if (op.t === 'drop') {
      this.origins.delete(op.target);
    } else if (op.t === 'release') {
      if (this.script && this.state.enforcement === 'enforced') this.revertToOrigin(op.target);
      else this.origins.delete(op.target);
    }

    // Someone who sits down after the table was built still needs their own kit.
    if (op.t === 'sit' && this.pack) {
      if (applySeatSetup(this.state, this.pack, player.seat)) this.refreshViews();
      syncSeats(this.state);
    }

    // In automatic mode, landing a move passes the clock to the next player.
    if (op.t === 'drop' && this.state.clock.enabled && this.state.clock.mode === 'auto'
        && this.state.clock.running && player.seat >= 0) {
      switchClock(this.state, player.seat);
    }

    // In advisory mode the move already happened; the script only gets to comment.
    if (this.script && this.state.enforcement === 'advisory' && MOVE_OPS.has(op.t)) {
      const verdict = this.script.call('validateMove', [{ ...op, seat: player.seat, name: player.name }]);
      const note = verdict.rejection ?? (verdict.value === false ? 'That move breaks the rules.' : null);
      if (note) pushLog(this.state, `Note: ${note}`);
    }

    if (result.visibilityDirty || this.takeScriptDirty()) this.refreshViews();
  }

  private handleLoadPack(client: Client, message: unknown) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const limits = this.limits.get(client.sessionId);
    if (limits && !take(limits.heavy)) {
      client.send('opError', { op: 'loadPack', error: 'Slow down a moment.' });
      return;
    }

    const raw = typeof message === 'string' ? message : (message as { packJson?: string })?.packJson;
    let parsed: unknown;

    if (typeof raw === 'string' && raw.trim().length > 0) {
      // Check the size before parsing, not after: JSON.parse on an unbounded string
      // allocates the whole structure first and is a cheap way to exhaust memory.
      if (raw.length > TableRoom.MAX_PACK_BYTES) {
        client.send('opError', { op: 'loadPack', error: 'That pack is too large.' });
        return;
      }
      try {
        parsed = JSON.parse(raw);
      } catch {
        client.send('opError', { op: 'loadPack', error: 'That is not valid JSON.' });
        return;
      }
    } else {
      const id = (message as { packId?: string })?.packId;
      parsed = id ? getBuiltinPack(id) : undefined;
      if (!parsed) {
        client.send('opError', { op: 'loadPack', error: 'Unknown pack.' });
        return;
      }
    }

    const verdict = validatePack(parsed);
    if (!verdict.ok) {
      client.send('opError', { op: 'loadPack', error: verdict.errors.join(' ') });
      return;
    }

    const incoming = parsed as GamePack;
    const hasScript = typeof incoming.script === 'string' && incoming.script.trim().length > 0;
    void this.loadPack(incoming, true);
    pushLog(
      this.state,
      `${player.name} loaded "${this.state.packName}"${hasScript ? ' — it includes a rules script.' : '.'}`,
    );
    this.broadcast('pack', this.pack);
    this.refreshViews();
  }

  /* ---------------- pack loading ---------------- */

  private async loadPack(pack: GamePack, announce: boolean) {
    this.pack = pack;
    this.state.status = '';
    this.peeks.clear();
    this.sidesCache.clear();
    for (const c of pack.components) {
      if (c.sides) this.sidesCache.set(c.id, c.sides);
    }
    const seats: number[] = [];
    this.state.players.forEach((p) => { if (p.seat >= 0) seats.push(p.seat); });
    buildTable(this.state, pack, seats);
    if (announce) this.setMetadata({ roomCode: this.state.roomCode, packName: this.state.packName });
    await this.startScript();
  }

  private sidesOf(defId: string): number {
    return this.sidesCache.get(defId) ?? 6;
  }

  private firstFreeSeat(): number {
    const taken = new Set<number>();
    this.state.players.forEach((p) => { if (p.seat >= 0) taken.add(p.seat); });
    for (let i = 0; i < this.state.maxSeats; i++) if (!taken.has(i)) return i;
    return -1; // table full: join as a spectator
  }

  /* ---------------- move reversal ---------------- */

  private rememberOrigin(targetId: string) {
    const piece = this.state.pieces.get(targetId);
    if (piece) {
      this.origins.set(targetId, {
        x: piece.x, z: piece.z, rotY: piece.rotY,
        zoneId: piece.zoneId, stackId: piece.stackId, order: piece.order,
      });
      return;
    }
    const stack = this.state.stacks.get(targetId);
    if (stack) {
      this.origins.set(targetId, {
        x: stack.x, z: stack.z, rotY: stack.rotY,
        zoneId: stack.zoneId, stackId: '', order: 0,
      });
    }
  }

  /** Put a piece or pile back where it was picked up. */
  private revertToOrigin(targetId: string | null) {
    this.restoreOrigin(targetId, true);
  }

  /**
   * Move a piece back to its recorded origin.
   *
   * `forget` controls whether the origin is discarded: it is kept while validating, so
   * a refused move still has somewhere to return to, and dropped once the op is settled.
   */
  private restoreOrigin(targetId: string | null, forget: boolean) {
    if (!targetId) return;
    const origin = this.origins.get(targetId);
    if (!origin) return;
    if (forget) this.origins.delete(targetId);

    const piece = this.state.pieces.get(targetId);
    if (piece) {
      piece.x = origin.x; piece.z = origin.z; piece.rotY = origin.rotY;
      piece.zoneId = origin.zoneId; piece.order = origin.order;
      piece.heldBy = '';
      if (origin.zoneId) relayoutZone(this.state, origin.zoneId);
      this.refreshViews();
      return;
    }
    const stack = this.state.stacks.get(targetId);
    if (stack) {
      stack.x = origin.x; stack.z = origin.z; stack.rotY = origin.rotY;
      stack.zoneId = origin.zoneId;
      stack.heldBy = '';
      restackYs(this.state, stack.id);
      this.refreshViews();
    }
  }

  /* ---------------- scripting ---------------- */

  /**
   * Start the pack's rules script, if it has one and rules are not switched off.
   *
   * Failure is deliberately soft: a pack with a broken script still gives everyone a
   * working sandbox table, with the error reported rather than the room refusing to open.
   */
  private async startScript() {
    this.disposeScript();
    const source = this.pack?.script;
    if (!source || this.state.enforcement === 'off') return;

    this.scriptVars.clear();
    const api = buildScriptApi({
      state: this.state,
      vars: this.scriptVars,
      markVisibilityDirty: () => { this.scriptDirty = true; },
    });

    const { host, error } = await ScriptHost.create(source, api);
    if (!host) {
      pushLog(this.state, `Rules script could not start: ${error}`);
      this.broadcast('opError', { op: 'script', error: `Rules script could not start: ${error}` });
      return;
    }
    this.script = host;

    const setup = host.call('onSetup', []);
    if (!setup.ok) pushLog(this.state, `Rules script error during setup: ${setup.error}`);
    if (this.takeScriptDirty()) this.refreshViews();
  }

  private disposeScript() {
    this.script?.dispose();
    this.script = null;
  }

  private takeScriptDirty(): boolean {
    const was = this.scriptDirty;
    this.scriptDirty = false;
    return was;
  }

  private runScriptAction(client: Client, action: unknown, payload: unknown) {
    if (!this.script) {
      client.send('opError', { op: 'scriptAction', error: 'This table has no rules script running.' });
      return;
    }
    const name = String(action ?? '').slice(0, 64);
    const result = this.script.call('onAction', [name, payload ?? null]);
    if (!result.ok) {
      client.send('opError', { op: 'scriptAction', error: result.error });
      pushLog(this.state, `Rules script error in "${name}": ${result.error}`);
      return;
    }
    if (result.rejection) client.send('opError', { op: 'scriptAction', error: result.rejection });
    if (this.takeScriptDirty()) this.refreshViews();
  }

  /* ---------------- the visibility sync ---------------- */

  /**
   * Recompute what each client may see and push only the difference into its StateView.
   *
   * This is the one place where hidden information becomes wire behaviour. Everything
   * else in the server is ordinary game logic; a bug here is a cheating vulnerability,
   * which is why the rules themselves live in visibility.ts and are unit-tested.
   */
  private refreshViews() {
    for (const client of this.clients) {
      const player = this.state.players.get(client.sessionId);
      if (!player || !client.view) continue;

      const viewer: Viewer = { sessionId: client.sessionId, seat: player.seat };
      const should = visibleTo(this.state, viewer, this.peeks);
      const has = this.granted.get(client.sessionId) ?? new Set<string>();

      for (const id of should) {
        if (has.has(id)) continue;
        const piece = this.state.pieces.get(id);
        if (piece) client.view.add(piece.secret);
      }
      for (const id of has) {
        if (should.has(id)) continue;
        const piece = this.state.pieces.get(id);
        if (piece) client.view.remove(piece.secret);
      }
      this.granted.set(client.sessionId, should);
    }
  }
}

/**
 * Ops the rules script is allowed to inspect and veto.
 *
 * Deliberately excludes 'move': that fires continuously while a piece is being dragged,
 * roughly thirty times a second, and the piece has not landed anywhere yet. Validating
 * it would run the script constantly and ask it to judge a move still in progress.
 * 'drop' is the commit point, and that is what gets judged.
 */
const MOVE_OPS = new Set<string>(['drop', 'flip', 'draw', 'deal', 'stackOnto', 'unstack', 'reveal', 'roll', 'shuffle']);

/** The piece or pile an op acts on, for putting it back when the op is refused. */
function targetOf(op: Op): string | null {
  if ('target' in op && typeof op.target === 'string') return op.target;
  if ('stackId' in op && typeof op.stackId === 'string') return op.stackId;
  return null;
}

function sanitizeName(raw: unknown): string {
  return String(raw ?? '').replace(/[^\p{L}\p{N} _'-]/gu, '').trim().slice(0, 24);
}
