import type { GamePack } from '../pack.js';
import { standardDeck } from '../components.js';
import { handZones, MAX_SEATS } from './common.js';
import { EIGHTS_SCRIPT } from './scripts/eights.js';

/**
 * Crazy Eights: the first pack with fully enforced card-game rules.
 *
 * Everything it needs — private hands, a public discard, a face-down draw pile, turn
 * order — comes from the same primitives any user-authored pack can use.
 */
export const eightsPack: GamePack = {
  manifest: {
    formatVersion: 1,
    id: 'eights',
    name: 'Crazy Eights',
    author: 'built-in',
    description: 'Match the suit or the rank of the top card. Eights are wild. First to empty their hand wins. Rules are enforced unless you switch them off.',
    minSeats: 2,
    maxSeats: MAX_SEATS,
    defaultEnforcement: 'enforced',
    tableColor: '#1d5c6b',
    actions: [
      { id: 'deal', label: 'New hand' },
      { id: 'pass', label: 'Pass' },
    ],
  },
  components: standardDeck(false),
  zones: [
    ...handZones(MAX_SEATS),
    { id: 'discard', label: 'Discard', ownerSeat: null, visibility: 'public', x: 0.85, z: 0, w: 1.4, h: 1.6, layout: 'free' },
    { id: 'draw', label: 'Draw pile', ownerSeat: null, visibility: 'hidden', x: -0.85, z: 0, w: 1.4, h: 1.6, layout: 'stack' },
  ],
  setup: [
    { componentIds: ['deck:standard52'], as: 'stack', zoneId: 'draw', x: 0, z: 0, faceUp: false, shuffled: true },
  ],
  script: EIGHTS_SCRIPT,
};
