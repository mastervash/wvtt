/**
 * Server entry point.
 *
 * One process: an Express app for the HTTP surface (health, room lookup, the built
 * client in production) with the Colyseus WebSocket transport attached to the same
 * server, so nginx only needs to proxy a single upstream port.
 */

import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { BUILTIN_PACKS, packFlavour } from '@wvtt/shared';
import { TableRoom } from './rooms/TableRoom.js';
import { hasRoom, pruneOldRooms } from './persistence.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 2567);
const IS_PROD = process.env.NODE_ENV === 'production';

const app = express();
// Behind nginx/NPM, so the client address arrives in X-Forwarded-For. The port is
// firewalled to the proxy bridge, so the header cannot be spoofed from outside.
app.set('trust proxy', 1);

/**
 * Crude per-address limiter for room lookups.
 *
 * A room code is six characters from a 31-letter alphabet, which is far too few to
 * survive unlimited guessing: an attacker could walk the space and wander into private
 * tables. This makes enumeration impractical without needing a dependency.
 */
const lookupHits = new Map<string, { count: number; resetAt: number }>();
const LOOKUP_WINDOW_MS = 60_000;
const LOOKUP_MAX = 40;

function lookupAllowed(ip: string): boolean {
  const now = Date.now();
  const hit = lookupHits.get(ip);
  if (!hit || now > hit.resetAt) {
    lookupHits.set(ip, { count: 1, resetAt: now + LOOKUP_WINDOW_MS });
    return true;
  }
  hit.count += 1;
  return hit.count <= LOOKUP_MAX;
}

// Keep the table from growing without bound.
setInterval(() => {
  const now = Date.now();
  for (const [ip, hit] of lookupHits) if (now > hit.resetAt) lookupHits.delete(ip);
}, LOOKUP_WINDOW_MS).unref();
app.use(express.json({ limit: '5mb' }));
// In development the Vite dev server is a different origin; in production the client
// is served from this same origin and no cross-origin access is needed.
app.use(cors({ origin: IS_PROD ? false : true }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

/**
 * The game picker reads this rather than bundling pack definitions into the client.
 *
 * `flavour` says which column of the home page a pack belongs in. It is computed here
 * because it depends on whether the pack has a rules script, and the script itself is
 * far too big to ship to a client that is only drawing a menu.
 */
app.get('/api/packs', (_req, res) => {
  res.json(BUILTIN_PACKS.map((p) => ({ ...p.manifest, flavour: packFlavour(p) })));
});

/**
 * Resolve a shareable room code to a joinable room id.
 * Returns 404 when the code is unknown so the client can offer to create it instead.
 */
app.get('/api/room/:code', async (req, res) => {
  if (!lookupAllowed(req.ip ?? 'unknown')) {
    return res.status(429).json({ error: 'Too many lookups. Wait a minute and try again.' });
  }
  const code = String(req.params.code ?? '').toUpperCase();
  try {
    const rooms = await matchMaker.query({ name: 'table' });
    const found = rooms.find((r) => (r.metadata as { roomCode?: string })?.roomCode === code);
    if (found) {
      return res.json({
        roomId: found.roomId,
        clients: found.clients,
        packName: (found.metadata as { packName?: string })?.packName,
      });
    }
    // Not running, but it may have been saved before the last restart. The client then
    // asks for a room with this code and the server rebuilds it from the snapshot.
    if (hasRoom(code)) return res.json({ restorable: true });
    return res.status(404).json({ error: 'No room with that code.' });
  } catch (err) {
    res.status(500).json({ error: 'Lookup failed.' });
  }
});

if (IS_PROD) {
  const clientDir = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDir));
  // Any non-API path is a client route; hand it the SPA shell.
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
}

const pruned = pruneOldRooms();
if (pruned > 0) console.log(`[wvtt] removed ${pruned} stale room snapshot(s)`);

// Keep sweeping. Startup-only pruning never runs on a server that stays up for weeks,
// which is exactly the server this is.
setInterval(() => {
  const n = pruneOldRooms();
  if (n > 0) console.log(`[wvtt] removed ${n} stale room snapshot(s)`);
}, 60 * 60 * 1000).unref();

const httpServer = createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer,
    /**
     * The transport defaults to a 4 KB message cap, which silently disconnects (ws
     * code 1009) anyone loading a pack — a copy of the built-in chess pack is 12 KB,
     * and the format allows 4 MB. Raised to just above the pack ceiling; the room
     * checks the actual size before parsing, and per-client rate limits stop anyone
     * pushing large messages repeatedly.
     */
    maxPayload: 5 * 1024 * 1024,
  }),
});

gameServer.define('table', TableRoom)
  // Let clients join by room code via matchmaking filters as well as the lookup route.
  .filterBy(['roomCode']);

await gameServer.listen(PORT);
console.log(`[wvtt] listening on http://localhost:${PORT} (${IS_PROD ? 'production' : 'development'})`);
