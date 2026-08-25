/**
 * The overlay: everything that is not the 3D table.
 *
 * Kept to a thin bar plus a hand tray, because the table itself should be the
 * interface wherever possible.
 */

import { lazy, Suspense, useMemo, useState } from 'react';

// The editor pulls in CodeMirror, which most players never open. Loading it on demand
// keeps it out of the bundle everyone downloads to sit at a table.
const Editor = lazy(() => import('./Editor').then((m) => ({ default: m.Editor })));
import type { ComponentDef } from '@wvtt/shared';
import { useStore, useMySeat } from '../net/store';
import { PieceMenu } from './PieceMenu';
import { Chat } from './Chat';
import { Clock, ClockSettings } from './Clock';
import { recenterCamera } from '../render/Table';
import { faceImage, backImage } from '../render/faces';

export function Hud() {
  const snap = useStore((s) => s.snap);
  const pack = useStore((s) => s.pack);
  const send = useStore((s) => s.send);
  const leave = useStore((s) => s.leave);
  const sessionId = useStore((s) => s.sessionId);
  const toast = useStore((s) => s.toast);
  const showToast = useStore((s) => s.showToast);
  const mySeat = useMySeat();

  const [menuOpen, setMenuOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // Track what has been read so the button can show there is something new.
  const [seenChat, setSeenChat] = useState(0);

  const defs = useMemo(() => {
    const m = new Map<string, ComponentDef>();
    for (const c of pack?.components ?? []) m.set(c.id, c);
    return m;
  }, [pack]);

  // The biggest pile on the table is almost always the draw deck.
  const mainStack = useMemo(() => {
    // A stack can arrive in one patch and its pieceIds in a later one, so never assume
    // the array is present.
    const stacks = Object.values(snap.stacks);
    if (stacks.length === 0) return null;
    return stacks.reduce((a, b) => ((b.pieceIds?.length ?? 0) > (a.pieceIds?.length ?? 0) ? b : a));
  }, [snap.stacks]);

  const myHand = useMemo(() => {
    if (mySeat < 0) return [];
    return Object.values(snap.pieces)
      .filter((p) => p.zoneId === `hand${mySeat}`)
      .sort((a, b) => a.order - b.order || a.x - b.x);
  }, [snap.pieces, mySeat]);

  // True when the pack drives the game itself and rules are switched on.
  const runsItsOwnGame = (pack?.manifest.actions?.length ?? 0) > 0 && snap.enforcement !== 'off';

  // Games like chess have no hand at all; showing an empty tray there is just noise.
  const hasHandZone = mySeat >= 0
    ? !!snap.zones[`hand${mySeat}`]
    : Object.values(snap.zones).some((z) => (z.ownerSeat ?? -1) >= 0);

  const unread = chatOpen ? 0 : Math.max(0, snap.chat.length - seenChat);

  const players = Object.values(snap.players);
  const seatsTaken = new Set(players.filter((p) => p.seat >= 0).map((p) => p.seat));

  function shareLink() {
    const url = `${location.origin}/?room=${snap.roomCode}`;
    navigator.clipboard?.writeText(url).then(
      () => showToast('Invite link copied.'),
      () => showToast(url),
    );
  }

  function dealToEveryone(count: number) {
    if (!mainStack) return;
    const zones = players
      .filter((p) => p.seat >= 0)
      .map((p) => `hand${p.seat}`)
      .filter((z) => snap.zones[z]);
    if (zones.length === 0) return showToast('Nobody is seated.');
    send({ t: 'deal', stackId: mainStack.id, count, toZoneIds: zones });
  }

  return (
    <>
      <div className="topbar">
        <button className="icon" onClick={() => setMenuOpen((v) => !v)} title="Menu">☰</button>
        <div className="room" onClick={shareLink} title="Copy invite link">
          <span className="code">{snap.roomCode}</span>
          <span className="pack">{snap.packName}</span>
        </div>

        {snap.status && <div className="status" title="Set by the game's rules">{snap.status}</div>}

        <div className="actions">
          {/* A pack that runs its own game supplies its own buttons; the generic deck
              controls would only be refused by its rules, so they are hidden. */}
          {mainStack && !runsItsOwnGame && (
            <>
              <button onClick={() => send({ t: 'shuffle', stackId: mainStack.id })}>Shuffle</button>
              <button onClick={() => dealToEveryone(1)}>Deal 1</button>
              <button onClick={() => dealToEveryone(2)}>Deal 2</button>
            </>
          )}
          {(pack?.manifest.actions ?? []).map((a) => (
            <button
              key={a.id}
              className="game-action"
              onClick={() => send({ t: 'scriptAction', action: a.id })}
              title={snap.enforcement === 'off' ? 'Turn rules on to use game actions' : undefined}
              disabled={snap.enforcement === 'off'}
            >
              {a.label}
            </button>
          ))}
          <button onClick={() => recenterCamera()} title="Recentre the view on your seat">Recentre</button>
          <button
            className={unread > 0 ? 'has-unread' : ''}
            onClick={() => { setChatOpen((v) => !v); setSeenChat(snap.chat.length); }}
          >
            Chat{unread > 0 ? ` (${unread})` : ''}
          </button>
          <button onClick={() => setLogOpen((v) => !v)}>Log</button>
        </div>

        <div className="players">
          {players.map((p) => (
            <span
              key={p.sessionId}
              className={`chip ${p.connected ? '' : 'away'} ${p.sessionId === sessionId ? 'me' : ''}`}
              style={{ borderColor: p.color }}
              title={p.seat >= 0 ? `Seat ${p.seat + 1}` : 'Spectating'}
            >
              {p.name}
            </span>
          ))}
        </div>
      </div>

      {menuOpen && (
        <div className="menu">
          <h3>Seat</h3>
          <div className="seats">
            {Array.from({ length: snap.maxSeats }, (_, i) => (
              <button
                key={i}
                className={mySeat === i ? 'on' : ''}
                disabled={seatsTaken.has(i) && mySeat !== i}
                onClick={() => send({ t: 'sit', seat: i })}
              >
                {i + 1}
              </button>
            ))}
            <button onClick={() => send({ t: 'stand' })}>Stand</button>
          </div>

          <h3>Rules</h3>
          <div className="seg">
            {(['off', 'advisory', 'enforced'] as const).map((m) => (
              <button
                key={m}
                className={snap.enforcement === m ? 'on' : ''}
                onClick={() => send({ t: 'setEnforcement', mode: m })}
              >
                {m}
              </button>
            ))}
          </div>
          <p className="hint">
            {snap.enforcement === 'off' && 'Nothing is enforced. Move anything anywhere.'}
            {snap.enforcement === 'advisory' && 'Illegal moves are allowed but flagged.'}
            {snap.enforcement === 'enforced' && "The game's script can refuse a move."}
          </p>

          <ClockSettings />

          <h3>Table</h3>
          <label className="check" style={{ marginBottom: 6 }}>
            <input
              type="checkbox"
              checked={snap.autoStack}
              onChange={(e) => send({ t: 'setAutoStack', on: e.target.checked })}
            />
            Cards snap into piles when laid on each other
          </label>
          <button className="wide" onClick={() => { setEditorOpen(true); setMenuOpen(false); }}>
            Make your own game
          </button>
          <button className="wide" onClick={() => { send({ t: 'resetTable' }); setMenuOpen(false); }}>
            Reset table
          </button>
          <button className="wide danger" onClick={leave}>Leave table</button>
        </div>
      )}

      {logOpen && (
        <div className="log">
          {snap.log.length === 0 && <p className="hint">Nothing has happened yet.</p>}
          {[...snap.log].reverse().map((l) => (
            <div key={l.id} className="line">{l.text}</div>
          ))}
        </div>
      )}

      {mySeat >= 0 && hasHandZone && (
        <div className="tray">
          {myHand.length === 0 && <div className="tray-empty">Your hand is empty. Tap the deck to draw.</div>}
          {myHand.map((p) => {
            const def = defs.get(p.defId);
            const known = p.secret?.face;
            const src = known && def ? faceImage(`${def.id}:front`, def.front) : backImage();
            return (
              <button
                key={p.id}
                className="tray-card"
                onClick={() => send({ t: 'reveal', target: p.id })}
                title={known && def ? `Play ${def.label}` : 'Play card'}
              >
                <img src={src} alt={def?.label ?? 'card'} draggable={false} />
              </button>
            );
          })}
        </div>
      )}

      {mySeat < 0 && hasHandZone && (
        <div className="tray spectating">
          You are spectating. Open the menu to take a seat.
        </div>
      )}

      {editorOpen && (
        <Suspense fallback={<div className="editor"><div className="editor-body">Loading editor…</div></div>}>
          <Editor onClose={() => setEditorOpen(false)} />
        </Suspense>
      )}

      <Clock />

      <Chat open={chatOpen} onClose={() => setChatOpen(false)} />

      <PieceMenu />

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
