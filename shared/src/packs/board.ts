import type { GamePack } from '../pack.js';
import { tokenSet, diceSet, TOKEN_COLORS } from '../components.js';
import { handZones, MAX_SEATS } from './common.js';

/**
 * A blank board with coloured tokens and dice: the starting point for homebrew games
 * and the pack most likely to be duplicated and edited by users.
 */
export const boardPack: GamePack = {
  manifest: {
    formatVersion: 1,
    id: 'board',
    name: 'Blank Board',
    author: 'built-in',
    description: 'A 10x10 snapping grid with player tokens and dice. Meant to be copied and edited into your own game.',
    minSeats: 1,
    maxSeats: MAX_SEATS,
    defaultEnforcement: 'off',
    tableColor: '#2f4a5a',
  },
  components: [...tokenSet(), ...diceSet([6])],
  zones: [
    ...handZones(MAX_SEATS),
    { id: 'grid', label: 'Board', ownerSeat: null, visibility: 'public', x: 0, z: 0, w: 5, h: 5, layout: 'grid', gridCols: 10, gridRows: 10 },
  ],
  setup: [
    ...TOKEN_COLORS.map((_, i) => ({
      componentIds: [`token${i}`],
      as: 'loose' as const,
      zoneId: null,
      x: -6 + i * 0.5, z: 3.2,
      faceUp: true,
      shuffled: false,
    })),
    { componentIds: ['repeat:d6:2'], as: 'loose' as const, zoneId: null, x: 5.4, z: 3, faceUp: true, shuffled: false },
  ],
};
