import type { GamePack } from '../pack.js';
import { standardDeck } from '../components.js';
import { handZones, playZone, MAX_SEATS } from './common.js';

/**
 * The default pack: a deck of cards on a table, nothing enforced.
 * This is what a room opens with, and the reference for "the engine with no rules".
 */
export const sandboxPack: GamePack = {
  manifest: {
    formatVersion: 1,
    id: 'sandbox',
    name: 'Card Sandbox',
    author: 'built-in',
    description: 'A standard 52-card deck on an open table. No rules, no turns — shuffle, deal, flip and stack however you like.',
    minSeats: 1,
    maxSeats: MAX_SEATS,
    defaultEnforcement: 'off',
    tableColor: '#1f6f4a',
  },
  components: [...standardDeck(false)],
  zones: [
    ...handZones(MAX_SEATS),
    playZone(),
    { id: 'discard', label: 'Discard', ownerSeat: null, visibility: 'public', x: 3.2, z: -1.6, w: 1.1, h: 1.4, layout: 'stack' },
  ],
  setup: [
    {
      componentIds: ['deck:standard52'],
      as: 'stack',
      zoneId: null,
      x: -3.2, z: -1.6,
      faceUp: false,
      shuffled: true,
    },
  ],
};
