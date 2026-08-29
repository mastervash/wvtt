/**
 * Local player preferences.
 *
 * These belong to the person, not the table: they follow you from room to room and
 * mean nothing to anyone else, so they live in localStorage rather than in room state.
 * Kept in their own store so a settings change does not re-render the 3D scene through
 * the table snapshot.
 */

import { create } from 'zustand';

/** Which physical button drags pieces. The other one orbits the camera. */
export type DragButton = 'left' | 'right';

/**
 * Graphics quality.
 *
 * A table can hold 108 cards, each a shadow-casting mesh, and the default settings
 * (a 2048px shadow map at up to twice the device pixel ratio) ask a lot of a laptop
 * without a discrete GPU — which is what the Firefox and Brave reports came down to.
 * "Balanced" is the default because "High" was never worth its cost at table distances.
 */
export type Quality = 'high' | 'balanced' | 'low';

export interface QualitySettings {
  /** Device-pixel-ratio ceiling passed to the canvas. */
  dpr: [number, number];
  /** Shadow map resolution, or 0 for no shadows at all. */
  shadowMap: number;
  antialias: boolean;
}

export const QUALITY: Record<Quality, QualitySettings> = {
  high: { dpr: [1, 2], shadowMap: 2048, antialias: true },
  balanced: { dpr: [1, 1.5], shadowMap: 1024, antialias: true },
  low: { dpr: [1, 1], shadowMap: 0, antialias: false },
};

export const QUALITY_LABELS: Record<Quality, string> = {
  high: 'High',
  balanced: 'Balanced',
  low: 'Fastest',
};

/**
 * A first guess at what this machine can handle.
 *
 * Only used when the player has never chosen for themselves. Core count is a crude
 * proxy, but it is the only hardware signal a browser offers that is not gated behind a
 * permission or a fingerprinting flag.
 */
function guessQuality(): Quality {
  const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 4) : 4;
  if (cores <= 4) return 'low';
  return 'balanced';
}

/** Categories the table log can be filtered by. Matches LogEntry.kind on the server. */
export const LOG_KINDS = ['move', 'cards', 'dice', 'table', 'rules', 'presence'] as const;
export type LogKind = typeof LOG_KINDS[number];

export const LOG_KIND_LABELS: Record<LogKind, string> = {
  move: 'Moves',
  cards: 'Cards',
  dice: 'Dice',
  table: 'Table',
  rules: 'Rules',
  presence: 'Players',
};

export interface Settings {
  /**
   * Which button picks pieces up.
   *
   * Players coming from other virtual tabletops expect right-drag to move the camera
   * and left-drag to move pieces; others expect the reverse, and a left-handed mouse
   * makes the question moot. Both mappings are supported rather than argued about.
   */
  dragButton: DragButton;
  /** Multiplier applied to every overlay panel. 0.7–1.6. */
  uiScale: number;
  /** Log categories currently shown. */
  logKinds: LogKind[];
  /** Show every player's actions, or only your own. */
  logMineOnly: boolean;
  /** Single-key shortcuts acting on whatever the pointer is over. */
  hotkeys: boolean;
  /** How much work the 3D table is allowed to do per frame. */
  quality: Quality;
  /**
   * Whether the player picked the quality themselves.
   *
   * Only a guessed setting may be lowered automatically. Overriding a deliberate choice
   * because a few frames were slow would be infuriating.
   */
  qualityChosen: boolean;

  setDragButton: (b: DragButton) => void;
  setUiScale: (n: number) => void;
  toggleLogKind: (k: LogKind) => void;
  setLogMineOnly: (v: boolean) => void;
  setHotkeys: (v: boolean) => void;
  setQuality: (q: Quality) => void;
  /** Step the quality down one level. Returns the new level, or null if already lowest. */
  autoDowngrade: () => Quality | null;
  reset: () => void;
}

const KEY = 'wvtt:settings';

interface Stored {
  dragButton: DragButton;
  uiScale: number;
  logKinds: LogKind[];
  logMineOnly: boolean;
  hotkeys: boolean;
  quality: Quality | null;   // null until the player picks one for themselves
}

const DEFAULTS: Stored = {
  dragButton: 'left',
  uiScale: 1,
  logKinds: [...LOG_KINDS],
  logMineOnly: false,
  hotkeys: true,
  quality: null,
};

function load(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const saved = JSON.parse(raw) as Partial<Stored>;
    return {
      dragButton: saved.dragButton === 'right' ? 'right' : 'left',
      // Clamp on read: a hand-edited or stale value must not be able to make the
      // interface unusably large or small with no way back to the settings panel.
      uiScale: clampScale(Number(saved.uiScale)),
      logKinds: Array.isArray(saved.logKinds)
        ? (saved.logKinds.filter((k) => (LOG_KINDS as readonly string[]).includes(k)) as LogKind[])
        : [...LOG_KINDS],
      logMineOnly: !!saved.logMineOnly,
      // Default on for anyone who has never seen the setting, including players whose
      // preferences were saved before shortcuts existed.
      hotkeys: saved.hotkeys !== false,
      quality: saved.quality === 'high' || saved.quality === 'balanced' || saved.quality === 'low'
        ? saved.quality
        : null,
    };
  } catch {
    return DEFAULTS;
  }
}

export function clampScale(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(1.6, Math.max(0.7, Math.round(n * 20) / 20));
}

function save(s: Stored) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // A browser with storage disabled still gets working settings for this session.
  }
}

export const useSettings = create<Settings>((set, get) => {
  const initial = load();

  const persist = () => {
    const { dragButton, uiScale, logKinds, logMineOnly, hotkeys, quality } = get();
    save({ dragButton, uiScale, logKinds, logMineOnly, hotkeys, quality });
  };

  return {
    ...initial,
    // The stored value is null until someone chooses; the guess stands in until then.
    quality: initial.quality ?? guessQuality(),
    qualityChosen: initial.quality !== null,

    setDragButton(dragButton) { set({ dragButton }); persist(); },

    setUiScale(n) { set({ uiScale: clampScale(n) }); persist(); },

    toggleLogKind(k) {
      const current = get().logKinds;
      const next = current.includes(k) ? current.filter((x) => x !== k) : [...current, k];
      set({ logKinds: next });
      persist();
    },

    setLogMineOnly(v) { set({ logMineOnly: v }); persist(); },

    setHotkeys(v) { set({ hotkeys: v }); persist(); },

    setQuality(q) { set({ quality: q, qualityChosen: true }); persist(); },

    autoDowngrade() {
      const { quality, qualityChosen } = get();
      if (qualityChosen) return null;
      const next: Quality | null = quality === 'high' ? 'balanced' : quality === 'balanced' ? 'low' : null;
      if (!next) return null;
      // Not persisted and not marked as chosen: the next session starts from the guess
      // again, on what may be a different machine.
      set({ quality: next });
      return next;
    },

    reset() { set({ ...DEFAULTS, quality: guessQuality(), qualityChosen: false }); save(DEFAULTS); },
  };
});

/** The pointer button index that drags pieces, per the current mapping. */
export function dragButtonIndex(b: DragButton): number {
  return b === 'right' ? 2 : 0;
}
