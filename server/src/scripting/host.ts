/**
 * The script isolate.
 *
 * A pack's rules script is untrusted code written by whoever authored the pack, so it
 * runs inside QuickJS compiled to WebAssembly: a separate heap, a hard memory cap, an
 * instruction budget that kills runaway loops, and no host bindings at all. There is
 * no filesystem, no network, no timers and no module loader inside — the only way out
 * is the single JSON bridge function this class installs.
 *
 * What a script CAN do is read the table, including face-down cards, because enforcing
 * the rules of poker requires knowing the hole cards. A pack you did not write is
 * therefore trusted the way a human dealer is trusted, and the UI says so before it
 * loads one.
 */

import { getQuickJS, type QuickJSContext, type QuickJSRuntime } from 'quickjs-emscripten';
import { PRELUDE } from './prelude.js';

/** A host-side implementation of one `table.*` method. */
export type HostFn = (args: unknown[]) => unknown;

export interface ScriptLimits {
  memoryBytes: number;
  /** Hard cap; see the note where this is applied before changing it. */
  stackBytes: number;
  /** Interrupt checks allowed per call before the script is killed. */
  interruptBudget: number;
  /** Wall-clock ceiling per call, as a backstop for slow host calls. */
  timeoutMs: number;
}

export const DEFAULT_LIMITS: ScriptLimits = {
  memoryBytes: 16 * 1024 * 1024,
  stackBytes: 128 * 1024,
  interruptBudget: 400_000,
  timeoutMs: 250,
};

export interface CallResult {
  ok: boolean;
  value?: unknown;
  error?: string;
  /** Reason passed to table.reject(), if the script refused the action. */
  rejection?: string | null;
}

export class ScriptHost {
  private runtime: QuickJSRuntime;
  private ctx: QuickJSContext;
  private ticks = 0;
  private deadline = 0;
  private disposed = false;
  /** Set when an error escaped the isolate; the runtime is then unsafe to free. */
  private poisoned = false;

  private constructor(runtime: QuickJSRuntime, ctx: QuickJSContext, private limits: ScriptLimits) {
    this.runtime = runtime;
    this.ctx = ctx;
  }

  /**
   * Compile a pack script. Returns null when the script fails to load, so a broken
   * pack degrades to a plain sandbox table rather than breaking the room.
   */
  static async create(
    script: string,
    api: Record<string, HostFn>,
    limits: ScriptLimits = DEFAULT_LIMITS,
  ): Promise<{ host: ScriptHost | null; error?: string }> {
    const QuickJS = await getQuickJS();
    const runtime = QuickJS.newRuntime();
    runtime.setMemoryLimit(limits.memoryBytes);
    // Must stay at or below 256 KB. Above that QuickJS fails to catch its own stack
    // overflow: the recursion exhausts the WASM stack instead, the RangeError escapes
    // into the host, and the runtime is left corrupt enough that disposing it aborts
    // the process. Verified empirically — do not raise this.
    runtime.setMaxStackSize(limits.stackBytes);

    const ctx = runtime.newContext();
    const host = new ScriptHost(runtime, ctx, limits);

    runtime.setInterruptHandler(() => {
      if (++host.ticks > limits.interruptBudget) return true;
      return host.deadline > 0 && Date.now() > host.deadline;
    });

    // The single bridge. Everything the script can do to the table goes through here.
    const bridge = ctx.newFunction('__host', (nameHandle, argsHandle) => {
      const name = ctx.getString(nameHandle);
      const rawArgs = ctx.getString(argsHandle);
      try {
        const fn = api[name];
        if (!fn) return ctx.newString(JSON.stringify({ error: `Unknown table method "${name}"` }));
        const args = JSON.parse(rawArgs) as unknown[];
        const value = fn(args);
        // Undefined does not survive JSON, so normalise it to null.
        return ctx.newString(JSON.stringify({ value: value === undefined ? null : value }));
      } catch (err) {
        return ctx.newString(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
    });
    ctx.setProp(ctx.global, '__host', bridge);
    bridge.dispose();

    const pre = host.run(PRELUDE);
    if (!pre.ok) {
      host.dispose();
      return { host: null, error: `Sandbox failed to initialise: ${pre.error}` };
    }

    const loaded = host.run(script);
    if (!loaded.ok) {
      host.dispose();
      return { host: null, error: loaded.error };
    }

    return { host };
  }

  /** Is a given handler defined by the script? */
  has(handler: string): boolean {
    const res = this.run(`typeof ${handler} === 'function'`);
    return res.ok && res.value === true;
  }

  /**
   * Invoke a script handler with JSON arguments.
   *
   * Arguments are injected as a parsed JSON literal rather than marshalled handle by
   * handle, which keeps the bridge to one shape and avoids leaking host objects.
   */
  call(handler: string, args: unknown[]): CallResult {
    if (this.disposed) return { ok: false, error: 'Script host disposed' };
    const payload = JSON.stringify(args).replace(/</g, '\\u003c');
    const code = `
      (function () {
        if (typeof ${handler} !== 'function') return { __missing: true };
        var a = JSON.parse(${JSON.stringify(payload)});
        var out = ${handler}.apply(null, [table].concat(a));
        return { out: out === undefined ? null : out, rejected: table.__takeRejection() };
      })()
    `;
    const res = this.run(code);
    if (!res.ok) return res;
    const wrapped = res.value as { __missing?: boolean; out?: unknown; rejected?: string | null };
    if (wrapped?.__missing) return { ok: true, value: undefined, rejection: null };
    return { ok: true, value: wrapped?.out, rejection: wrapped?.rejected ?? null };
  }

  /** Evaluate code, converting the result to plain JSON. */
  private run(code: string): CallResult {
    if (this.disposed) return { ok: false, error: 'Script host disposed' };
    this.ticks = 0;
    this.deadline = Date.now() + this.limits.timeoutMs;

    let result: ReturnType<QuickJSContext['evalCode']>;
    try {
      result = this.ctx.evalCode(code);
    } catch (err) {
      // Nothing should reach here now that the stack limit is bounded, but if a future
      // failure mode escapes the isolate, take the whole host out of service rather
      // than keep running against a runtime in an unknown state.
      this.poisoned = true;
      this.disposed = true;
      this.deadline = 0;
      return { ok: false, error: `Script crashed the sandbox: ${err instanceof Error ? err.name : String(err)}` };
    }

    if (result.error) {
      const err = this.ctx.dump(result.error) as { message?: string; name?: string };
      result.error.dispose();
      this.deadline = 0;
      const message = err?.message ?? String(err);
      // An interrupt surfaces as a generic error; name it usefully for the author.
      const timedOut = this.ticks > this.limits.interruptBudget;
      return { ok: false, error: timedOut ? 'Script took too long and was stopped.' : message };
    }

    const value = this.ctx.dump(result.value);
    result.value.dispose();
    this.deadline = 0;
    return { ok: true, value };
  }

  dispose() {
    if (this.disposed && this.poisoned) return;
    this.disposed = true;
    // Freeing a poisoned runtime trips an assertion inside QuickJS that aborts the
    // whole process. Leaking one isolate is the lesser failure.
    if (this.poisoned) return;
    try { this.ctx.dispose(); } catch { /* already gone */ }
    try { this.runtime.dispose(); } catch { /* already gone */ }
  }
}
