/**
 * The game clock, as seen at the table.
 *
 * Shows one panel per seated player. Time is counted on the server; this only renders
 * what arrives, so the display cannot drift away from the truth.
 */

import { useStore, useMySeat } from '../net/store';

/** mm:ss, dropping to tenths in the last ten seconds the way a real clock does. */
function format(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < 10_000) return (safe / 1000).toFixed(1);
  const total = Math.ceil(safe / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function Clock() {
  const clock = useStore((s) => s.snap.clock);
  const players = useStore((s) => s.snap.players);
  const send = useStore((s) => s.send);
  const mySeat = useMySeat();

  if (!clock?.enabled) return null;

  const seats = Object.keys(clock.times ?? {})
    .map(Number)
    .sort((a, b) => a - b);
  if (seats.length === 0) return null;

  const nameOf = (seat: number) =>
    Object.values(players).find((p) => p.seat === seat)?.name ?? `Seat ${seat + 1}`;
  const colourOf = (seat: number) =>
    Object.values(players).find((p) => p.seat === seat)?.color ?? '#9aa3ad';

  const myTurn = clock.running && clock.activeSeat === mySeat && mySeat >= 0;

  return (
    <div className="clock">
      {seats.map((seat) => {
        const ms = clock.times[String(seat)] ?? 0;
        const active = clock.activeSeat === seat && clock.running;
        const flagged = clock.flaggedSeat === seat;
        return (
          <div
            key={seat}
            className={`clock-seat ${active ? 'active' : ''} ${flagged ? 'flagged' : ''} ${ms < 10_000 && !flagged ? 'low' : ''}`}
            style={{ borderColor: active ? colourOf(seat) : undefined }}
          >
            <span className="who">{nameOf(seat)}</span>
            <span className="time">{flagged ? '0.0' : format(ms)}</span>
          </div>
        );
      })}

      {clock.mode === 'manual' && myTurn && (
        <button className="clock-press" onClick={() => send({ t: 'clockPress' })}>
          Press
        </button>
      )}
      {!clock.running && clock.flaggedSeat < 0 && (
        <button className="clock-go" onClick={() => send({ t: 'clockStart' })}>Start</button>
      )}
      {clock.running && (
        <button className="clock-go" onClick={() => send({ t: 'clockPause' })}>Pause</button>
      )}
    </div>
  );
}

/** Clock setup, shown inside the table menu. */
export function ClockSettings() {
  const clock = useStore((s) => s.snap.clock);
  const send = useStore((s) => s.send);

  const minutes = [1, 3, 5, 10, 30];
  const increments = [0, 2, 5, 10];

  function configure(baseMin: number, incSec: number, mode: 'auto' | 'manual') {
    send({ t: 'clockConfig', baseMs: baseMin * 60_000, incrementMs: incSec * 1000, mode });
  }

  if (!clock?.enabled) {
    return (
      <>
        <h3>Clock</h3>
        <div className="chips">
          {minutes.map((m) => (
            <button key={m} onClick={() => configure(m, 0, 'auto')}>{m} min</button>
          ))}
        </div>
        <p className="hint">Adds a chess clock. You can change the mode and increment once it is on.</p>
      </>
    );
  }

  const baseMin = Math.round(clock.baseMs / 60_000);
  const incSec = Math.round(clock.incrementMs / 1000);

  return (
    <>
      <h3>Clock</h3>
      <div className="seg">
        {(['auto', 'manual'] as const).map((m) => (
          <button
            key={m}
            className={clock.mode === m ? 'on' : ''}
            onClick={() => configure(baseMin, incSec, m)}
          >
            {m === 'auto' ? 'Automatic' : 'Press to end'}
          </button>
        ))}
      </div>
      <p className="hint">
        {clock.mode === 'auto'
          ? 'The clock switches by itself when you finish a move.'
          : 'Press your clock to end your turn, like a real chess clock.'}
      </p>

      <span className="field-label">Time each</span>
      <div className="chips">
        {minutes.map((m) => (
          <button key={m} className={baseMin === m ? 'on' : ''} onClick={() => configure(m, incSec, clock.mode as 'auto' | 'manual')}>
            {m} min
          </button>
        ))}
      </div>

      <span className="field-label">Increment per move</span>
      <div className="chips">
        {increments.map((i) => (
          <button key={i} className={incSec === i ? 'on' : ''} onClick={() => configure(baseMin, i, clock.mode as 'auto' | 'manual')}>
            +{i}s
          </button>
        ))}
      </div>

      <div className="chips" style={{ marginTop: 8 }}>
        <button onClick={() => send({ t: 'clockReset' })}>Reset</button>
        <button onClick={() => send({ t: 'clockOff' })}>Remove clock</button>
      </div>
    </>
  );
}
