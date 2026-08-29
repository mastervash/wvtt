/**
 * Token buckets, for keeping one client from monopolising a room.
 *
 * Nothing here is about correctness — the server already validates every op — it is
 * about cost. A client that floods ops makes the server re-encode state and every other
 * player's browser re-render, so a single bad actor can spoil a table for everyone.
 */

export interface Bucket {
  tokens: number;
  capacity: number;
  /** Tokens restored per second. */
  refill: number;
  last: number;
}

export function bucket(capacity: number, refillPerSecond: number): Bucket {
  return { tokens: capacity, capacity, refill: refillPerSecond, last: Date.now() };
}

/** Spend a token. Returns false when the caller is going too fast. */
export function take(b: Bucket, cost = 1): boolean {
  const now = Date.now();
  b.tokens = Math.min(b.capacity, b.tokens + ((now - b.last) / 1000) * b.refill);
  b.last = now;
  if (b.tokens < cost) return false;
  b.tokens -= cost;
  return true;
}

/**
 * Per-client allowances.
 *
 * Dragging alone streams about thirty moves a second plus pointer updates, so the
 * ordinary op budget has to be generous; the heavy and chat budgets are what actually
 * matter.
 */
export interface ClientLimits {
  /** Ordinary table operations: moves, flips, pointer updates. */
  ops: Bucket;
  /** Expensive operations: loading a pack, resetting the table. */
  heavy: Bucket;
  chat: Bucket;
  /**
   * Pings, which are broadcast to every client and animate on every screen.
   *
   * They ride the ordinary op budget otherwise, which allows over a hundred a second —
   * enough for one player to cover everyone else's table in rings. Deliberately close
   * to what a person can actually click.
   */
  ping: Bucket;
}

export function newClientLimits(): ClientLimits {
  return {
    ops: bucket(240, 120),
    heavy: bucket(3, 0.3),
    chat: bucket(8, 1),
    ping: bucket(4, 1),
  };
}
