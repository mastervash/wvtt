/**
 * The game clock.
 *
 * Counted on the server so it cannot be gamed: a laggy client does not get extra time,
 * and reloading the page does not reset anything. Written generically rather than as a
 * chess feature, because any turn-based pack can use it.
 *
 * Two modes:
 *   auto   — the clock switches by itself when the active player completes a move.
 *   manual — the clock switches when that player presses it, like a real chess clock.
 */

import type { TableState } from './state.js';
import { pushLog } from './engine.js';

export const CLOCK_TICK_MS = 200;

/** Seats that currently have a player in them, in order. */
function occupiedSeats(state: TableState): number[] {
  const seats: number[] = [];
  state.players.forEach((p) => { if (p.seat >= 0) seats.push(p.seat); });
  return seats.sort((a, b) => a - b);
}

/**
 * Seats the clock should show.
 *
 * A chess clock has two faces whether or not your opponent has sat down yet, so the
 * pack's minimum seat count is included even when those seats are empty. Without this,
 * setting up a clock before the other player arrives shows a single lonely time.
 */
function clockSeats(state: TableState, minSeats: number): number[] {
  const seats = new Set(occupiedSeats(state));
  const wanted = Math.max(1, Math.min(state.maxSeats || 1, Math.floor(minSeats) || 1));
  for (let i = 0; i < wanted; i++) seats.add(i);
  return [...seats].sort((a, b) => a - b);
}

export function configureClock(
  state: TableState,
  baseMs: number,
  incrementMs: number,
  mode: 'auto' | 'manual',
  minSeats = 2,
): void {
  const clock = state.clock;
  clock.enabled = true;
  clock.mode = mode === 'manual' ? 'manual' : 'auto';
  // Between ten seconds and three hours; anything outside that is a mistake.
  clock.baseMs = Math.max(10_000, Math.min(3 * 60 * 60 * 1000, Math.floor(baseMs) || 0));
  clock.incrementMs = Math.max(0, Math.min(120_000, Math.floor(incrementMs) || 0));
  clock.minSeats = Math.max(1, Math.floor(minSeats) || 1);
  resetClock(state);
}

export function resetClock(state: TableState): void {
  const clock = state.clock;
  clock.running = false;
  clock.flaggedSeat = -1;
  clock.times.clear();
  const seats = clockSeats(state, clock.minSeats);
  for (const seat of seats) clock.times.set(String(seat), clock.baseMs);
  clock.activeSeat = seats.length > 0 ? seats[0] : -1;
}

/** Make sure every seated player has a time, e.g. after someone sits down late. */
export function syncSeats(state: TableState): void {
  const clock = state.clock;
  if (!clock.enabled) return;
  for (const seat of clockSeats(state, clock.minSeats)) {
    if (!clock.times.has(String(seat))) clock.times.set(String(seat), clock.baseMs);
  }
  if (clock.activeSeat < 0) {
    const seats = clockSeats(state, clock.minSeats);
    clock.activeSeat = seats.length > 0 ? seats[0] : -1;
  }
}

export function startClock(state: TableState): void {
  const clock = state.clock;
  if (!clock.enabled || clock.flaggedSeat >= 0) return;
  syncSeats(state);
  if (clock.activeSeat < 0) return;
  clock.running = true;
}

export function pauseClock(state: TableState): void {
  state.clock.running = false;
}

export function disableClock(state: TableState): void {
  const clock = state.clock;
  clock.enabled = false;
  clock.running = false;
  clock.activeSeat = -1;
  clock.flaggedSeat = -1;
  clock.times.clear();
}

/**
 * Hand the move to the next player.
 *
 * The player who just finished gets the increment, which is why this is called after
 * their move rather than before the next one.
 */
export function switchClock(state: TableState, fromSeat: number): void {
  const clock = state.clock;
  if (!clock.enabled || clock.flaggedSeat >= 0) return;
  syncSeats(state);

  const seats = clockSeats(state, clock.minSeats);
  if (seats.length === 0) return;
  if (fromSeat >= 0 && clock.activeSeat >= 0 && fromSeat !== clock.activeSeat) return;

  if (clock.incrementMs > 0 && clock.activeSeat >= 0) {
    const key = String(clock.activeSeat);
    clock.times.set(key, (clock.times.get(key) ?? clock.baseMs) + clock.incrementMs);
  }

  const i = seats.indexOf(clock.activeSeat);
  clock.activeSeat = seats[(i + 1 + seats.length) % seats.length];
  clock.running = true;
}

/**
 * Advance the clock. Returns true when something changed that clients need to see.
 *
 * Time is deducted from a wall-clock delta rather than assuming ticks arrive on
 * schedule, so a stalled event loop cannot give the mover free time.
 */
export function tickClock(state: TableState, elapsedMs: number): boolean {
  const clock = state.clock;
  if (!clock.enabled || !clock.running || clock.activeSeat < 0) return false;

  const key = String(clock.activeSeat);
  const remaining = clock.times.get(key);
  if (remaining === undefined) return false;

  const next = Math.max(0, remaining - elapsedMs);
  clock.times.set(key, next);

  if (next === 0) {
    clock.running = false;
    clock.flaggedSeat = clock.activeSeat;
    const name = seatName(state, clock.activeSeat);
    pushLog(state, `${name} ran out of time.`);
    state.status = `${name} lost on time`;
  }
  return true;
}

function seatName(state: TableState, seat: number): string {
  let name = `Seat ${seat + 1}`;
  state.players.forEach((p) => { if (p.seat === seat) name = p.name; });
  return name;
}
