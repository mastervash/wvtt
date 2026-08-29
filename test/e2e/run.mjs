/**
 * End-to-end runner.
 *
 * Starts the game server and the Vite dev server, waits for both to answer, runs each
 * browser suite in turn, then shuts everything down. Exits non-zero if any suite fails,
 * so it works unattended in CI.
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SUITES = ['multiplayer.mjs', 'editor.mjs', 'poker.mjs', 'menu.mjs', 'hotkeys.mjs', 'rooms.mjs', 'interaction.mjs', 'mobile.mjs'];
const children = [];

function start(name, args) {
  const child = spawn('npm', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => process.env.VERBOSE && process.stdout.write(`[${name}] ${d}`));
  child.stderr.on('data', (d) => process.env.VERBOSE && process.stderr.write(`[${name}] ${d}`));
  children.push(child);
  return child;
}

async function waitFor(url, label, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`${label} did not start within ${timeoutMs}ms`);
}

function run(suite) {
  return new Promise((resolve) => {
    const child = spawn('node', [path.join(root, 'test/e2e', suite)], { cwd: root, stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

function shutdown() {
  for (const c of children) { try { c.kill('SIGTERM'); } catch { /* already gone */ } }
}

process.on('SIGINT', () => { shutdown(); process.exit(130); });

try {
  mkdirSync(path.join(root, 'test/e2e/screenshots'), { recursive: true });

  console.log('starting servers…');
  start('server', ['run', 'dev', '--workspace=server']);
  start('client', ['run', 'dev', '--workspace=client']);
  await waitFor('http://localhost:2567/api/health', 'game server');
  await waitFor('http://localhost:5173/', 'client dev server');

  let failed = 0;
  for (const suite of SUITES) {
    console.log(`\n${'='.repeat(60)}\n${suite}\n${'='.repeat(60)}`);
    const code = await run(suite);
    if (code !== 0) failed++;
  }

  console.log(failed === 0 ? '\nAll e2e suites passed.' : `\n${failed} e2e suite(s) failed.`);
  shutdown();
  process.exit(failed === 0 ? 0 : 1);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  shutdown();
  process.exit(1);
}
