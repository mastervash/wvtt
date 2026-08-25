/**
 * Context menu for a piece or a pile.
 *
 * Every table action that is not a drag lives here. Before this existed the server
 * supported rolling dice, peeking, splitting piles and stacking pieces together, but
 * nothing in the interface could ask for any of it — which made the Dice Tray pack
 * unplayable, since tapping a die flipped it instead of rolling it.
 */

import { useEffect, useMemo, useRef } from 'react';
import type { ComponentDef, Op } from '@wvtt/shared';
import { useStore, useMySeat } from '../net/store';

interface Action {
  label: string;
  op: Op;
  /** Shown greyed with a reason instead of being hidden, when it nearly applies. */
  disabled?: string;
}

export function PieceMenu() {
  const menu = useStore((s) => s.menu);
  const closeMenu = useStore((s) => s.closeMenu);
  const send = useStore((s) => s.send);
  const snap = useStore((s) => s.snap);
  const pack = useStore((s) => s.pack);
  const mySeat = useMySeat();
  const box = useRef<HTMLDivElement>(null);

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

  if (!menu) return null;

  const stack = snap.stacks[menu.targetId];
  const piece = snap.pieces[menu.targetId];
  if (!stack && !piece) return null;

  const handZone = mySeat >= 0 ? `hand${mySeat}` : null;
  const actions: Action[] = [];
  let title = '';

  if (stack) {
    const count = stack.pieceIds?.length ?? 0;
    title = `Pile of ${count}`;
    actions.push({ label: 'Shuffle', op: { t: 'shuffle', stackId: stack.id } });
    actions.push({
      label: 'Draw to my hand',
      op: handZone
        ? { t: 'draw', stackId: stack.id, toZoneId: handZone }
        : { t: 'shuffle', stackId: stack.id },
      disabled: handZone ? undefined : 'Take a seat first',
    });
    actions.push({
      label: 'Take top card off',
      op: { t: 'unstack', stackId: stack.id, count: 1, x: stack.x + 1.1, z: stack.z },
    });
    if (count > 3) {
      actions.push({
        label: 'Split in half',
        op: { t: 'unstack', stackId: stack.id, count: Math.floor(count / 2), x: stack.x + 1.4, z: stack.z },
      });
    }
    actions.push({ label: 'Turn the pile over', op: { t: 'flip', target: stack.id } });
  } else if (piece) {
    const def = defs.get(piece.defId);
    const kind = def?.kind ?? piece.kind;
    const known = piece.secret?.face;
    title = known && def ? def.label : kind === 'card' ? 'Face-down card' : (def?.label ?? kind);

    if (kind === 'die') {
      const sides = def?.sides ?? 6;
      actions.push({ label: `Roll the d${sides}`, op: { t: 'roll', target: piece.id } });
      if (piece.secret?.value) title = `d${sides} showing ${piece.secret.value}`;
    } else {
      actions.push({ label: piece.faceUp ? 'Turn face down' : 'Turn face up', op: { t: 'flip', target: piece.id } });
    }

    const inMyHand = piece.zoneId === handZone;
    if (inMyHand) {
      actions.push({ label: 'Play it to the table', op: { t: 'reveal', target: piece.id } });
    } else if (handZone) {
      actions.push({ label: 'Take into my hand', op: { t: 'drop', target: piece.id, zoneId: handZone, x: snap.zones[handZone]?.x ?? 0, z: snap.zones[handZone]?.z ?? 0 } });
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
  }

  // Keep the menu on screen when opened near an edge.
  const style: React.CSSProperties = {
    left: Math.min(menu.x, window.innerWidth - 210),
    top: Math.min(menu.y, window.innerHeight - (actions.length * 40 + 60)),
  };

  return (
    <div className="piece-menu" style={style} ref={box}>
      <div className="pm-title">{title}</div>
      {actions.map((a) => (
        <button
          key={a.label}
          disabled={!!a.disabled}
          title={a.disabled}
          onClick={() => { send(a.op); closeMenu(); }}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
