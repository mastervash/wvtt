import type { GamePack } from '../pack.js';
import { standardDeck, chipSet, CHIP_DENOMS } from '../components.js';
import { handZones, seatSpot, MAX_SEATS } from './common.js';

/**
 * Texas Hold'em kit. The betting maths is automated by the script when enforcement is
 * on; when it is off this is simply a felt with chips, a deck and a dealer button.
 */
export const pokerPack: GamePack = {
  manifest: {
    formatVersion: 1,
    id: 'poker',
    name: "Texas Hold'em",
    author: 'built-in',
    description: "Hold'em felt with chip stacks, blinds and a dealer button. Turn enforcement off at any time to just push chips around.",
    minSeats: 2,
    maxSeats: MAX_SEATS,
    defaultEnforcement: 'advisory',
    tableColor: '#14532d',
    actions: [
      { id: 'deal', label: 'Deal hand' },
      { id: 'flop', label: 'Flop' },
      { id: 'turn', label: 'Turn' },
      { id: 'river', label: 'River' },
    ],
  },
  components: [
    ...standardDeck(false),
    ...chipSet(),
    {
      id: 'dealerBtn', kind: 'token', label: 'Dealer button', face: 'dealerBtn',
      front: { type: 'text', text: 'D', bg: '#f5f5f0', fg: '#16161a', fontScale: 1.6 },
      w: 0.34, h: 0.34, d: 0.06, data: { button: true },
    },
  ],
  zones: [
    ...handZones(MAX_SEATS),
    { id: 'board', label: 'Community cards', ownerSeat: null, visibility: 'public', x: 0, z: -0.3, w: 4.2, h: 1.1, layout: 'row' },
    { id: 'pot', label: 'Pot', ownerSeat: null, visibility: 'public', x: 0, z: 1.3, w: 2.2, h: 1.1, layout: 'free' },
    { id: 'muck', label: 'Muck', ownerSeat: null, visibility: 'hidden', x: 4.6, z: -1.8, w: 1.1, h: 1.4, layout: 'stack' },
    // Each seat's chips sit just inside their own hand, not piled at the origin.
    ...Array.from({ length: MAX_SEATS }, (_, i) => {
      const spot = seatSpot(i, 0.36);
      return {
        id: `bank${i}`, label: `Seat ${i + 1} chips`, ownerSeat: i, visibility: 'public' as const,
        x: spot.x, z: spot.z, w: 2.4, h: 0.9, layout: 'free' as const,
      };
    }),
  ],
  setup: [
    { componentIds: ['deck:standard52'], as: 'stack', zoneId: null, x: -4.6, z: -1.8, faceUp: false, shuffled: true },
    { componentIds: ['dealerBtn'], as: 'loose', zoneId: null, x: -3.4, z: 0.4, faceUp: true, shuffled: false },
    // Each seated player starts with a matching stack.
    ...CHIP_DENOMS.map((c, i) => ({
      componentIds: [`repeat:chip${c.value}:${c.value >= 100 ? 4 : 10}`],
      as: 'stack' as const,
      zoneId: 'bank{seat}',
      x: -0.9 + i * 0.45, z: 0,
      faceUp: true,
      shuffled: false,
      perSeat: true,
    })),
  ],
  script: `
// Hold'em betting automation. Runs only when enforcement is 'advisory' or 'enforced'.
// See the script API reference in the pack editor for the full 'table' surface.
function onSetup(table) {
  table.setVar('pot', 0);
  table.setVar('phase', 'idle');
  table.log('Hold\\'em kit ready. Press Deal to begin a hand.');
}

function onAction(table, action, payload) {
  if (action === 'deal') {
    const seats = table.occupiedSeats();
    if (seats.length < 2) return table.reject('Need at least two players.');
    table.recallAll('deck');
    table.shuffle('deck');
    table.setVar('phase', 'preflop');
    for (const s of seats) table.dealTo(s, 2);
    table.log('Hole cards dealt.');
  }
  if (action === 'flop')  { table.burn('deck'); table.dealToZone('board', 3); table.setVar('phase', 'flop'); }
  if (action === 'turn')  { table.burn('deck'); table.dealToZone('board', 1); table.setVar('phase', 'turn'); }
  if (action === 'river') { table.burn('deck'); table.dealToZone('board', 1); table.setVar('phase', 'river'); }
}
`.trim(),
};
