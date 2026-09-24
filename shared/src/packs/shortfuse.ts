import type { ComponentDef, GamePack } from '../pack.js';
import type { ZoneDef } from '../types.js';
import { CARD_W, CARD_H, CARD_D } from '../components.js';
import { handZones, MAX_SEATS } from './common.js';
import { SHORT_FUSE_SCRIPT } from './scripts/shortfuse.js';

/**
 * Short Fuse: draw until somebody blows up.
 *
 * The bomb-in-the-deck party game — draw a card to end your turn, and if it is a bomb
 * you are out unless you can defuse it and hide it back in the pile. Not a licensed
 * edition of anything: the deck is plain text cards drawn by the app and every card
 * name is original. Rename them, change the counts or rewrite the junk cards by
 * duplicating the pack in the editor.
 */

interface CardKind { id: string; label: string; text: string; bg: string; count: number; fontScale?: number }

/**
 * The deck, 57 cards. Bombs and Defuses are listed at their full counts; the script
 * sets aside whatever a smaller table does not use when it deals.
 *
 * The five junk cards do nothing on their own. Two of a kind played together steal a
 * card from another player.
 */
const KINDS: CardKind[] = [
  { id: 'BOMB', label: 'Bomb', text: 'BOMB', bg: '#1a1a1a', count: 5, fontScale: 1.4 },
  { id: 'DEF', label: 'Defuse', text: 'DEFUSE', bg: '#2e7d32', count: 6, fontScale: 1.1 },
  { id: 'NOPE', label: 'Nope', text: 'NOPE', bg: '#b71c1c', count: 5, fontScale: 1.3 },
  { id: 'ATK', label: 'Attack', text: 'ATTACK next player takes two turns', bg: '#e65100', count: 4 },
  { id: 'SKP', label: 'Skip', text: 'SKIP end your turn without drawing', bg: '#1565c0', count: 4 },
  { id: 'FAV', label: 'Favour', text: 'FAVOUR someone gives you a card', bg: '#6a1b9a', count: 4 },
  { id: 'SHF', label: 'Shuffle', text: 'SHUFFLE the draw pile', bg: '#00838f', count: 4 },
  { id: 'FUT', label: 'Peek', text: 'PEEK at the top three cards', bg: '#ad1457', count: 5 },
  { id: 'JDUCK', label: 'Rubber Duck', text: 'Rubber Duck', bg: '#8d6e63', count: 4 },
  { id: 'JSOCK', label: 'Sock Puppet', text: 'Sock Puppet', bg: '#8d6e63', count: 4 },
  { id: 'JCONE', label: 'Traffic Cone', text: 'Traffic Cone', bg: '#8d6e63', count: 4 },
  { id: 'JGNOME', label: 'Garden Gnome', text: 'Garden Gnome', bg: '#8d6e63', count: 4 },
  { id: 'JTOAST', label: 'Toaster', text: 'Toaster', bg: '#8d6e63', count: 4 },
];

const CARD_BACK = { type: 'text', text: '', bg: '#3b2323', fg: '#3b2323' } as const;

function card(k: CardKind): ComponentDef {
  return {
    id: k.id,
    kind: 'card',
    label: k.label,
    face: k.id,
    front: { type: 'text', text: k.text, bg: k.bg, fg: '#ffffff', fontScale: k.fontScale ?? 0.9 },
    back: CARD_BACK,
    w: CARD_W, h: CARD_H, d: CARD_D,
  };
}

/**
 * Where each seat's peek lands: a small private row between its hand and the middle.
 *
 * A peek has to show three cards to one player and nobody else, which is exactly what
 * an owner zone does. Placed by hand rather than computed, because the side seats'
 * hands are wide and a straight inset from them runs into the neighbouring hand.
 */
const PEEK_SPOTS: { x: number; z: number }[] = [
  { x: 0, z: 2.1 },
  { x: 0, z: -2.1 },
  { x: -3.6, z: -1.3 },
  { x: 3.6, z: 1.3 },
  { x: -3.6, z: 1.2 },
  { x: 3.6, z: -1.2 },
];

function peekZones(seats: number): ZoneDef[] {
  return PEEK_SPOTS.slice(0, seats).map((s, i) => ({
    id: `peek${i}`,
    label: `Seat ${i + 1} peek`,
    ownerSeat: i,
    visibility: 'owner',
    x: s.x, z: s.z, w: 1.9, h: 0.9,
    layout: 'row',
  }));
}

export const shortFusePack: GamePack = {
  manifest: {
    formatVersion: 1,
    id: 'shortfuse',
    name: 'Short Fuse',
    author: 'built-in',
    description: 'Play cards, then draw one to end your turn. Draw a bomb without a Defuse and you are out. Last player standing wins.',
    minSeats: 2,
    maxSeats: MAX_SEATS,
    defaultEnforcement: 'enforced',
    tableColor: '#33302b',
    actions: [
      { id: 'deal', label: 'New round' },
      { id: 'go', label: 'Go' },
      { id: 'draw', label: 'Draw' },
      { id: 'pick', label: 'Pick this card / player', target: 'piece' },
      { id: 'give', label: 'Give this card', target: 'piece' },
      { id: 'tuck:0', label: 'Hide the bomb on top', target: 'stack' },
      { id: 'tuck:1', label: 'Hide the bomb 2nd from top', target: 'stack' },
      { id: 'tuck:-1', label: 'Hide the bomb at the bottom', target: 'stack' },
      { id: 'tuck:random', label: 'Hide the bomb anywhere', target: 'stack' },
    ],
  },
  components: KINDS.map(card),
  zones: [
    ...handZones(MAX_SEATS),
    ...peekZones(MAX_SEATS),
    { id: 'draw', label: 'Draw pile', ownerSeat: null, visibility: 'hidden', x: -0.85, z: 0, w: 1.4, h: 1.6, layout: 'stack' },
    { id: 'discard', label: 'Discard', ownerSeat: null, visibility: 'public', x: 0.85, z: 0, w: 1.4, h: 1.6, layout: 'free' },
    // Bombs and Defuses a smaller table does not use wait here, face down, out of play.
    { id: 'aside', label: 'Out of play', ownerSeat: null, visibility: 'hidden', x: 5.6, z: 3.5, w: 1.4, h: 1.6, layout: 'stack' },
  ],
  setup: [
    { componentIds: KINDS.map((k) => `repeat:${k.id}:${k.count}`), as: 'stack', zoneId: 'draw', x: 0, z: 0, faceUp: false, shuffled: true },
  ],
  script: SHORT_FUSE_SCRIPT,
};
