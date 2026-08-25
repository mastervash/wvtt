import { useState } from 'react';
import { useStore } from '../net/store';

const PACKS = [
  { id: 'sandbox', name: 'Card Sandbox', blurb: 'A 52-card deck and no rules at all.' },
  { id: 'poker', name: "Texas Hold'em", blurb: 'Felt, chips, blinds and a dealer button.' },
  { id: 'dice', name: 'Dice Tray', blurb: 'Full polyhedral set, rolled by the server.' },
  { id: 'chess', name: 'Chess', blurb: 'Snapping board, optional rules enforcement.' },
  { id: 'board', name: 'Blank Board', blurb: 'A grid and tokens. Build your own game.' },
];

export function Lobby() {
  const connect = useStore((s) => s.connect);
  const phase = useStore((s) => s.phase);
  const error = useStore((s) => s.error);

  const [name, setName] = useState(() => localStorage.getItem('wvtt:name') ?? '');
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room') ?? '');
  const [packId, setPackId] = useState('sandbox');

  const busy = phase === 'connecting';

  function remember(n: string) {
    setName(n);
    localStorage.setItem('wvtt:name', n);
  }

  return (
    <div className="lobby">
      <div className="lobby-card">
        <h1>WVTT</h1>
        <p className="sub">Web Virtual Table Top. Play cards, dice and board games with anyone. No account needed.</p>

        <label>
          Your name
          <input
            value={name}
            onChange={(e) => remember(e.target.value)}
            placeholder="Guest"
            maxLength={24}
          />
        </label>

        <div className="split">
          <div className="col">
            <h2>Start a table</h2>
            <div className="packs">
              {PACKS.map((p) => (
                <button
                  key={p.id}
                  className={`pack ${packId === p.id ? 'on' : ''}`}
                  onClick={() => setPackId(p.id)}
                  type="button"
                >
                  <strong>{p.name}</strong>
                  <span>{p.blurb}</span>
                </button>
              ))}
            </div>
            <button
              className="primary"
              disabled={busy}
              onClick={() => connect({ name: name || 'Guest', packId })}
            >
              {busy ? 'Starting…' : 'Create table'}
            </button>
          </div>

          <div className="col narrow">
            <h2>Join a table</h2>
            <input
              className="code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
              placeholder="CODE"
              maxLength={6}
              autoCapitalize="characters"
            />
            <button
              className="secondary"
              disabled={busy || code.length < 4}
              onClick={() => connect({ name: name || 'Guest', roomCode: code })}
            >
              Join
            </button>
            <p className="hint">Ask whoever started the table for its six-character code.</p>
          </div>
        </div>

        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}
