/**
 * Chess rules, as a pack script.
 *
 * Kept in its own file as a template literal so it stays readable and editable. It is
 * ordinary sandboxed JavaScript — exactly what a user writes in the pack editor — and
 * uses only the documented `table` API. Nothing here is privileged.
 */

export const CHESS_SCRIPT = `
// Chess rules. Runs server-side in the sandbox whenever the room's rules setting is
// not "off". Enforces turn order, legal movement, blocked paths, captures, and the rule
// that you may not leave your own king attacked.
//
// Not implemented: castling, en passant and promotion. Switch rules off to set those up
// by hand, or to play checkers with the same pieces.

var LEFT = -2.0;
var CELL = 0.5;

// Seat 0 plays white and sits at the near edge (row 7); seat 1 plays black (row 0).
function colorOfSeat(seat) { return seat === 0 ? 'w' : seat === 1 ? 'b' : null; }
function key(c, r) { return c + ',' + r; }

function squareAt(x, z) {
  var c = Math.floor((x - LEFT) / CELL);
  var r = Math.floor((z - LEFT) / CELL);
  return { c: Math.max(0, Math.min(7, c)), r: Math.max(0, Math.min(7, r)) };
}

// Map of "col,row" -> piece, built fresh from the table each time it is needed.
function readBoard(table) {
  var out = {};
  var list = table.piecesIn('board');
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    var s = squareAt(p.x, p.z);
    out[key(s.c, s.r)] = {
      id: p.id, color: p.face.charAt(0), type: p.face.charAt(1), c: s.c, r: s.r
    };
  }
  return out;
}

function pathClear(board, fromC, fromR, toC, toR) {
  var dc = Math.sign(toC - fromC);
  var dr = Math.sign(toR - fromR);
  var c = fromC + dc, r = fromR + dr;
  while (c !== toC || r !== toR) {
    if (board[key(c, r)]) return false;
    c += dc; r += dr;
  }
  return true;
}

// Can this piece reach that square, ignoring whether it exposes its own king?
function canReach(board, piece, toC, toR) {
  var dc = toC - piece.c;
  var dr = toR - piece.r;
  var adc = Math.abs(dc), adr = Math.abs(dr);
  var target = board[key(toC, toR)];
  if (target && target.color === piece.color) return false;

  if (piece.type === 'n') return (adc === 1 && adr === 2) || (adc === 2 && adr === 1);
  if (piece.type === 'k') return adc <= 1 && adr <= 1;

  if (piece.type === 'p') {
    // White sits on row 7 and advances toward row 0.
    var dir = piece.color === 'w' ? -1 : 1;
    var startRow = piece.color === 'w' ? 6 : 1;
    if (dc === 0 && dr === dir && !target) return true;
    if (dc === 0 && dr === 2 * dir && piece.r === startRow && !target
        && !board[key(piece.c, piece.r + dir)]) return true;
    if (adc === 1 && dr === dir && target) return true;   // diagonal capture only
    return false;
  }

  var straight = (dc === 0 || dr === 0);
  var diagonal = (adc === adr);
  if (piece.type === 'r' && !straight) return false;
  if (piece.type === 'b' && !diagonal) return false;
  if (piece.type === 'q' && !straight && !diagonal) return false;
  if (!straight && !diagonal) return false;
  if (adc === 0 && adr === 0) return false;
  return pathClear(board, piece.c, piece.r, toC, toR);
}

function kingAttacked(board, color) {
  var kingSq = null;
  for (var k in board) {
    var p = board[k];
    if (p.type === 'k' && p.color === color) kingSq = p;
  }
  if (!kingSq) return false;           // king already captured; nothing to protect
  for (var k2 in board) {
    var q = board[k2];
    if (q.color === color) continue;
    if (canReach(board, q, kingSq.c, kingSq.r)) return true;
  }
  return false;
}

// Apply a move to a copied board so the result can be inspected.
function afterMove(board, piece, toC, toR) {
  var copy = {};
  for (var k in board) if (k !== key(piece.c, piece.r) && k !== key(toC, toR)) copy[k] = board[k];
  copy[key(toC, toR)] = { id: piece.id, color: piece.color, type: piece.type, c: toC, r: toR };
  return copy;
}

function sideName(c) { return c === 'w' ? 'White' : 'Black'; }

function onSetup(table) {
  table.setVar('turn', 'w');
  table.setVar('moves', 0);
  table.status('White to move');
  table.log('Chess ready. White to move. Castling, en passant and promotion are not enforced.');
}

function validateMove(table, move) {
  // Only landing a piece on the board is judged; everything else is left alone so the
  // table still behaves like a sandbox for anything that is not a chess move.
  if (move.t !== 'drop') return;

  var board = readBoard(table);
  var piece = null;
  for (var k in board) if (board[k].id === move.target) piece = board[k];
  if (!piece) return;                  // not a piece on the board

  var myColor = colorOfSeat(move.seat);
  if (!myColor) return table.reject('Take seat 1 (white) or seat 2 (black) to play.');
  if (piece.color !== myColor) return table.reject('That is not your piece.');

  var turn = table.getVar('turn') || 'w';
  if (turn !== myColor) return table.reject('It is ' + (turn === 'w' ? "white" : "black") + "'s turn.");

  var to = squareAt(move.x, move.z);
  if (to.c === piece.c && to.r === piece.r) return;   // put back where it started

  if (!canReach(board, piece, to.c, to.r)) {
    var names = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
    return table.reject('A ' + names[piece.type] + ' cannot move like that.');
  }

  if (kingAttacked(afterMove(board, piece, to.c, to.r), myColor)) {
    return table.reject('That would leave your king in check.');
  }

  // The move stands. Clear any captured piece off the square before the engine puts the
  // moving piece down, or the two would end up occupying it together.
  var captured = board[key(to.c, to.r)];
  if (captured) {
    table.moveTo(captured.id, captured.color === 'w' ? 'takenW' : 'takenB');
    table.log(sideName(myColor) + ' captures.');
  }

  var next = myColor === 'w' ? 'b' : 'w';
  table.setVar('turn', next);
  table.setVar('moves', (table.getVar('moves') || 0) + 1);

  var opponentInCheck = kingAttacked(afterMove(board, piece, to.c, to.r), next);
  if (opponentInCheck) table.log(sideName(next) + ' is in check.');
  table.status(sideName(next) + ' to move' + (opponentInCheck ? ' — in check' : ''));
}
`;
