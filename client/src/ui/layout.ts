/**
 * Where the overlay panels sit.
 *
 * Every floating panel starts in a sensible corner, and every one of them can be
 * dragged somewhere else. This exists because the panels used to be pinned: the chat
 * was a full-height rail down the right-hand side and the log opened underneath it, so
 * having both open meant seeing only one. Rather than choosing which of the two wins a
 * corner, a player puts them where their table needs them.
 *
 * A position is remembered per panel in localStorage, so a layout survives a reload —
 * and "Reset panels" in the menu puts everything back.
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { create } from 'zustand';
import { useSettings } from './settings';

export type PanelId = 'menu' | 'log' | 'chat' | 'clock';

export interface Point { x: number; y: number }

interface LayoutState {
  /** Undefined means "wherever the stylesheet puts it" — the panel has never been moved. */
  positions: Partial<Record<PanelId, Point>>;
  setPosition: (id: PanelId, p: Point) => void;
  reset: () => void;
}

const KEY = 'wvtt:panels';

function load(): Partial<Record<PanelId, Point>> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Record<PanelId, Point>>;
    const out: Partial<Record<PanelId, Point>> = {};
    for (const [id, p] of Object.entries(parsed)) {
      // A hand-edited or stale entry must not be able to park a panel off screen with
      // no way to reach the control that would bring it back.
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        out[id as PanelId] = { x: Math.max(0, p.x), y: Math.max(0, p.y) };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function save(positions: Partial<Record<PanelId, Point>>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(positions));
  } catch {
    // Storage disabled: panels still drag, they just start from the default next time.
  }
}

export const useLayout = create<LayoutState>((set, get) => ({
  positions: load(),
  setPosition(id, p) {
    const positions = { ...get().positions, [id]: p };
    set({ positions });
    save(positions);
  },
  reset() {
    set({ positions: {} });
    save({});
  },
}));

/**
 * Make a panel draggable by its header.
 *
 * Returns a ref for the panel, a style to spread onto it, and the props its drag
 * handle needs. The panel keeps its stylesheet position until it is first moved, so
 * defaults stay in CSS where they belong.
 */
export function usePanelDrag(id: PanelId) {
  const position = useLayout((s) => s.positions[id]);
  const setPosition = useLayout((s) => s.setPosition);
  const uiScale = useSettings((s) => s.uiScale);

  const ref = useRef<HTMLElement | null>(null);
  const drag = useRef<{ pointerId: number; dx: number; dy: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  /**
   * Keep a panel reachable.
   *
   * Positions are stored in the overlay's own coordinate space, which `zoom` scales.
   * A layout saved on a desktop and reloaded on a phone — or simply a window made
   * smaller — would otherwise leave a panel entirely outside the viewport.
   */
  const clamp = useCallback((p: Point): Point => {
    const el = ref.current;
    const viewW = window.innerWidth / uiScale;
    const viewH = window.innerHeight / uiScale;
    const w = el?.offsetWidth ?? 240;
    const h = el?.offsetHeight ?? 120;
    // A panel may hang off the right or bottom edge, but never so far that its header —
    // the only thing that can drag it back — is unreachable.
    const keep = 56;
    return {
      x: Math.min(Math.max(0, p.x), Math.max(0, viewW - Math.min(w, keep))),
      y: Math.min(Math.max(0, p.y), Math.max(0, viewH - Math.min(h, keep))),
    };
  }, [uiScale]);

  // Re-clamp when the window changes shape, so rotating a phone cannot strand a panel.
  useEffect(() => {
    if (!position) return;
    const onResize = () => {
      const next = clamp(position);
      if (next.x !== position.x || next.y !== position.y) setPosition(id, next);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [position, clamp, id, setPosition]);

  const onPointerDown = (e: ReactPointerEvent) => {
    // Only a primary press on the header itself starts a drag; the close button and the
    // filter checkboxes that live in the same bar must still work.
    if (e.button !== 0) return;
    const el = ref.current;
    if (!el) return;
    if ((e.target as HTMLElement).closest('button, input, select, a, textarea')) return;

    const rect = el.getBoundingClientRect();
    drag.current = {
      pointerId: e.pointerId,
      // Grab offset in overlay space, so the panel does not jump under the pointer.
      dx: (e.clientX - rect.left) / uiScale,
      dy: (e.clientY - rect.top) / uiScale,
    };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    setPosition(id, clamp({
      x: e.clientX / uiScale - d.dx,
      y: e.clientY / uiScale - d.dy,
    }));
  };

  const endDrag = (e: ReactPointerEvent) => {
    if (drag.current?.pointerId !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  return {
    /** Attach to the panel element. */
    ref: ref as RefObject<any>,
    /** Spread onto the panel. Undefined until the panel has been moved. */
    style: position
      ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' }
      : undefined,
    /** Add to the panel's own class list while a drag is in progress. */
    className: dragging ? 'dragging' : '',
    /**
     * Spread onto the panel's header. Deliberately carries no className: headers have
     * their own, and an attribute in a spread silently wins over one written beside it.
     * The cursor and the grip come from a `.panel > header` rule instead.
     */
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
    dragging,
  };
}
