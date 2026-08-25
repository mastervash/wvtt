/**
 * Crazy Eights rules, as a pack script.
 *
 * Written against the same public `table` API a user gets in the pack editor.
 */

export const EIGHTS_SCRIPT = `
// Crazy Eights. Play a card matching the suit or the rank on top of the discard pile.
// Eights are wild and may be played on anything; the suit then becomes the eight's own
// suit. Drawing a card ends your turn. First player to empty their hand wins.
//
// House rules chosen for simplicity: no suit declaration after an eight, and no
// stacking of draw penalties.

var RANK_NAMES = {
  A: 'ace', T: 'ten', J: 'jack', Q: 'queen', K: 'king',
  '2': 'two', '3': 'three', '4': 'four', '5': 'five',
  '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine'
};
var SUIT_NAMES = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };

function rankOf(face) { return face.charAt(0); }
function suitOf(face) { return face.charAt(1); }
function describe(face) {
  return (RANK_NAMES[rankOf(face)] || rankOf(face)) + ' of ' + (SUIT_NAMES[suitOf(face)] || suitOf(face));
}

function seatsInOrder(table) {
  var seats = table.seats();
  seats.sort(function (a, b) { return a - b; });
  return seats;
}

function advanceTurn(table) {
  var seats = seatsInOrder(table);
  if (seats.length === 0) return;
  var current = table.getVar('turn');
  var i = seats.indexOf(current);
  var next = seats[(i + 1 + seats.length) % seats.length];
  table.setVar('turn', next);
  return next;
}

function nameOfSeat(table, seat) {
  var players = table.players();
  for (var i = 0; i < players.length; i++) if (players[i].seat === seat) return players[i].name;
  return 'Seat ' + (seat + 1);
}

function announceTurn(table) {
  var seat = table.getVar('turn');
  if (seat === null || seat === undefined) return;
  table.log(nameOfSeat(table, seat) + ' to play.');
  var top = table.getVar('top');
  var hint = top ? ' — match ' + (SUIT_NAMES[suitOf(top)] || '?') + ' or ' + (RANK_NAMES[rankOf(top)] || '?') : '';
  table.status(nameOfSeat(table, seat) + ' to play' + hint);
}

function onSetup(table) {
  var seats = seatsInOrder(table);

  // Gather every card back before dealing. onSetup also runs when a player presses
  // "New hand", so without this a second deal piles fresh cards on top of the old ones.
  table.recallAll();
  table.setVar('top', null);
  table.shuffle();

  if (seats.length === 0) {
    table.status('Take a seat, then press New hand');
    table.log('Crazy Eights ready. Take a seat and press Deal.');
    return;
  }
  for (var i = 0; i < seats.length; i++) table.dealTo(seats[i], 5);

  // Turn one card face up to start the discard pile.
  table.dealToZone('discard', 1);
  var pile = table.piecesIn('discard');
  var top = pile.length ? pile[pile.length - 1] : null;
  if (top) {
    table.flip(top.id, true);
    table.setVar('top', top.face);
  }
  table.setVar('turn', seats[0]);
  table.log('Crazy Eights. Match the suit or the rank. Eights are wild.');
  if (top) table.log('Starting card: ' + describe(top.face) + '.');
  announceTurn(table);
}

function onAction(table, action) {
  if (action === 'deal') { onSetup(table); return; }
  if (action === 'pass') {
    if (table.getVar('turn') === null) return;
    advanceTurn(table);
    announceTurn(table);
  }
}

// The top of the pile is whatever was played last; tracked in a variable because a
// discard zone holds loose cards rather than an ordered stack.
function topFace(table) {
  var v = table.getVar('top');
  if (v) return v;
  var pile = table.piecesIn('discard');
  return pile.length ? pile[pile.length - 1].face : null;
}

function validateMove(table, move) {
  var turn = table.getVar('turn');
  if (turn === null || turn === undefined) return;   // hand not started yet

  // Playing a card from hand.
  if (move.t === 'reveal') {
    if (move.seat !== turn) return table.reject('It is ' + nameOfSeat(table, turn) + "'s turn.");

    var hand = table.piecesIn('hand' + move.seat);
    var played = null;
    for (var i = 0; i < hand.length; i++) if (hand[i].id === move.target) played = hand[i];
    if (!played) return;                              // not a card from their hand

    var top = topFace(table);
    var ok = !top
      || rankOf(played.face) === '8'
      || rankOf(played.face) === rankOf(top)
      || suitOf(played.face) === suitOf(top);
    if (!ok) {
      return table.reject(
        'You must play a ' + (SUIT_NAMES[suitOf(top)] || '?') +
        ', a ' + (RANK_NAMES[rankOf(top)] || '?') + ', or an eight.'
      );
    }

    table.setVar('top', played.face);
    table.log(nameOfSeat(table, move.seat) + ' plays the ' + describe(played.face) + '.');

    // Winning is checked against the hand minus the card now being played.
    if (hand.length - 1 <= 0) {
      table.log(nameOfSeat(table, move.seat) + ' is out and wins!');
      table.status(nameOfSeat(table, move.seat) + ' wins');
      table.setVar('turn', null);
      return;
    }
    advanceTurn(table);
    announceTurn(table);
    return;
  }

  // Drawing from the deck ends the turn.
  if (move.t === 'draw') {
    if (move.seat !== turn) return table.reject('It is ' + nameOfSeat(table, turn) + "'s turn.");
    table.log(nameOfSeat(table, move.seat) + ' draws a card.');
    advanceTurn(table);
    announceTurn(table);
    return;
  }

  // Dealing or shuffling mid-hand would undo the game state.
  if (move.t === 'deal' || move.t === 'shuffle') {
    return table.reject('Use the Deal button to start a new hand.');
  }
}
`;
