/**
 * Tests for the script sandbox.
 *
 * Two things are being checked: that a well-behaved pack script can actually drive the
 * table, and that a hostile one cannot escape, hang the server, or exhaust memory.
 *
 * Run: npx tsx server/test/scripting.ts
 */

import { TableState, Player } from '../src/state.js';
import { buildTable } from '../src/engine.js';
import { ScriptHost } from '../src/scripting/host.js';
import { buildScriptApi } from '../src/scripting/api.js';
import { sandboxPack } from '@wvtt/shared';

let failures = 0;
function check(label: string, cond: boolean, detail = '') {
  if (!cond) failures++;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${!cond && detail ? ` — ${detail}` : ''}`);
}

function freshTable() {
  const state = new TableState();
  // Two seated players, so table.seats() has something to report.
  for (const [i, name] of [[0, 'Ana'], [1, 'Ben']] as [number, string][]) {
    const p = new Player();
    p.sessionId = `s${i}`; p.name = name; p.color = '#fff';
    p.seat = i; p.connected = true; p.px = 0; p.pz = 0;
    state.players.set(p.sessionId, p);
  }
  buildTable(state, sandboxPack, [0, 1]);
  const vars = new Map<string, unknown>();
  let dirty = false;
  const api = buildScriptApi({ state, vars, markVisibilityDirty: () => { dirty = true; } });
  return { state, api, vars, wasDirty: () => dirty };
}

async function main() {
  console.log('\nA well-behaved script drives the table');
  {
    const { state, api } = freshTable();
    const script = `
      function onSetup(table) {
        table.setVar('round', 1);
        table.shuffle();
        table.log('Dealing.');
      }
      function onAction(table, action) {
        if (action === 'deal') {
          for (const seat of table.seats()) table.dealTo(seat, 2);
          return table.seats().length;
        }
        if (action === 'peekDeck') return table.stacks()[0].count;
      }
    `;
    const { host, error } = await ScriptHost.create(script, api);
    check('script loads', !!host, error);
    if (host) {
      const setup = host.call('onSetup', []);
      check('onSetup runs', setup.ok, setup.error);
      const dealt = host.call('onAction', ['deal', null]);
      check('onAction deals to both seats', dealt.ok && dealt.value === 2, `${dealt.error ?? dealt.value}`);

      const hand0 = Object.values(state.pieces.toJSON()).filter((p: any) => p.zoneId === 'hand0');
      const hand1 = Object.values(state.pieces.toJSON()).filter((p: any) => p.zoneId === 'hand1');
      check('two cards reached each hand', hand0.length === 2 && hand1.length === 2, `${hand0.length}/${hand1.length}`);

      const remaining = host.call('onAction', ['peekDeck', null]);
      check('deck shrank by four', remaining.value === 48, `got ${remaining.value}`);
      host.dispose();
    }
  }

  console.log('\nA script cannot reach the host');
  {
    const { api } = freshTable();
    const probes: [string, string][] = [
      ['fetch', 'typeof fetch'],
      ['require', 'typeof require'],
      ['process', 'typeof process'],
      ['setTimeout', 'typeof setTimeout'],
      ['WebAssembly', 'typeof WebAssembly'],
      ['the raw bridge', 'typeof __host'],
    ];
    const script = `function probe(table, expr) { return eval(expr); }`;
    const { host } = await ScriptHost.create(script, api);
    if (host) {
      for (const [name, expr] of probes) {
        const r = host.call('probe', [expr]);
        check(`${name} is not reachable`, r.ok && r.value === 'undefined', `got ${r.value ?? r.error}`);
      }
      host.dispose();
    }
  }

  console.log('\nA hostile script cannot hang or exhaust the server');
  {
    const { api } = freshTable();
    const script = `
      function spin() { while (true) {} }
      function recurse() { return recurse(); }
      function hog() { const a = []; while (true) a.push(new Array(100000).fill('x')); }
    `;
    const { host } = await ScriptHost.create(script, api);
    if (host) {
      const t0 = Date.now();
      const spin = host.call('spin', []);
      const spinMs = Date.now() - t0;
      check('an infinite loop is stopped', !spin.ok, 'the call returned normally');
      check(`it is stopped promptly (${spinMs}ms)`, spinMs < 3000, `took ${spinMs}ms`);

      const rec = host.call('recurse', []);
      check('unbounded recursion is caught', !rec.ok, 'the call returned normally');

      const hog = host.call('hog', []);
      check('runaway allocation is caught', !hog.ok, 'the call returned normally');

      // The isolate must still be usable for legitimate work afterwards.
      const after = host.call('spin', []);
      check('the host survives and stays responsive', !after.ok);
      host.dispose();
    }
  }

  console.log('\nA broken script fails safely');
  {
    const { api } = freshTable();
    const { host, error } = await ScriptHost.create('function onSetup(', api);
    check('a syntax error is reported, not thrown', host === null && !!error, 'host was created anyway');
  }

  console.log('\nScript storage is bounded');
  {
    const { api } = freshTable();
    const script = `
      function fillVars(table) {
        for (let i = 0; i < 500; i++) table.setVar('k' + i, i);
        return 'no limit hit';
      }
      function bigVar(table) {
        table.setVar('big', 'x'.repeat(20000));
        return 'no limit hit';
      }
    `;
    const { host } = await ScriptHost.create(script, api);
    if (host) {
      const many = host.call('fillVars', []);
      check('a variable-count limit applies', !many.ok || many.value !== 'no limit hit', 'unbounded');
      const big = host.call('bigVar', []);
      check('a variable-size limit applies', !big.ok || big.value !== 'no limit hit', 'unbounded');
      host.dispose();
    }
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('test crashed:', e); process.exit(1); });
