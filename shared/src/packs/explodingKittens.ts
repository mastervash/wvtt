import type { ComponentDef, GamePack } from '../pack.js';
import type { ZoneDef } from '../types.js';
import { CARD_W, CARD_H, CARD_D } from '../components.js';
import { handZones, MAX_SEATS } from './common.js';
import { EXPLODING_KITTENS_ART } from './explodingKittensArtwork.js';
import { EXPLODING_KITTENS_SCRIPT } from './scripts/explodingKittens.js';

export type ExplodingKittensBase =
  | 'exploding-kittens-original-edition' | 'exploding-kittens-2-player-edition'
  | 'exploding-kittens-cat-burglar-edition' | 'exploding-kittens-nsfw-edition'
  | 'exploding-kittens-party-pack-edition' | 'exploding-kittens-recipes-for-disaster'
  | 'exploding-kittens-good-vs-evil' | 'exploding-kittens-zombie-kittens';
export type ExplodingKittensExpansion = 'imploding-kittens-expansion' | 'streaking-kittens-expansion' | 'barking-kittens-expansion';
export interface ExplodingKittensSelection { base?: ExplodingKittensBase; expansions?: ExplodingKittensExpansion[]; }

export const EXPLODING_KITTENS_BASES: { id: ExplodingKittensBase; name: string; expansions: ExplodingKittensExpansion[] }[] = [
  { id: 'exploding-kittens-original-edition', name: 'Original Edition', expansions: ['imploding-kittens-expansion', 'streaking-kittens-expansion', 'barking-kittens-expansion'] },
  { id: 'exploding-kittens-2-player-edition', name: '2-Player Edition', expansions: ['imploding-kittens-expansion', 'streaking-kittens-expansion', 'barking-kittens-expansion'] },
  { id: 'exploding-kittens-cat-burglar-edition', name: 'Cat Burglar Edition', expansions: ['imploding-kittens-expansion', 'streaking-kittens-expansion', 'barking-kittens-expansion'] },
  { id: 'exploding-kittens-nsfw-edition', name: 'NSFW Edition', expansions: ['imploding-kittens-expansion', 'streaking-kittens-expansion', 'barking-kittens-expansion'] },
  { id: 'exploding-kittens-party-pack-edition', name: 'Party Pack Edition', expansions: ['imploding-kittens-expansion', 'streaking-kittens-expansion', 'barking-kittens-expansion'] },
  { id: 'exploding-kittens-recipes-for-disaster', name: 'Recipes for Disaster', expansions: [] },
  { id: 'exploding-kittens-good-vs-evil', name: 'Good vs Evil', expansions: [] },
  { id: 'exploding-kittens-zombie-kittens', name: 'Zombie Kittens', expansions: [] },
];
export const EXPLODING_KITTENS_EXPANSIONS: { id: ExplodingKittensExpansion; name: string }[] = [
  { id: 'imploding-kittens-expansion', name: 'Imploding Kittens' }, { id: 'streaking-kittens-expansion', name: 'Streaking Kittens' }, { id: 'barking-kittens-expansion', name: 'Barking Kittens' },
];

const CARD_BACK = { type: 'text', text: '', bg: '#241519', fg: '#241519' } as const;
const STANDARD_COUNTS: Record<string, number> = { KITTEN: 4, DEFUSE: 6, NOPE: 5, ATTACK: 4, FAVOR: 4, SHUFFLE: 4, SKIP: 4, FUTURE: 5, CAT: 20 };
const RULES_NOTES = `Rules summary — Original Edition (2–5 players)

Setup: remove all Exploding Kittens and Defuses. Deal every player one Defuse and seven other cards. Return the spare Defuses, then shuffle in one fewer Exploding Kitten than players.

Turn: play any number of cards, then draw to end your turn. Drawing an Exploding Kitten eliminates you unless you spend a Defuse; discard that Defuse and secretly return the Kitten anywhere in the draw pile. The last surviving player wins.

Core cards: Attack ends your turn and makes the next player take two turns; Skip ends one turn without drawing; Favor makes a chosen player give you a card; Shuffle randomizes the draw pile; See the Future privately views its top three cards; Nope cancels an action (and can itself be Noped). A matching pair of Cat Cards steals one random card.

Selected expansion cards keep their printed effects; their artwork and cards are included with the chosen deck. Source: https://dumekj556jp75.cloudfront.net/exploding-kittens/English.pdf`;

