/**
 * Context menu for a piece or a pile.
 *
 * Every table action that is not a drag lives here. Before this existed the server
 * supported rolling dice, peeking, splitting piles and stacking pieces together, but
 * nothing in the interface could ask for any of it — which made the Dice Tray pack
 * unplayable, since tapping a die flipped it instead of rolling it.
 *
 * Items that need a number — take five off the top, deal three each — open a submenu
 * of counts rather than a prompt box, because on a phone a prompt box is a keyboard
 * covering the table.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentDef, Op } from '@wvtt/shared';
import { useStore, useMySeat } from '../net/store';
import { useSettings } from './settings';

interface Action {
  label: string;
  /** Fired when the item is chosen. Omitted for items that only open a submenu. */
  op?: Op;
  /** Shown greyed with a reason instead of being hidden, when it nearly applies. */
  disabled?: string;
  /** Counts offered in a submenu; choosing one builds the op. */
  counts?: { max: number; make: (n: number) => Op };
  /** Seats offered in a submenu, for "deal to just this player". */
  seats?: { seat: number; name: string; make: (seat: number) => Op }[];
  /** Renders the pile naming form instead of a button. */
  form?: 'name';
  danger?: boolean;
}

/**
 * The counts worth offering, filtered against how many cards are actually there.
 *
 * Round numbers a card player actually asks for, rather than every integer up to
 * fifty-two — which would be a wall of buttons nobody reads.
 */
function countChoices(max: number): number[] {
  const wanted = [1, 2, 3, 4, 5, 7, 10, 13, 20, 26];
  const out = wanted.filter((n) => n < max);
  if (max > 0) out.push(max);
  return out;
}

/**
 * The server refuses to draw or deal more than twenty at once, so the menu must not
 * offer more: a button that is quietly ignored looks like a bug.
 */
const BULK_LIMIT = 20;

