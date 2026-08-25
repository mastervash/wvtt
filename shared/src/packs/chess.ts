import type { GamePack } from '../pack.js';
import { chessSet } from '../components.js';
import { MAX_SEATS } from './common.js';
import { CHESS_SCRIPT } from './scripts/chess.js';

// The origin is the board's near-left EDGE, not the first cell's centre; place() adds
// half a square to reach the centre. Getting this wrong puts every piece half a square
// off the grid and pushes the eighth rank off the board entirely.
const BOARD_ORIGIN_X = -2.0;
const BOARD_ORIGIN_Z = -2.0;
export const SQUARE = 0.5;

/**
 * Chess. The board is an 8x8 grid zone; pieces snap to squares.
 *
 * With enforcement off this is a free-move set you can also play checkers on.
 * With enforcement on the script rejects illegal moves.
 */
export const chessPack: GamePack = {
  manifest: {
    formatVersion: 1,
    id: 'chess',
    name: 'Chess',
    author: 'built-in',
    description: 'A chess set on a snapping 8x8 board. Rules enforcement is optional — switch it off to set up puzzles or play checkers with the same pieces.',
    minSeats: 2,
    maxSeats: 2,
    defaultEnforcement: 'enforced',
    tableColor: '#4a3b2f',
  },
  components: chessSet(),
  zones: [
    {
      id: 'board', label: 'Chess board', ownerSeat: null, visibility: 'public',
      x: 0, z: 0, w: 8 * SQUARE, h: 8 * SQUARE,
      layout: 'grid', gridCols: 8, gridRows: 8, checkered: true,
    },
    { id: 'takenW', label: 'Captured white', ownerSeat: null, visibility: 'public', x: -3.2, z: 0, w: 1.2, h: 3, layout: 'grid', gridCols: 2, gridRows: 8 },
    { id: 'takenB', label: 'Captured black', ownerSeat: null, visibility: 'public', x: 3.2, z: 0, w: 1.2, h: 3, layout: 'grid', gridCols: 2, gridRows: 8 },
  ],
  setup: buildChessSetup(),
  script: CHESS_SCRIPT,
};

function buildChessSetup() {
  const backRank = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  const out = [];
  for (let file = 0; file < 8; file++) {
    // Row 7 is the near edge, where seat 1 sits, so white goes there and the board
    // reads the right way round for the player who joins first.
    out.push(place(`w${backRank[file]}`, file, 7));
    out.push(place('wp', file, 6));
    out.push(place('bp', file, 1));
    out.push(place(`b${backRank[file]}`, file, 0));
  }
  return out;

  function place(componentId: string, file: number, rank: number) {
    return {
      componentIds: [componentId],
      as: 'loose' as const,
      zoneId: 'board',
      x: BOARD_ORIGIN_X + file * SQUARE + SQUARE / 2,
      z: BOARD_ORIGIN_Z + rank * SQUARE + SQUARE / 2,
      faceUp: true,
      shuffled: false,
    };
  }
}
