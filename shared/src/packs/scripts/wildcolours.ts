/**
 * Wild Colours rules, as a pack script.
 *
 * The classic colour-and-number shedding game: match the colour or the symbol of the
 * top card, skips and reverses and draw-twos do what you expect, and wilds let the
 * player who lays them name the next colour.
 *
 * Face codes are parsed rather than looked up, because a script cannot read a pack's
 * component `data` — only the identity string. "R5" is a red five, "GS" a green skip,
 * "BR" a blue reverse, "YD" a yellow draw-two, "W" a wild and "W4" a wild draw four.
 */

export const WILD_COLOURS_SCRIPT = `
var COLOUR_NAMES = { R: 'red', Y: 'yellow', G: 'green', B: 'blue' };
var SYMBOL_NAMES = { S: 'skip', R: 'reverse', D: 'draw two' };

function isWild(face) { return face.charAt(0) === 'W'; }
function colourOf(face) { return isWild(face) ? null : face.charAt(0); }
function symbolOf(face) { return isWild(face) ? face : face.substring(1); }

function describe(face) {
  if (face === 'W') return 'wild';
  if (face === 'W4') return 'wild draw four';
  var colour = COLOUR_NAMES[colourOf(face)] || '?';
  var sym = symbolOf(face);
  var name = SYMBOL_NAMES[sym] || sym;
  return colour + ' ' + name;
}

function seatsInOrder(table) {
  var seats = table.seats();
  seats.sort(function (a, b) { return a - b; });
  return seats;
}

function nameOfSeat(table, seat) {
  var players = table.players();
  for (var i = 0; i < players.length; i++) if (players[i].seat === seat) return players[i].name;
  return 'Seat ' + (seat + 1);
}

/** The seat this many places along from a given seat, following the current direction. */
function seatAfter(table, from, steps) {
  var seats = seatsInOrder(table);
  if (seats.length === 0) return null;
  var dir = table.getVar('dir') === -1 ? -1 : 1;
  var i = seats.indexOf(from);
  if (i < 0) i = 0;
  var n = seats.length;
  return seats[(((i + dir * steps) % n) + n) % n];
}

function advance(table, steps) {
  var next = seatAfter(table, table.getVar('turn'), steps || 1);
  table.setVar('turn', next);
  return next;
}

function announce(table) {
  var seat = table.getVar('turn');
  if (seat === null || seat === undefined) return;
  var colour = table.getVar('colour');
  var word = COLOUR_NAMES[colour] || 'any colour';
  table.status(nameOfSeat(table, seat) + ' to play — ' + word);
}

/**
 * Hands are dealt from the largest pile, which is the face-down draw deck.
 *
 * The reason is 'reset' when a player pressed Reset table, and absent when this is called
 * from the New round button. A reset must leave the table CLEARED — the deck stacked
 * and every hand empty — because a reset that silently deals a fresh hand looks exactly
 * like a button that does nothing.
 */
function onSetup(table, reason) {
  var seats = seatsInOrder(table);

  if (reason === 'reset') {
    table.setVar('turn', null);
    table.setVar('colour', null);
    table.setVar('value', null);
    table.setVar('pendingWild', null);
    table.setVar('dir', 1);
    table.shuffle();
    table.status('Table cleared — press New round to deal');
    table.log('Table reset. The deck is shuffled and every hand is empty.');
    return;
  }

  table.recallAll();
  table.setVar('colour', null);
  table.setVar('value', null);
  table.setVar('pendingWild', null);
  table.setVar('dir', 1);
  table.shuffle();

  if (seats.length === 0) {
    table.status('Take a seat, then press New round');
    table.log('Wild Colours ready. Take a seat and press New round.');
    return;
  }

  for (var i = 0; i < seats.length; i++) table.dealTo(seats[i], 7);

  // Turn cards over until a coloured one appears. A wild cannot start the round: with
  // no colour named, every card in every hand would be legal and the first trick would
  // be meaningless. Any wilds turned over stay face up under the starting card, which
  // is what happens at a real table when the dealer flips again.
  var top = null;
  for (var flip = 0; flip < 6; flip++) {
    table.dealToZone('discard', 1);
    var pile = table.piecesIn('discard');
    var candidate = pile.length ? pile[pile.length - 1] : null;
    if (!candidate) break;
    table.flip(candidate.id, true);
    top = candidate;
    if (!isWild(candidate.face)) break;
    table.log('Turned over a ' + describe(candidate.face) + '; flipping again.');
  }
  if (top) {
    table.setVar('colour', colourOf(top.face));
    table.setVar('value', symbolOf(top.face));
    table.log('Starting card: ' + describe(top.face) + '.');
  }
  table.setVar('turn', seats[0]);
  table.log('Wild Colours. Match the colour or the symbol. Wilds change the colour.');
  announce(table);
}

/**
 * Apply what a card does after it has been matched and played.
 *
 * A wild does NOT pass the turn: the player who laid it owes the table a colour, and
 * the game waits for them to press one of the colour buttons.
 */
function resolve(table, seat, face) {
  if (isWild(face)) {
    table.setVar('colour', null);
    table.setVar('value', face);
    table.setVar('pendingWild', seat);
    table.status(nameOfSeat(table, seat) + ' must choose a colour');
    table.log(nameOfSeat(table, seat) + ' played a ' + describe(face) + ' and must choose a colour.');
    return;
  }

  table.setVar('colour', colourOf(face));
  table.setVar('value', symbolOf(face));

  var sym = symbolOf(face);
  if (sym === 'S') {
    var skipped = seatAfter(table, seat, 1);
    table.log(nameOfSeat(table, skipped) + ' is skipped.');
    advance(table, 2);
  } else if (sym === 'R') {
    table.setVar('dir', table.getVar('dir') === -1 ? 1 : -1);
    var seats = seatsInOrder(table);
    // With two players a reverse is a skip, exactly as in the printed rules.
    advance(table, seats.length === 2 ? 2 : 1);
    table.log('Play reverses direction.');
  } else if (sym === 'D') {
    var victim = seatAfter(table, seat, 1);
    table.dealTo(victim, 2);
    table.log(nameOfSeat(table, victim) + ' draws two and is skipped.');
    advance(table, 2);
  } else {
    advance(table, 1);
  }
  announce(table);
}

function onAction(table, action, payload) {
  if (action === 'deal') { onSetup(table); return; }

  if (action.substring(0, 6) === 'colour') {
    var pending = table.getVar('pendingWild');
    if (pending === null || pending === undefined) return table.reject('No wild is waiting for a colour.');
    if (payload.seat !== pending) return table.reject('Only ' + nameOfSeat(table, pending) + ' can choose.');

    var chosen = action.substring(7);
    if (!COLOUR_NAMES[chosen]) return table.reject('Unknown colour.');

    table.setVar('colour', chosen);
    table.setVar('pendingWild', null);
    table.log(nameOfSeat(table, pending) + ' chooses ' + COLOUR_NAMES[chosen] + '.');

    // A wild draw four punishes the next player only once the colour is settled.
    if (table.getVar('value') === 'W4') {
      var victim = seatAfter(table, pending, 1);
      table.dealTo(victim, 4);
      table.log(nameOfSeat(table, victim) + ' draws four and is skipped.');
      table.setVar('turn', seatAfter(table, pending, 2));
    } else {
      table.setVar('turn', seatAfter(table, pending, 1));
    }
    announce(table);
  }
}

function validateMove(table, move) {
  var turn = table.getVar('turn');
  if (turn === null || turn === undefined) return;   // round not started

  if (move.t === 'reveal') {
    var pending = table.getVar('pendingWild');
    if (pending !== null && pending !== undefined) {
      return table.reject(nameOfSeat(table, pending) + ' still has to choose a colour.');
    }
    if (move.seat !== turn) return table.reject('It is ' + nameOfSeat(table, turn) + "'s turn.");

    var hand = table.piecesIn('hand' + move.seat);
    var played = null;
    for (var i = 0; i < hand.length; i++) if (hand[i].id === move.target) played = hand[i];
    if (!played) return;                              // not a card from their hand

    var colour = table.getVar('colour');
    var value = table.getVar('value');
    var ok = isWild(played.face)
      || colour === null
      || colourOf(played.face) === colour
      || symbolOf(played.face) === value;
    if (!ok) {
      return table.reject('Play ' + (COLOUR_NAMES[colour] || 'any colour') + ', a matching symbol, or a wild.');
    }

    if (hand.length - 1 <= 0) {
      table.log(nameOfSeat(table, move.seat) + ' plays their last card and wins!');
      table.status(nameOfSeat(table, move.seat) + ' wins');
      table.setVar('turn', null);
      return;
    }

    resolve(table, move.seat, played.face);
    return;
  }

  if (move.t === 'draw') {
    if (move.seat !== turn) return table.reject('It is ' + nameOfSeat(table, turn) + "'s turn.");
    table.log(nameOfSeat(table, move.seat) + ' draws a card.');
    advance(table, 1);
    announce(table);
    return;
  }

  if (move.t === 'deal' || move.t === 'shuffle') {
    return table.reject('Use New round to start again.');
  }
}
`;
