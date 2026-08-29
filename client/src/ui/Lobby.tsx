import { useEffect, useState } from 'react';
import { apiUrl, forgetRecentRoom, recentRooms, useStore, type RecentRoom } from '../net/store';

/**
 * What the picker shows for one game.
 *
 * Fetched from the server rather than bundled: the pack list is the server's business,
 * and a pack's components — 108 cards, or a hundred lines of prompt text — have no
 * reason to be downloaded by someone who is still choosing what to play.
 */
interface PackCard {
  id: string;
  name: string;
  description: string;
  /** Absent when the server predates this field; see flavourOf(). */
  flavour?: 'sandbox' | 'scripted';
  minSeats: number;
  maxSeats: number;
}

/**
 * Shown until the list arrives, and kept as the fallback if it never does.
 *
 * A lobby that cannot offer a game is useless, so a failed fetch degrades to the
 * built-ins everyone has rather than an empty column.
 */
const FALLBACK: PackCard[] = [
  { id: 'sandbox', name: 'Card Sandbox', description: 'A 52-card deck and no rules at all.', flavour: 'sandbox', minSeats: 1, maxSeats: 6 },
  { id: 'dice', name: 'Dice Tray', description: 'Full polyhedral set, rolled by the server.', flavour: 'sandbox', minSeats: 1, maxSeats: 6 },
  { id: 'board', name: 'Blank Board', description: 'A grid and tokens. Build your own game.', flavour: 'sandbox', minSeats: 1, maxSeats: 6 },
  { id: 'eights', name: 'Crazy Eights', description: 'Match the suit or the rank. Eights are wild.', flavour: 'scripted', minSeats: 2, maxSeats: 6 },
  { id: 'wildcolours', name: 'Wild Colours', description: 'Colours, skips, reverses and wilds.', flavour: 'scripted', minSeats: 2, maxSeats: 6 },
  { id: 'promptparty', name: 'Prompt Party', description: 'Fill in the blank; the judge picks a winner.', flavour: 'scripted', minSeats: 3, maxSeats: 6 },
  { id: 'poker', name: "Texas Hold'em", description: 'Felt, chips, blinds and a dealer button.', flavour: 'scripted', minSeats: 2, maxSeats: 6 },
  { id: 'chess', name: 'Chess', description: 'Snapping board, optional rules enforcement.', flavour: 'scripted', minSeats: 2, maxSeats: 2 },
];

/**
 * Which column a pack belongs in.
 *
 * `flavour` comes from the server, but a server older than that field returns nothing —
 * and a missing field must not quietly file every game under Sandbox, which is exactly
 * what a plain `!== 'scripted'` test does. The built-ins are named here as a backstop;
 * an unknown pack from an old server lands in Sandbox, which is the safer guess for a
 * pack nobody can vouch for.
 */
const KNOWN_FLAVOURS: Record<string, PackCard['flavour']> =
  Object.fromEntries(FALLBACK.map((p) => [p.id, p.flavour]));

function flavourOf(p: PackCard): PackCard['flavour'] {
  return p.flavour ?? KNOWN_FLAVOURS[p.id] ?? 'sandbox';
}

export function Lobby() {
  const connect = useStore((s) => s.connect);
  const phase = useStore((s) => s.phase);
  const error = useStore((s) => s.error);

  const [name, setName] = useState(() => localStorage.getItem('wvtt:name') ?? '');
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room') ?? '');
  const [packId, setPackId] = useState('sandbox');
  const [packs, setPacks] = useState<PackCard[]>(FALLBACK);
  const [recent, setRecent] = useState<RecentRoom[]>(() => recentRooms());
  const setPendingEditor = useStore((s) => s.setPendingEditor);

  useEffect(() => {
    let live = true;
    fetch(apiUrl('/api/packs'))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad status'))))
      .then((list: PackCard[]) => {
        if (live && Array.isArray(list) && list.length) setPacks(list);
      })
      .catch(() => { /* the fallback list is already on screen */ });
    return () => { live = false; };
  }, []);

  const busy = phase === 'connecting';
  const sandbox = packs.filter((p) => flavourOf(p) !== 'scripted');
  const scripted = packs.filter((p) => flavourOf(p) === 'scripted');

  function remember(n: string) {
    setName(n);
    localStorage.setItem('wvtt:name', n);
  }

  /** "20 minutes ago", "yesterday" — enough to tell one table from another. */
  function ago(at: number): string {
    const mins = Math.max(0, Math.round((Date.now() - at) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  function drop(code: string) {
    forgetRecentRoom(code);
    setRecent(recentRooms());
  }

  function seatsLine(p: PackCard): string {
    if (p.minSeats === p.maxSeats) return `${p.minSeats} players`;
    return `${p.minSeats}–${p.maxSeats} players`;
  }

  function column(title: string, blurb: string, list: PackCard[]) {
    return (
      <div className="col">
        <h2>{title}</h2>
        <p className="hint colblurb">{blurb}</p>
        <div className="packs one">
          {list.map((p) => (
            <button
              key={p.id}
              className={`pack ${packId === p.id ? 'on' : ''}`}
              onClick={() => setPackId(p.id)}
              type="button"
            >
              <strong>{p.name}</strong>
              <span className="desc">{p.description}</span>
              <span className="seats-line">{seatsLine(p)}</span>
            </button>
          ))}
        </div>
      </div>
    );
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

        {/* Sandboxes on the left, games that referee themselves on the right. The two
            are different propositions and asking someone to spot the difference from a
            single grid of tiles never worked. */}
        <div className="split games">
          {column('Sandbox', 'Kit with no rules attached. Move anything anywhere.', sandbox)}
          {column('Scripted games', 'Rules enforced by the table. Switch enforcement off at any time.', scripted)}
        </div>

        {recent.length > 0 && (
          <div className="recent">
            <h2>Tables you have been at</h2>
            <p className="hint colblurb">
              A table is kept for a week after everyone leaves, with its cards where you left them.
            </p>
            <div className="recent-list">
              {recent.map((r) => (
                <div className="recent-row" key={r.code}>
                  <button
                    className="rejoin"
                    disabled={busy}
                    onClick={() => connect({ name: name || 'Guest', roomCode: r.code })}
                  >
                    <strong>{r.code}</strong>
                    <span>{r.packName || 'table'} · {ago(r.at)}</span>
                  </button>
                  <button className="icon" title="Forget this table" onClick={() => drop(r.code)}>✕</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* The editor needs a table to load a pack onto, so this makes one first and
            opens the editor on top of it. Before this, the feature was buried in a menu
            inside a room and nobody knew it existed. */}
        <div className="make-own">
          <div>
            <h2>Make your own game</h2>
            <p className="hint">
              Describe the game, let an AI assistant draft the pack, then play it. Or build it by
              hand — the built-in games use exactly the same format.
            </p>
          </div>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              setPendingEditor(true);
              connect({ name: name || 'Guest', packId: 'sandbox' });
            }}
          >
            Open the pack editor
          </button>
        </div>

        <div className="lobby-actions">
          <button
            className="primary"
            disabled={busy}
            onClick={() => connect({ name: name || 'Guest', packId })}
          >
            {busy ? 'Starting…' : 'Create table'}
          </button>

          <div className="join">
            <input
              className="code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
              placeholder="CODE"
              maxLength={6}
              autoCapitalize="characters"
              aria-label="Room code"
            />
            <button
              className="secondary"
              disabled={busy || code.length < 4}
              onClick={() => connect({ name: name || 'Guest', roomCode: code })}
            >
              Join a table
            </button>
          </div>
        </div>
        <p className="hint">Ask whoever started the table for its six-character code.</p>

        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}
