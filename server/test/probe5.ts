import { createServer } from 'node:http';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client } from 'colyseus.js';
import { TableRoom } from '../src/rooms/TableRoom.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const httpServer = createServer();
const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
gameServer.define('table', TableRoom);
await gameServer.listen(2588);

const c = new Client('ws://localhost:2588');
const room = await c.joinOrCreate('table', { name: 'Ana', packId: 'sandbox' });
await sleep(800);

const view = () => {
  const s = room.state.toJSON() as any;
  const sizes = Object.values<any>(s.stacks).map((st) => st.pieceIds?.length ?? 0);
  const inStacks = sizes.reduce((a: number, b: number) => a + b, 0);
  const withStackId = Object.values<any>(s.pieces).filter((p) => p.stackId).length;
  return { pieces: Object.keys(s.pieces).length, sizes: sizes.join(','), inStacks, withStackId };
};

console.log('client before unstack:', JSON.stringify(view()));
const deckId = Object.keys((room.state.toJSON() as any).stacks)[0];
room.send('op', { t: 'unstack', stackId: deckId, count: 26, x: 2, z: 0 });
await sleep(1500);
console.log('client after unstack :', JSON.stringify(view()));

// Nudge the server to re-send: does a later change repair it?
room.send('op', { t: 'shuffle', stackId: deckId });
await sleep(1200);
console.log('client after shuffle :', JSON.stringify(view()));

await gameServer.gracefullyShutdown(false);
process.exit(0);