export function PieceMenu() {
  const menu = useStore((s) => s.menu);
  const closeMenu = useStore((s) => s.closeMenu);
  const send = useStore((s) => s.send);
  const ping = useStore((s) => s.ping);
  const snap = useStore((s) => s.snap);
  const pack = useStore((s) => s.pack);
  const uiScale = useSettings((s) => s.uiScale);
  const mySeat = useMySeat();
  const box = useRef<HTMLDivElement>(null);

  /** Which item's submenu is expanded, by label. */
  const [openSub, setOpenSub] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [tagDraft, setTagDraft] = useState('');

  // A fresh target starts with nothing expanded and the naming form pre-filled from
  // whatever the pile is already called.
  const targetId = menu?.targetId ?? '';
  const stackLabel = snap.stacks[targetId]?.label ?? '';
  const stackTag = snap.stacks[targetId]?.tag ?? '';
  useEffect(() => {
    setOpenSub(null);
    setNameDraft(stackLabel);
    setTagDraft(stackTag);
  }, [targetId, stackLabel, stackTag]);

  // Any click elsewhere, or Escape, dismisses it.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMenu(); };
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) closeMenu();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [menu, closeMenu]);

  const defs = useMemo(() => {
    const m = new Map<string, ComponentDef>();
    for (const c of pack?.components ?? []) m.set(c.id, c);
    return m;
  }, [pack]);

  const seated = useMemo(
    () => Object.values(snap.players)
      .filter((p) => p.seat >= 0)
      .sort((a, b) => a.seat - b.seat),
    [snap.players],
  );

  if (!menu) return null;

  const stack = snap.stacks[menu.targetId];
  const piece = snap.pieces[menu.targetId];
  if (!stack && !piece) return null;

  const handZone = mySeat >= 0 ? `hand${mySeat}` : null;
  const locked = !!(stack?.locked ?? piece?.locked);
  const actions: Action[] = [];
  let title = '';
  let subtitle = '';

  /** Pack-supplied buttons that want a specific piece or pile. */
  const packActions = (pack?.manifest.actions ?? []).filter(
    (a) => a.target === (stack ? 'stack' : 'piece'),
  );

  if (stack) {
    const count = stack.pieceIds?.length ?? 0;
    const seatZones = seated.map((p) => `hand${p.seat}`).filter((z) => snap.zones[z]);
    title = stack.label || `Pile of ${count}`;
    subtitle = stack.label ? `${count} cards` : '';

    if (locked) {
      actions.push({ label: 'Unlock this pile', op: { t: 'setLock', target: stack.id, locked: false } });
      actions.push({ label: 'Ping it', op: { t: 'ping', x: stack.x, z: stack.z, target: stack.id } });
    } else {
      actions.push({ label: 'Shuffle', op: { t: 'shuffle', stackId: stack.id } });
      actions.push({ label: 'Turn the pile over', op: { t: 'flip', target: stack.id } });

      actions.push({
        label: 'Draw to my hand…',
        counts: handZone
          ? { max: Math.min(count, BULK_LIMIT), make: (n) => ({ t: 'draw', stackId: stack.id, toZoneId: handZone, count: n }) }
          : undefined,
        disabled: handZone ? undefined : 'Take a seat first',
      });

      actions.push({
        label: 'Take cards off the top…',
        // The new pile lands beside the old one so it is immediately grabbable rather
        // than hidden underneath.
        counts: { max: count, make: (n) => ({ t: 'unstack', stackId: stack.id, count: n, x: stack.x + 1.2, z: stack.z }) },
      });

      if (count > 3) {
        actions.push({
          label: 'Split in half',
          op: { t: 'unstack', stackId: stack.id, count: Math.floor(count / 2), x: stack.x + 1.4, z: stack.z },
        });
      }

      actions.push({
        label: 'Deal to everyone…',
        counts: seatZones.length
          ? { max: Math.min(BULK_LIMIT, Math.floor(count / Math.max(1, seatZones.length))) || 1, make: (n) => ({ t: 'deal', stackId: stack.id, count: n, toZoneIds: seatZones }) }
          : undefined,
        disabled: seatZones.length ? undefined : 'Nobody is seated',
      });

      actions.push({
        label: 'Deal to one player…',
        seats: seated
          .filter((p) => snap.zones[`hand${p.seat}`])
          .map((p) => ({
            seat: p.seat,
            name: p.name,
            make: (seat: number) => ({ t: 'deal', stackId: stack.id, count: 1, toZoneIds: [`hand${seat}`] }),
          })),
        disabled: seated.length ? undefined : 'Nobody is seated',
      });

      actions.push({ label: 'Turn 90°', op: { t: 'rotate', target: stack.id, delta: Math.PI / 2 } });
      actions.push({ label: 'Ping it', op: { t: 'ping', x: stack.x, z: stack.z, target: stack.id } });
      actions.push({ label: 'Name this pile…', form: 'name' });
      actions.push({ label: 'Lock in place', op: { t: 'setLock', target: stack.id, locked: true } });
    }
  } else if (piece) {
    const def = defs.get(piece.defId);
    const kind = def?.kind ?? piece.kind;
    const known = piece.secret?.face;
    title = known && def ? def.label : kind === 'card' ? 'Face-down card' : (def?.label ?? kind);

    if (kind === 'die') {
      const sides = def?.sides ?? 6;
      if (piece.secret?.value) subtitle = `showing ${piece.secret.value}`;
      actions.push({
        label: `Roll the d${sides}`,
        op: { t: 'roll', target: piece.id },
        disabled: locked ? 'Unlock it first' : undefined,
      });
    } else {
      actions.push({
        label: piece.faceUp ? 'Turn face down' : 'Turn face up',
        op: { t: 'flip', target: piece.id },
        disabled: locked ? 'Unlock it first' : undefined,
      });
    }

    const inMyHand = piece.zoneId === handZone;
    if (inMyHand) {
      actions.push({ label: 'Play it to the table', op: { t: 'reveal', target: piece.id } });
    } else if (handZone) {
      actions.push({
        label: 'Take into my hand',
        op: { t: 'drop', target: piece.id, zoneId: handZone, x: snap.zones[handZone]?.x ?? 0, z: snap.zones[handZone]?.z ?? 0 },
        disabled: locked ? 'Unlock it first' : undefined,
      });
    }

    if (kind === 'card' && !known) {
      actions.push({
        label: 'Peek at it',
        op: { t: 'peek', target: piece.id },
        disabled: inMyHand || piece.heldBy ? undefined : 'You can only peek at cards you hold',
      });
    }
    if (kind === 'card' && known && !inMyHand) {
      actions.push({ label: 'Stop peeking', op: { t: 'unpeek', target: piece.id } });
    }

    actions.push({
      label: 'Turn 90°',
      op: { t: 'rotate', target: piece.id, delta: Math.PI / 2 },
      disabled: locked ? 'Unlock it first' : undefined,
    });
    actions.push({ label: 'Ping it', op: { t: 'ping', x: piece.x, z: piece.z, target: piece.id } });
    actions.push({
      label: locked ? 'Unlock it' : 'Lock in place',
      op: { t: 'setLock', target: piece.id, locked: !locked },
    });
  }

  for (const a of packActions) {
    actions.push({
      label: a.label,
      op: {
        t: 'scriptAction',
        action: a.id,
        payload: stack ? { stackId: stack.id } : { pieceId: piece!.id },
      },
      disabled: snap.enforcement === 'off' ? 'Turn rules on to use game actions' : undefined,
    });
  }

  function run(op: Op) {
    if (op.t === 'ping') ping({ x: op.x, z: op.z, targetId: op.target });
    else send(op);
    closeMenu();
  }

  function submitName(e: React.FormEvent) {
    e.preventDefault();
    if (!stack) return;
    send({ t: 'setStackTag', stackId: stack.id, label: nameDraft, tag: tagDraft });
    closeMenu();
  }

  // Keep the menu on screen when opened near an edge. Positions are in CSS pixels but
  // the overlay is zoomed by the UI scale setting, so the pointer coordinates have to
  // be divided by it or the menu drifts further from the cursor the more you zoom.
  const rows = actions.length + (openSub ? 6 : 0);
  const style: React.CSSProperties = {
    left: Math.min(menu.x, window.innerWidth - 230) / uiScale,
    top: Math.min(menu.y, Math.max(8, window.innerHeight - (rows * 34 + 70))) / uiScale,
  };

  return (
    <div className="piece-menu" style={style} ref={box}>
      <div className="pm-title">
        {title}
        {subtitle && <span className="pm-sub">{subtitle}</span>}
      </div>

      {actions.map((a) => {
        const expandable = !!a.counts || !!a.seats || a.form === 'name';
        const expanded = openSub === a.label;
        return (
          <div key={a.label} className="pm-item">
            <button
              disabled={!!a.disabled}
              title={a.disabled}
              className={`${expanded ? 'on' : ''} ${a.danger ? 'danger' : ''}`}
              onClick={() => {
                if (a.disabled) return;
                if (expandable) setOpenSub(expanded ? null : a.label);
                else if (a.op) run(a.op);
              }}
            >
              {a.label}
              {expandable && <span className="pm-chev">{expanded ? '▾' : '▸'}</span>}
            </button>

            {expanded && a.counts && (
              <div className="pm-counts">
                {countChoices(a.counts.max).map((n) => (
                  <button key={n} onClick={() => run(a.counts!.make(n))}>{n}</button>
                ))}
              </div>
            )}

            {expanded && a.seats && (
              <div className="pm-seats">
                {a.seats.map((s) => (
                  <button key={s.seat} onClick={() => run(s.make(s.seat))}>
                    {s.name} <span className="pm-seatno">seat {s.seat + 1}</span>
                  </button>
                ))}
              </div>
            )}

            {expanded && a.form === 'name' && (
              <form className="pm-form" onSubmit={submitName}>
                <input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  placeholder="Pile name"
                  maxLength={32}
                  autoFocus
                  aria-label="Pile name"
                />
                <input
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  placeholder="Group tag (optional)"
                  maxLength={24}
                  aria-label="Pile group tag"
                />
                <button className="primary" type="submit">Save</button>
              </form>
            )}
          </div>
        );
      })}
    </div>
  );
}
