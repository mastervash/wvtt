/**
 * Keyboard shortcuts.
 *
 * Every shortcut acts on whatever the pointer is over — the piece or pile outlined in
 * the scene — which is why the hover outline and this file must always agree about the
 * target. Nothing here can do anything the context menu cannot: each key builds the
 * same op the corresponding menu item builds, so the server validates them identically
 * and a shortcut can never bypass a lock, a seat rule or a pack's rules script.
 *
 * Deliberately single keys with no modifiers. A table is played one-handed with the
 * other hand on the mouse, and a chord is slower than the menu it replaces.
 */

import { useEffect } from 'react';
import type { Op } from '@wvtt/shared';
import { useStore } from '../net/store';
import { getPointer, getPointerScreen } from '../render/Table';
import { useSettings } from './settings';

export interface HotkeyDoc {
  keys: string;
  what: string;
}

/** Shown in the settings panel, and the single source of truth for the help list. */
export const HOTKEYS: HotkeyDoc[] = [
  { keys: 'F', what: 'Flip it over' },
  { keys: 'S', what: 'Shuffle the pile' },
  { keys: 'D', what: 'Draw one to your hand' },
  { keys: '1–9, 0', what: 'Draw that many (0 draws ten)' },
  { keys: 'T', what: 'Take the top card off' },
  { keys: 'R', what: 'Roll the die' },
  { keys: 'Q / E', what: 'Turn 90° left or right' },
  { keys: 'V', what: 'Peek, and again to stop' },
  { keys: 'H', what: 'Take into your hand, or play it from there' },
  { keys: 'L', what: 'Lock or unlock in place' },
  { keys: 'P', what: 'Ping where you are pointing' },
  { keys: 'M', what: 'Open the menu for it' },
];

/** True when the key event belongs to something the player is typing into. */
function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * Install the shortcuts.
 *
 * `enabled` is false while a full-screen panel such as the pack editor is open: those
 * own the keyboard, and a stray "s" while writing a rules script must not shuffle the
 * deck behind it.
 */
export function useHotkeys(enabled: boolean): void {
  const on = useSettings((s) => s.hotkeys);

  useEffect(() => {
    if (!enabled || !on) return;

    function handler(e: KeyboardEvent) {
      if (isTyping(e)) return;
      // Leave every browser and OS chord alone; these are bare keys only.
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;

      const store = useStore.getState();
      const { snap, hovered, send, ping, showToast, openMenu, sessionId } = store;
      const key = e.key.toLowerCase();

      const stack = hovered ? snap.stacks[hovered] : undefined;
      const piece = hovered ? snap.pieces[hovered] : undefined;
      const seat = snap.players[sessionId]?.seat ?? -1;
      const handZone = seat >= 0 ? `hand${seat}` : null;

      /** Send an op and swallow the key. */
      const run = (op: Op) => {
        e.preventDefault();
        send(op);
      };
      /** Explain why a key did nothing, rather than failing silently. */
      const nope = (why: string) => {
        e.preventDefault();
        showToast(why);
      };

      // Numbers draw that many cards; zero is the tenth key on the row, so it draws ten.
      if (/^[0-9]$/.test(key)) {
        if (!stack) return;             // not a pile: let the key through untouched
        const n = key === '0' ? 10 : Number(key);
        if (!handZone) return nope('Take a seat first.');
        return run({ t: 'draw', stackId: stack.id, toZoneId: handZone, count: n });
      }

      switch (key) {
        case 'f': {
          if (!hovered) return;
          return run({ t: 'flip', target: hovered });
        }

        case 's': {
          if (!stack) return hovered ? nope('Only a pile can be shuffled.') : undefined;
          return run({ t: 'shuffle', stackId: stack.id });
        }

        case 'd': {
          if (!stack) return;
          if (!handZone) return nope('Take a seat first.');
          return run({ t: 'draw', stackId: stack.id, toZoneId: handZone, count: 1 });
        }

        case 't': {
          if (!stack) return;
          // Lands beside the pile, where the menu's "take off the top" puts it.
          return run({ t: 'unstack', stackId: stack.id, count: 1, x: stack.x + 1.2, z: stack.z });
        }

        case 'r': {
          if (!piece) return;
          if (piece.kind !== 'die') return nope('Only dice roll.');
          return run({ t: 'roll', target: piece.id });
        }

        case 'q':
        case 'e': {
          if (!hovered) return;
          return run({ t: 'rotate', target: hovered, delta: (key === 'q' ? -1 : 1) * (Math.PI / 2) });
        }

        case 'v': {
          if (!piece) return;
          // One key for both directions: whether you can already read it decides which.
          if (piece.secret?.face) return run({ t: 'unpeek', target: piece.id });
          return run({ t: 'peek', target: piece.id });
        }

        case 'h': {
          if (!piece) return;
          if (!handZone) return nope('Take a seat first.');
          if (piece.zoneId === handZone) return run({ t: 'reveal', target: piece.id });
          return run({
            t: 'drop',
            target: piece.id,
            zoneId: handZone,
            x: snap.zones[handZone]?.x ?? 0,
            z: snap.zones[handZone]?.z ?? 0,
          });
        }

        case 'l': {
          if (!hovered) return;
          const locked = !!(stack?.locked ?? piece?.locked);
          return run({ t: 'setLock', target: hovered, locked: !locked });
        }

        case 'p': {
          e.preventDefault();
          const at = hovered ? (stack ?? piece) : null;
          const spot = at ? { x: at.x, z: at.z } : getPointer();
          return ping({ x: spot.x, z: spot.z, targetId: hovered ?? undefined });
        }

        case 'm': {
          if (!hovered) return;
          e.preventDefault();
          // Opens where the pointer is, exactly as a click would; the menu clamps
          // itself to the window from there.
          const at2 = getPointerScreen();
          return openMenu({ x: at2.x, y: at2.y, targetId: hovered });
        }

        default:
          break;
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, on]);
}
