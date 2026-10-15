import type { GamePack } from '../pack.js';
import type { ComponentDef } from '../pack.js';
import { CARD_W, CARD_H, CARD_D } from '../components.js';
import { handZones, MAX_SEATS } from './common.js';
import { UNO_ARTWORK } from './unoArtwork.js';
import { UNO_SCRIPT } from './scripts/uno.js';

/**
 * UNO: the colour-and-symbol shedding game, using the supplied 54-card artwork set.
 */

const COLOURS: { id: string; name: string }[] = [
  { id: 'R', name: 'Red' },
  { id: 'Y', name: 'Yellow' },
  { id: 'G', name: 'Green' },
  { id: 'B', name: 'Blue' },
];

/** Non-numeric cards, keyed by the letter used in the face code. */
const SYMBOLS: { id: string; name: string }[] = [
  { id: 'S', name: 'Skip' },
  { id: 'R', name: 'Reverse' },
  { id: 'D', name: 'Draw Two' },
];

const CARD_BACK = { type: 'text', text: '', bg: '#22252b', fg: '#22252b' } as const;

function card(id: string, label: string): ComponentDef {
  return {
    id,
    kind: 'card',
    label,
    face: id,
    front: { type: 'image', dataUri: UNO_ARTWORK[id] },
    back: CARD_BACK,
    w: CARD_W, h: CARD_H, d: CARD_D,
    data: { colour: id.charAt(0), symbol: id.substring(1) },
  };
}

function buildComponents(): ComponentDef[] {
  const out: ComponentDef[] = [];
  for (const c of COLOURS) {
    for (let n = 0; n <= 9; n++) {
      out.push(card(`${c.id}${n}`, `${c.name} ${n}`));
    }
    for (const s of SYMBOLS) {
      out.push(card(`${c.id}${s.id}`, `${c.name} ${s.name}`));
    }
  }
  out.push(card('W', 'Wild'));
  out.push(card('W4', 'Wild Draw Four'));
  return out;
}

/**
 * The supplied deck has one of each 0–9, action, wild and wild draw-four card: 54
 * pieces in total. Keep this list explicit so the deal size always matches its art.
 */
function deckSpec(): string[] {
  const ids: string[] = [];
  for (const c of COLOURS) {
    for (let n = 0; n <= 9; n++) ids.push(`${c.id}${n}`);
    for (const s of SYMBOLS) ids.push(`${c.id}${s.id}`);
  }
  ids.push('W', 'W4');
  return ids;
}

export const unoPack: GamePack = {
  manifest: {
    formatVersion: 1,
    id: 'uno',
    name: 'UNO',
    author: 'built-in',
    description: 'Match the colour or symbol. Skips, reverses, draw twos and wilds change the turn; empty your hand to win.',
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
  script: UNO_SCRIPT,
};
