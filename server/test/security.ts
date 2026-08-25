/**
 * Security regression tests.
 *
 * Each of these corresponds to something found in an audit. They are cheap to run and
 * expensive to rediscover.
 *
 * Run: npx tsx server/test/security.ts
 */

import { createServer } from 'node:http';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client } from 'colyseus.js';
import { TableRoom } from '../src/rooms/TableRoom.js';
import { validatePack } from '../src/packValidation.js';
import { loadRoom, saveRoom } from '../src/persistence.js';
import { chessPack, sandboxPack, type GamePack } from '@wvtt/shared';

const PORT = 2582;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label: string, cond: boolean, detail = '') {
  if (!cond) failures++;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${!cond && detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const hs = createServer();
  const gs = new Server({
    transport: new WebSocketTransport({ server: hs, maxPayload: 5 * 1024 * 1024 }),
  });
  gs.define('table', TableRoom);
  await gs.listen(PORT);

  console.log('\nA real pack fits through the socket');
  {
    const c = new Client(`ws://localhost:${PORT}`);
    const room = await c.joinOrCreate('table', { name: 'Ana' });
    await sleep(600);
    let leftCode = 0;
    room.onLeave((code) => { leftCode = code; });

    const json = JSON.stringify({ ...chessPack, manifest: { ...chessPack.manifest, id: 'copy', name: 'Copied Chess' } });
    check('the pack is bigger than the old 4KB cap', json.length > 4096, `${json.length} bytes`);
    room.send('loadPack', { packJson: json });
    await sleep(1500);
    check('the client is not disconnected', leftCode === 0, `closed with ${leftCode}`);
    check('the pack actually loads', (room.state.toJSON() as any).packName === 'Copied Chess',
      (room.state.toJSON() as any).packName);
    await room.leave(true);
  }

  console.log('\nAn oversized pack is refused, not parsed');
  {
    const c = new Client(`ws://localhost:${PORT}`);
    const room = await c.joinOrCreate('table', { name: 'Ben' });
    await sleep(600);
    const errors: string[] = [];
    room.onMessage('opError', (m: any) => errors.push(m.error));
    // Well past the 4MB pack ceiling but under the transport cap.
    room.send('loadPack', { packJson: `{"junk":"${'x'.repeat(4.5 * 1024 * 1024)}"}` });
    await sleep(1500);
    check('it is rejected for size', errors.some((e) => /too large/i.test(e)), errors.join(' | '));
    check('the table is untouched', (room.state.toJSON() as any).packName === 'Card Sandbox');
    await room.leave(true);
  }

  console.log('\nFlooding is throttled');
  {
    const c = new Client(`ws://localhost:${PORT}`);
    const room = await c.joinOrCreate('table', { name: 'Flood' });
    await sleep(600);
    const errors: string[] = [];
    room.onMessage('opError', (m: any) => errors.push(m.error));
    for (let i = 0; i < 60; i++) room.send('op', { t: 'chat', text: `spam ${i}` });
    await sleep(1500);
    const chat = (room.state.toJSON() as any).chat as unknown[];
    check('most of a chat flood is dropped', chat.length < 20, `${chat.length} messages got through`);
    check('the flooder is told to slow down', errors.some((e) => /slow down/i.test(e)), errors.join(' | '));
    await room.leave(true);
  }

  console.log('\nUntrusted pack content');
  {
    const svg: GamePack = {
      ...sandboxPack,
      manifest: { ...sandboxPack.manifest, id: 'svg' },
      components: [{
        id: 'x', kind: 'card', label: 'x',
        front: { type: 'image', dataUri: 'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+' },
      }],
      setup: [],
    };
    check('an SVG face is rejected', !validatePack(svg).ok, 'SVG accepted');

    const png: GamePack = {
      ...svg,
      components: [{
        id: 'x', kind: 'card', label: 'x',
        front: { type: 'image', dataUri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==' },
      }],
    };
    check('an ordinary PNG face is still accepted', validatePack(png).ok, validatePack(png).errors.join('; '));
  }

  console.log('\nRoom codes cannot escape their directory');
  {
    const evil = '../../../../tmp/pwned';
    saveRoom({
      version: 1, roomCode: evil, savedAt: Date.now(), enforcement: 'off', autoStack: true,
      pack: sandboxPack, pieces: [], stacks: [], scriptVars: [],
    });
    check('a traversal code writes nothing', loadRoom(evil) === null);
    check('a well-formed code is unaffected', (() => {
      saveRoom({
        version: 1, roomCode: 'ABC123', savedAt: Date.now(), enforcement: 'off', autoStack: true,
        pack: sandboxPack, pieces: [], stacks: [], scriptVars: [],
      });
      return loadRoom('ABC123') !== null;
    })());
  }

  console.log('\nOps are bounded');
  {
    const c = new Client(`ws://localhost:${PORT}`);
    const room = await c.joinOrCreate('table', { name: 'Edge' });
    await sleep(600);
    const piece = Object.values<any>((room.state.toJSON() as any).pieces)[0];
    room.send('op', { t: 'grab', target: piece.id });
    room.send('op', { t: 'move', target: piece.id, x: 1e9, z: -1e9 });
    await sleep(600);
    const after = (room.state.toJSON() as any).pieces[piece.id];
    check('a piece cannot be flung off the table', Math.abs(after.x) < 100 && Math.abs(after.z) < 100,
      `${after.x},${after.z}`);

    room.send('op', { t: 'chat', text: 'y'.repeat(5000) });
    await sleep(600);
    const chat = (room.state.toJSON() as any).chat as any[];
    const longest = Math.max(0, ...chat.map((m) => m.text.length));
    check('chat messages are truncated', longest <= 300, `${longest} characters`);
    await room.leave(true);
  }

  await gs.gracefullyShutdown(false);
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('test crashed:', e); process.exit(1); });
