/**
 * The minimal pack from the README must actually work.
 *
 * Documentation that does not run is a bug, so the example is executed here rather
 * than trusted.
 */
import { TableState, Player } from '../src/state.js';
import { buildTable } from '../src/engine.js';
import { validatePack } from '../src/packValidation.js';
import type { GamePack } from '@wvtt/shared';

const pack = {
  manifest: {
    formatVersion: 1, id: 'high-card', name: 'High Card', author: 'me',
    description: 'Everyone flips one card. Highest wins.',
    minSeats: 2, maxSeats: 6, defaultEnforcement: 'advisory',
    actions: [{ id: 'deal', label: 'Deal' }],
  },
  components: [],
  zones: [
    { id: 'hand0', label: 'Seat 1', ownerSeat: 0, visibility: 'owner', x: 0, z: 3.6, w: 4.2, h: 1.3, layout: 'fan' },
  ],
  setup: [
    { componentIds: ['deck:standard52'], as: 'stack', zoneId: null, x: -3, z: -1.5, faceUp: false, shuffled: true },
  ],
  script: "function onAction(table, action) { if (action === 'deal') { for (const s of table.seats()) table.dealTo(s, 1); } }",
} as unknown as GamePack;

let failures = 0;
const check = (l: string, c: boolean, d = '') => { if (!c) failures++; console.log(`  [${c ? 'PASS' : 'FAIL'}] ${l}${!c && d ? ` — ${d}` : ''}`); };

const verdict = validatePack(pack);
check('the README example validates', verdict.ok, verdict.errors.join('; '));

const state = new TableState();
const p = new Player();
p.sessionId = 's0'; p.name = 'Ana'; p.color = '#fff'; p.seat = 0; p.connected = true; p.px = 0; p.pz = 0;
state.players.set('s0', p);
buildTable(state, pack, [0]);

check('a deck is built without defining 52 components', state.pieces.size === 52, `${state.pieces.size} pieces`);
check('the cards have real identities', [...state.pieces.values()].every((pc) => pc.secret.face.length >= 2));
check('the deck is one pile', state.stacks.size === 1, `${state.stacks.size} stacks`);

console.log(failures === 0 ? '\nREADME example works' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
