/**
 * Build, boot the production server, run the production smoke test, shut down.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = process.env.PORT ?? '2580';
let server;

const sh = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  const c = spawn(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
  c.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))));
});

async function waitFor(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`production server did not start on ${url}`);
}

try {
  console.log('building…');
  await sh('npm', ['run', 'build']);

  server = spawn('node', ['server/dist/index.js'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'production', PORT },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitFor(`http://localhost:${PORT}/api/health`);

  await sh('node', [path.join(root, 'test/e2e/production.mjs')], { env: { ...process.env, PORT } });
  server.kill('SIGTERM');
  process.exit(0);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  server?.kill('SIGTERM');
  process.exit(1);
}