function faceFor(title: string): string {
  const normalized = title.toLowerCase();
  if (normalized === 'exploding kitten') return 'KITTEN'; if (normalized === 'defuse') return 'DEFUSE'; if (normalized === 'nope') return 'NOPE';
  if (normalized.startsWith('attack')) return 'ATTACK'; if (normalized === 'skip') return 'SKIP'; if (normalized === 'favor') return 'FAVOR';
  if (normalized === 'shuffle') return 'SHUFFLE'; if (normalized.startsWith('see the future')) return 'FUTURE'; if (normalized === 'cat card') return 'CAT';
  return `EXTRA:${title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toUpperCase()}`;
}
function card(deck: string, index: number, title: string, filename: string): ComponentDef {
  return { id: `${deck}-${index}`, kind: 'card', label: title, face: faceFor(title), front: { type: 'asset', path: `/assets/decks/exploding-kittens/${deck}/${filename}` }, back: CARD_BACK, w: CARD_W, h: CARD_H, d: CARD_D };
}
function peekZones(): ZoneDef[] {
  const spots = [{ x: 0, z: 2.1 }, { x: 0, z: -2.1 }, { x: -3.6, z: -1.3 }, { x: 3.6, z: 1.3 }, { x: -3.6, z: 1.2 }, { x: 3.6, z: -1.2 }];
  return spots.map((s, i) => ({ id: `peek${i}`, label: `Seat ${i + 1} peek`, ownerSeat: i, visibility: 'owner', x: s.x, z: s.z, w: 1.9, h: 0.9, layout: 'row' }));
}
function resolvedSelection(input: ExplodingKittensSelection = {}) {
  const base = EXPLODING_KITTENS_BASES.find((entry) => entry.id === input.base) ?? EXPLODING_KITTENS_BASES[0];
  const requested = Array.isArray(input.expansions) ? input.expansions : [];
  return { base, expansions: base.expansions.filter((id) => requested.includes(id)) };
}

export function makeExplodingKittensPack(selection: ExplodingKittensSelection = {}): GamePack {
  const chosen = resolvedSelection(selection);
  const deckIds = [chosen.base.id, ...chosen.expansions];
  const components = deckIds.flatMap((deck) => EXPLODING_KITTENS_ART[deck].map((art, index) => card(deck, index, art.title, art.filename)));
  const firstByFace = new Map<string, string>();
  for (const component of components) if (!firstByFace.has(component.face ?? component.id)) firstByFace.set(component.face ?? component.id, component.id);
  const componentIds: string[] = [];
  for (const [face, count] of Object.entries(STANDARD_COUNTS)) { const id = firstByFace.get(face); if (id) componentIds.push(`repeat:${id}:${count}`); }
  for (const component of components) if ((component.face ?? '').startsWith('EXTRA:')) componentIds.push(component.id);
  const expansionNames = chosen.expansions.map((id) => EXPLODING_KITTENS_EXPANSIONS.find((entry) => entry.id === id)!.name);
  const deckLabel = [chosen.base.name, ...expansionNames].join(' + ');
  return {
    manifest: {
      formatVersion: 1, id: 'explodingkittens', name: 'Exploding Kittens', author: 'built-in', description: `Play, then draw—avoid the Kittens. ${deckLabel}.`, notes: RULES_NOTES,
      minSeats: 2, maxSeats: 5, defaultEnforcement: 'enforced', tableColor: '#33252b',
      actions: [{ id: 'deal', label: 'New game' }, { id: 'go', label: 'Resolve' }, { id: 'draw', label: 'Draw' }, { id: 'pick', label: 'Pick this card / player', target: 'piece' }, { id: 'give', label: 'Give this card', target: 'piece' }, { id: 'tuck:0', label: 'Return Kitten on top', target: 'stack' }, { id: 'tuck:1', label: 'Return Kitten second', target: 'stack' }, { id: 'tuck:-1', label: 'Return Kitten on bottom', target: 'stack' }, { id: 'tuck:random', label: 'Return Kitten anywhere', target: 'stack' }],
    },
    components,
    zones: [...handZones(MAX_SEATS), ...peekZones(), { id: 'draw', label: 'Draw pile', ownerSeat: null, visibility: 'hidden', x: -0.85, z: 0, w: 1.4, h: 1.6, layout: 'stack' }, { id: 'discard', label: 'Discard', ownerSeat: null, visibility: 'public', x: 0.85, z: 0, w: 1.4, h: 1.6, layout: 'free' }, { id: 'aside', label: 'Out of play', ownerSeat: null, visibility: 'hidden', x: 5.6, z: 3.5, w: 1.4, h: 1.6, layout: 'stack' }],
    setup: [{ componentIds, as: 'stack', zoneId: 'draw', x: 0, z: 0, faceUp: false, shuffled: true }], script: EXPLODING_KITTENS_SCRIPT,
  };
}
export const explodingKittensPack = makeExplodingKittensPack();
