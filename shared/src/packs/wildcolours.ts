import type { GamePack } from '../pack.js';
import type { ComponentDef } from '../pack.js';
import { CARD_W, CARD_H, CARD_D } from '../components.js';
import { handZones, MAX_SEATS } from './common.js';
import { WILD_COLOURS_SCRIPT } from './scripts/wildcolours.js';

/**
 * Wild Colours: the colour-and-symbol shedding game.
 *
 * Not a licensed edition of anything — the deck is built from plain coloured text
 * cards drawn by the app, and the rules are the ones everybody's house plays. Rename
 * it, recolour it or change the counts by duplicating the pack in the editor.
 */

const COLOURS: { id: string; name: string; bg: string }[] = [
  { id: 'R', name: 'Red', bg: '#c62828' },
  { id: 'Y', name: 'Yellow', bg: '#d99b00' },
  { id: 'G', name: 'Green', bg: '#2e7d32' },
  { id: 'B', name: 'Blue', bg: '#1565c0' },
];

/** Non-numeric cards, keyed by the letter used in the face code. */
const SYMBOLS: { id: string; name: string; text: string }[] = [
  { id: 'S', name: 'Skip', text: 'SKIP' },
  { id: 'R', name: 'Reverse', text: '⇄' },
  { id: 'D', name: 'Draw Two', text: '+2' },
];

const CARD_BACK = { type: 'text', text: '', bg: '#22252b', fg: '#22252b' } as const;

function card(id: string, label: string, text: string, bg: string, fontScale = 1): ComponentDef {
  return {
    id,
    kind: 'card',
    label,
    face: id,
    front: { type: 'text', text, bg, fg: '#ffffff', fontScale },
    back: CARD_BACK,
    w: CARD_W, h: CARD_H, d: CARD_D,
    data: { colour: id.charAt(0), symbol: id.substring(1) },
  };
}

function buildComponents(): ComponentDef[] {
  const out: ComponentDef[] = [];
  for (const c of COLOURS) {
    for (let n = 0; n <= 9; n++) {
      out.push(card(`${c.id}${n}`, `${c.name} ${n}`, String(n), c.bg, 1.7));
    }
    for (const s of SYMBOLS) {
      out.push(card(`${c.id}${s.id}`, `${c.name} ${s.name}`, s.text, c.bg, s.id === 'S' ? 0.9 : 1.5));
    }
  }
  out.push(card('W', 'Wild', 'WILD', '#1b1b22', 0.95));
  out.push(card('W4', 'Wild Draw Four', '+4', '#1b1b22', 1.5));
  return out;
}

/**
 * The 108-card deck: one zero and two of everything else per colour, four wilds and
 * four wild draw fours. Expressed with the pack format's own `repeat:` shorthand, so
 * nothing here needs engine support a user-authored pack does not also have.
 */
function deckSpec(): string[] {
  const ids: string[] = [];
  for (const c of COLOURS) {
    ids.push(`${c.id}0`);
    for (let n = 1; n <= 9; n++) ids.push(`repeat:${c.id}${n}:2`);
    for (const s of SYMBOLS) ids.push(`repeat:${c.id}${s.id}:2`);
  }
  ids.push('repeat:W:4', 'repeat:W4:4');
  return ids;
}

export const wildColoursPack: GamePack = {
  manifest: {
    formatVersion: 1,
    id: 'wildcolours',
    name: 'Wild Colours',
    author: 'built-in',
    description: 'Match the colour or the symbol. Skips, reverses and draw-twos bite; wilds let you name the colour. First to empty their hand wins.',
    minSeats: 2,
    maxSeats: MAX_SEATS,
    defaultEnforcement: 'enforced',
    tableColor: '#2b2f38',
    actions: [
      { id: 'deal', label: 'New round' },
      { id: 'colour:R', label: '● Red' },
      { id: 'colour:Y', label: '● Yellow' },
      { id: 'colour:G', label: '● Green' },
      { id: 'colour:B', label: '● Blue' },
    ],
  },
  components: buildComponents(),
  zones: [
    ...handZones(MAX_SEATS),
    { id: 'discard', label: 'Discard', ownerSeat: null, visibility: 'public', x: 0.85, z: 0, w: 1.4, h: 1.6, layout: 'free' },
    { id: 'draw', label: 'Draw pile', ownerSeat: null, visibility: 'hidden', x: -0.85, z: 0, w: 1.4, h: 1.6, layout: 'stack' },
  ],
  setup: [
    { componentIds: deckSpec(), as: 'stack', zoneId: 'draw', x: 0, z: 0, faceUp: false, shuffled: true },
  ],
  script: WILD_COLOURS_SCRIPT,
};
