/**
 * Table chat.
 *
 * A floating panel, draggable by its header like the log and the menu. It used to be a
 * full-height rail pinned to the right-hand edge, which meant opening the log behind it
 * put the log where it could not be read — the two are most useful together, so neither
 * may own the corner.
 *
 * Each player's messages carry their own colour — the same one their pointer and name
 * chip use — so a glance tells you who said what without reading the names.
 */

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../net/store';
import { usePanelDrag } from './layout';

export function Chat({ open, onClose }: { open: boolean; onClose: () => void }) {
  const chat = useStore((s) => s.snap.chat);
  const players = useStore((s) => s.snap.players);
  const sessionId = useStore((s) => s.sessionId);
  const send = useStore((s) => s.send);

  const [draft, setDraft] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const panel = usePanelDrag('chat');

  // Follow new messages, but only when already at the bottom, so reading back through
  // the log is not yanked away by someone else typing.
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom) el.scrollTop = el.scrollHeight;
  }, [chat.length]);

  if (!open) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    send({ t: 'chat', text });
    setDraft('');
  }

  return (
    <aside className={`chat panel ${panel.className}`} ref={panel.ref} style={panel.style}>
      <header {...panel.handleProps}>
        <span className="grip-dots" aria-hidden="true" />
        <span>Chat</span>
        <button className="icon" onClick={onClose} title="Close chat">✕</button>
      </header>

      <div className="chat-list" ref={list}>
        {chat.length === 0 && <p className="hint">No messages yet. Say hello.</p>}
        {chat.map((m) => {
          // Prefer the player's current colour so a rename or reconnect stays consistent.
          const colour = players[m.sessionId]?.color ?? m.color;
          const mine = m.sessionId === sessionId;
          return (
            <div key={m.id} className={`chat-line ${mine ? 'mine' : ''}`}>
              <span className="who" style={{ color: colour }}>{m.name}</span>
              <span className="what">{m.text}</span>
            </div>
          );
        })}
      </div>

      <form className="chat-input" onSubmit={submit}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message the table…"
          maxLength={300}
          aria-label="Chat message"
        />
        <button className="primary" type="submit" disabled={!draft.trim()}>Send</button>
      </form>
    </aside>
  );
}
