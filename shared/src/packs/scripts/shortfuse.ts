/**
 * Short Fuse rules, as a pack script.
 *
 * On your turn play as many cards as you like, then draw one to end it. Draw a bomb
 * and you are out — unless you play a Defuse, in which case you hide the bomb back in
 * the pile wherever you like. Last player standing wins.
 *
 * Face codes: BOMB, DEF (defuse), NOPE, ATK (attack), SKP (skip), FAV (favour),
 * SHF (shuffle), FUT (peek at the top three), and junk cards starting with J, which
 * only do something played as a matching pair.
 *
 * Every card but a Defuse can be Noped, so a played card does not take effect at once:
 * it waits on the discard pile while anyone may answer it with a Nope (and anyone may
 * Nope that Nope), and the player who laid it presses Go to settle it.
 *
 * The hand geometry below duplicates handZones() in common.ts. A drop is judged
 * before it lands, so the script has to work out for itself where it is headed.
 */

import { SEAT_SPOTS } from '../common.js';

export const SHORT_FUSE_SCRIPT = `
var HAND_SPOTS = ${JSON.stringify(SEAT_SPOTS)};
var HAND_W = 4.2, HAND_H = 1.3;

var NAMES = {
  BOMB: 'Bomb', DEF: 'Defuse', NOPE: 'Nope', ATK: 'Attack', SKP: 'Skip',
  FAV: 'Favour', SHF: 'Shuffle', FUT: 'Peek',
  JDUCK: 'Rubber Duck', JSOCK: 'Sock Puppet', JCONE: 'Traffic Cone',
  JGNOME: 'Garden Gnome', JTOAST: 'Toaster'
};
var DEFUSES = 6;

function isJunk(face) { return face.charAt(0) === 'J'; }
function nameOf(face) { return NAMES[face] || face; }

/* ---------------- seats and turns ---------------- */

function nameOfSeat(table, seat) {
  var players = table.players();
  for (var i = 0; i < players.length; i++) if (players[i].seat === seat) return players[i].name;
  return 'Seat ' + (seat + 1);
}

function isOut(table, seat) {
  return (table.getVar('out') || []).indexOf(seat) >= 0;
}

/**
 * Players still in the round, in seat order. Somebody who sits down mid-round has no
 * hand and no Defuse, so they wait for the next deal rather than being handed turns.
 */
function alive(table) {
  var round = table.getVar('inRound');
  var seats = table.seats();
  seats.sort(function (a, b) { return a - b; });
  return seats.filter(function (s) {
    return !isOut(table, s) && (!round || round.indexOf(s) >= 0);
  });
}

/** The next living seat after this one, even if this one has just been knocked out. */
function nextAfter(table, from) {
  var seats = alive(table);
  if (seats.length === 0) return null;
  for (var i = 0; i < seats.length; i++) if (seats[i] > from) return seats[i];
  return seats[0];
}

function announce(table) {
  var turn = table.getVar('turn');
  if (turn === null || turn === undefined) return;
  var left = table.getVar('turnsLeft') || 1;
  var extra = left > 1 ? ' (' + left + ' turns)' : '';
  table.status(nameOfSeat(table, turn) + ' to play' + extra + ' · ' + drawCount(table) + ' in the pile');
}

/** Drawing, or a Skip, finishes one turn. An Attack victim has more than one to get through. */
function endTurn(table) {
  var turn = table.getVar('turn');
  var left = (table.getVar('turnsLeft') || 1) - 1;
  if (left > 0) {
    table.setVar('turnsLeft', left);
    table.log(nameOfSeat(table, turn) + ' has ' + left + ' more turn' + (left === 1 ? '' : 's') + ' to take.');
  } else {
    table.setVar('turn', nextAfter(table, turn));
    table.setVar('turnsLeft', 1);
  }
  announce(table);
}

/* ---------------- the piles ---------------- */

function drawPile(table) { return table.piecesIn('draw'); }
function drawCount(table) { return drawPile(table).length; }

function drawStackId(table) {
  var stacks = table.stacks();
  for (var i = 0; i < stacks.length; i++) if (stacks[i].zoneId === 'draw') return stacks[i].id;
  return null;
}

/** The top of the draw pile: piecesIn sorts bottom first. */
function topOfDraw(table) {
  var pile = drawPile(table);
  return pile.length ? pile[pile.length - 1] : null;
}

function shuffleDraw(table) {
  var id = drawStackId(table);
  if (id) table.shuffle(id);
}

function findIn(table, zoneId, pieceId) {
  var pieces = table.piecesIn(zoneId);
  for (var i = 0; i < pieces.length; i++) if (pieces[i].id === pieceId) return pieces[i];
  return null;
}

function firstOfFace(table, zoneId, face) {
  var pieces = table.piecesIn(zoneId);
  for (var i = 0; i < pieces.length; i++) if (pieces[i].face === face) return pieces[i];
  return null;
}

/* ---------------- dealing ---------------- */

function clearRound(table) {
  table.setVar('turn', null);
  table.setVar('turnsLeft', 1);
  table.setVar('out', []);
  table.setVar('inRound', null);
  table.setVar('pending', null);
  table.setVar('waiting', null);
  table.setVar('drawing', null);
}

/** Every card, wherever it is, back into one face-down draw pile. */
function gatherDeck(table) {
  table.recallAll(drawStackId(table));
  var zones = table.zones();
  var ids = [''];
  for (var i = 0; i < zones.length; i++) if (zones[i].id !== 'draw') ids.push(zones[i].id);
  for (var z = 0; z < ids.length; z++) {
    var pieces = table.piecesIn(ids[z]);
    for (var p = 0; p < pieces.length; p++) table.insertAt(pieces[p].id, 'draw', 0);
  }
}

/**
 * Deal a round. Bombs and Defuses come out first so nobody is dealt a bomb; everyone
 * gets seven cards and a Defuse; then one bomb fewer than there are players goes back
 * in, with a couple of spare Defuses, and the rest stay out of play.
 *
 * The reason is 'reset' when a player pressed Reset table, which must leave the table
 * cleared rather than dealt. See the note in Wild Colours.
 */
function onSetup(table, reason) {
  clearRound(table);
  gatherDeck(table);
  shuffleDraw(table);

  if (reason === 'reset') {
    table.status('Table cleared — press New round to deal');
    table.log('Table reset. Every card is back in the pile.');
    return;
  }

  var seats = alive(table);
  if (seats.length < 2) {
    table.status('Two or more players, then press New round');
    table.log('Short Fuse ready. Take seats and press New round.');
    return;
  }

  var pile = drawPile(table);
  for (var i = 0; i < pile.length; i++) {
    if (pile[i].face === 'BOMB' || pile[i].face === 'DEF') table.insertAt(pile[i].id, 'aside', 0);
  }
  shuffleDraw(table);
  for (var s = 0; s < seats.length; s++) table.dealTo(seats[s], 7);

  for (var d = 0; d < seats.length; d++) {
    var defuse = firstOfFace(table, 'aside', 'DEF');
    if (defuse) table.moveTo(defuse.id, 'hand' + seats[d]);
  }
  var spare = Math.min(2, DEFUSES - seats.length);
  for (var e = 0; e < spare; e++) {
    var extra = firstOfFace(table, 'aside', 'DEF');
    if (extra) table.insertAt(extra.id, 'draw', 0);
  }
  for (var b = 0; b < seats.length - 1; b++) {
    var bomb = firstOfFace(table, 'aside', 'BOMB');
    if (bomb) table.insertAt(bomb.id, 'draw', 0);
  }
  shuffleDraw(table);

  table.setVar('inRound', seats);
  table.setVar('turn', seats[0]);
  table.log('Short Fuse: ' + (seats.length - 1) + ' bomb' + (seats.length === 2 ? '' : 's') + ' in the pile. Play cards, then draw to end your turn.');
  announce(table);
}

/* ---------------- drawing, and what a draw turns up ---------------- */

function explode(table, seat, bombId) {
  table.log('BOOM. ' + nameOfSeat(table, seat) + ' has no Defuse and is out.');
  var next = nextAfter(table, seat);
  table.insertAt(bombId, 'discard', 0);
  var hand = table.piecesIn('hand' + seat);
  for (var i = 0; i < hand.length; i++) table.insertAt(hand[i].id, 'discard', 0);
  var out = table.getVar('out') || [];
  out.push(seat);
  table.setVar('out', out);

  var left = alive(table);
  if (left.length <= 1) {
    table.setVar('turn', null);
    var winner = left.length ? nameOfSeat(table, left[0]) : 'Nobody';
    table.log(winner + ' is the last one standing and wins!');
    table.status(winner + ' wins');
    return;
  }
  // A player knocked out mid-way through an Attack takes the rest of it with them.
  table.setVar('turn', next === seat ? nextAfter(table, seat) : next);
  table.setVar('turnsLeft', 1);
  announce(table);
}

/** A card has just gone from the top of the pile into this seat's hand. */
function landed(table, seat, piece) {
  if (piece.face !== 'BOMB') { endTurn(table); return; }
  table.log(nameOfSeat(table, seat) + ' drew a BOMB!');
  if (!firstOfFace(table, 'hand' + seat, 'DEF')) { explode(table, seat, piece.id); return; }
  table.setVar('waiting', { kind: 'defuse', seat: seat, bomb: piece.id });
  table.status(nameOfSeat(table, seat) + ' must play a Defuse');
}

/**
 * Put the bomb back. With nothing or one card left there is no real choice to make,
 * so the script makes it rather than asking.
 */
function hideBomb(table, seat, bombId, depth) {
  var count = drawCount(table);
  var at = depth === 'random' ? Math.floor(Math.random() * (count + 1)) : Number(depth);
  table.insertAt(bombId, 'draw', at);
  table.setVar('waiting', null);
  table.log(nameOfSeat(table, seat) + ' hides the bomb back in the pile.');
  endTurn(table);
}

/* ---------------- playing cards ---------------- */

/** A card on the discard, waiting to see whether anyone Nopes it. */
function settle(table) {
  var pending = table.getVar('pending');
  table.setVar('pending', null);
  var who = nameOfSeat(table, pending.seat);

  if (pending.nopes % 2 === 1) {
    table.log(who + "'s " + nameOf(pending.face) + ' was Noped and does nothing.');
    announce(table);
    return;
  }

  var face = pending.face;
  if (face === 'SKP') {
    table.log(who + ' skips the draw.');
    endTurn(table);
  } else if (face === 'ATK') {
    var left = table.getVar('turnsLeft') || 1;
    var victim = nextAfter(table, pending.seat);
    // Attacking while under attack passes on what was left, plus two.
    var owed = left > 1 ? left + 2 : 2;
    table.setVar('turn', victim);
    table.setVar('turnsLeft', owed);
    table.log(who + ' attacks. ' + nameOfSeat(table, victim) + ' must take ' + owed + ' turns.');
    announce(table);
  } else if (face === 'SHF') {
    shuffleDraw(table);
    table.log(who + ' shuffles the draw pile.');
    announce(table);
  } else if (face === 'FUT') {
    var pile = drawPile(table);
    var ids = [];
    for (var i = pile.length - 1; i >= 0 && ids.length < 3; i--) ids.push(pile[i].id);
    for (var j = 0; j < ids.length; j++) table.moveTo(ids[j], 'peek' + pending.seat);
    table.setVar('waiting', { kind: 'peek', seat: pending.seat, ids: ids });
    table.log(who + ' peeks at the top ' + ids.length + ' cards.');
    table.status(who + ' is peeking — press Go to put them back');
  } else if (face === 'FAV' || isJunk(face)) {
    var kind = face === 'FAV' ? 'favour' : 'steal';
    table.setVar('waiting', { kind: kind, seat: pending.seat });
    table.status(who + ': right-click a card in someone’s hand › Pick');
  }
}

/** Put the peeked cards back exactly as they were: the first one taken goes on top. */
function endPeek(table, waiting) {
  for (var i = waiting.ids.length - 1; i >= 0; i--) table.insertAt(waiting.ids[i], 'draw', 0);
  table.setVar('waiting', null);
  announce(table);
}

function onAction(table, action, payload) {
  var seat = payload.seat;
  if (action === 'deal') { onSetup(table); return; }
  if (table.getVar('turn') === null) return table.reject('Press New round to start.');
  if (alive(table).indexOf(seat) < 0) return table.reject('You are not in this round.');

  var waiting = table.getVar('waiting');
  var pending = table.getVar('pending');

  if (action === 'go') {
    if (pending) {
      if (seat !== pending.seat) return table.reject('Only ' + nameOfSeat(table, pending.seat) + ' can press Go.');
      settle(table);
      return;
    }
    if (waiting && waiting.kind === 'peek' && waiting.seat === seat) { endPeek(table, waiting); return; }
    return table.reject('Nothing is waiting to go.');
  }

  if (action === 'draw') {
    var refused = drawRefusal(table, seat);
    if (refused) return table.reject(refused);
    var top = topOfDraw(table);
    if (!top) return table.reject('The pile is empty.');
    table.moveTo(top.id, 'hand' + seat);
    table.log(nameOfSeat(table, seat) + ' draws a card.');
    landed(table, seat, top);
    return;
  }

  if (action.substring(0, 5) === 'tuck:') {
    if (!waiting || waiting.kind !== 'hide' || waiting.seat !== seat) return table.reject('You have no bomb to hide.');
    hideBomb(table, seat, waiting.bomb, action.substring(5));
    return;
  }

  if (action === 'pick') {
    if (!waiting || (waiting.kind !== 'favour' && waiting.kind !== 'steal') || waiting.seat !== seat) {
      return table.reject('You have nothing to pick for.');
    }
    var victim = null;
    var seats = alive(table);
    for (var i = 0; i < seats.length; i++) {
      if (seats[i] !== seat && findIn(table, 'hand' + seats[i], payload.pieceId)) victim = seats[i];
    }
    if (victim === null) return table.reject("Pick a card in another player's hand.");

    if (waiting.kind === 'steal') {
      table.moveTo(payload.pieceId, 'hand' + seat);
      table.setVar('waiting', null);
      table.log(nameOfSeat(table, seat) + ' steals a card from ' + nameOfSeat(table, victim) + '.');
      announce(table);
      return;
    }
    table.setVar('waiting', { kind: 'give', seat: victim, to: seat });
    table.log(nameOfSeat(table, seat) + ' asks ' + nameOfSeat(table, victim) + ' for a favour.');
    table.status(nameOfSeat(table, victim) + ': right-click a card in your hand › Give');
    return;
  }

  if (action === 'give') {
    if (!waiting || waiting.kind !== 'give' || waiting.seat !== seat) return table.reject('Nobody has asked you for a card.');
    if (!findIn(table, 'hand' + seat, payload.pieceId)) return table.reject('Give a card from your own hand.');
    table.moveTo(payload.pieceId, 'hand' + waiting.to);
    table.setVar('waiting', null);
    table.log(nameOfSeat(table, seat) + ' gives ' + nameOfSeat(table, waiting.to) + ' a card.');
    announce(table);
    return;
  }
}

/** Why this seat may not draw right now, or null if it may. */
function drawRefusal(table, seat) {
  var turn = table.getVar('turn');
  if (seat !== turn) return 'It is ' + nameOfSeat(table, turn) + "'s turn.";
  if (table.getVar('pending')) return 'Press Go first — the card you played has not happened yet.';
  if (table.getVar('waiting')) return 'Finish what you are doing first.';
  return null;
}

/** Whether a table point falls inside this seat's hand. */
function inOwnHand(seat, x, z) {
  var spot = HAND_SPOTS[seat];
  if (!spot) return false;
  return Math.abs(x - spot.x) <= HAND_W / 2 && Math.abs(z - spot.z) <= HAND_H / 2;
}

function validateMove(table, move) {
  var turn = table.getVar('turn');
  if (turn === null || turn === undefined) return;     // no round in progress
  var seat = move.seat;
  if (alive(table).indexOf(seat) < 0) return table.reject('You are not in this round.');

  var waiting = table.getVar('waiting');
  var pending = table.getVar('pending');

  if (move.t === 'draw') {
    var refused = drawRefusal(table, seat);
    if (refused) return table.reject(refused);
    if (move.stackId !== drawStackId(table)) return table.reject('Draw from the draw pile.');
    if (move.toZoneId !== 'hand' + seat) return table.reject('Draw into your own hand.');
    if ((move.count || 1) > 1) return table.reject('Draw one card.');
    var top = topOfDraw(table);
    table.setVar('drawing', top ? top.id : null);
    return;
  }

  if (move.t === 'reveal') {
    var card = findIn(table, 'hand' + seat, move.target);
    if (!card) return table.reject('Play cards from your own hand.');
    var who = nameOfSeat(table, seat);

    if (waiting && waiting.kind === 'defuse' && waiting.seat === seat) {
      if (card.face !== 'DEF') return table.reject('Play a Defuse — you are holding a bomb.');
      table.setVar('waiting', { kind: 'hide', seat: seat, bomb: waiting.bomb });
      table.log(who + ' defuses the bomb.');
      if (drawCount(table) <= 1) { hideBomb(table, seat, waiting.bomb, 'random'); return; }
      table.status(who + ': right-click the draw pile to hide the bomb');
      return;
    }

    if (card.face === 'NOPE') {
      if (!pending) return table.reject('There is nothing to Nope.');
      pending.nopes += 1;
      table.setVar('pending', pending);
      var owner = nameOfSeat(table, pending.seat);
      table.log(pending.nopes % 2 === 1
        ? who + ' says NOPE to ' + owner + "'s " + nameOf(pending.face) + '.'
        : who + ' Nopes the Nope. ' + owner + "'s " + nameOf(pending.face) + ' is back on.');
      table.status((pending.nopes % 2 === 1 ? 'Noped! ' : 'Back on! ') + owner + ' presses Go when ready');
      return;
    }

    if (seat !== turn) return table.reject('It is ' + nameOfSeat(table, turn) + "'s turn. Only a Nope can be played now.");
    if (pending) return table.reject('Press Go first — your last card has not happened yet.');
    if (waiting) return table.reject('Finish what you are doing first.');
    if (card.face === 'BOMB') return table.reject('A bomb cannot be played.');
    if (card.face === 'DEF') return table.reject('Save your Defuse for when you draw a bomb.');

    if (isJunk(card.face)) {
      var hand = table.piecesIn('hand' + seat);
      var twin = null;
      for (var i = 0; i < hand.length; i++) {
        if (hand[i].face === card.face && hand[i].id !== card.id) twin = hand[i];
      }
      if (!twin) return table.reject(nameOf(card.face) + ' does nothing alone. Play a matching pair to steal a card.');
      table.insertAt(twin.id, 'discard', 0);
      table.log(who + ' plays a pair of ' + nameOf(card.face) + 's to steal a card.');
    } else {
      table.log(who + ' plays ' + nameOf(card.face) + '.');
    }
    table.setVar('pending', { seat: seat, face: card.face, nopes: 0 });
    table.status(who + ' played ' + nameOf(card.face) + ' · Nope it, or ' + who + ' presses Go');
    return;
  }

  // Rearranging your own hand is fine. Anything else would carry cards between
  // hands, piles and the discard behind the rules' back.
  if (move.t === 'drop') {
    if (findIn(table, 'hand' + seat, move.target) && inOwnHand(seat, move.x, move.z)) return;
    return table.reject('Play a card, draw from the pile, or right-click for more.');
  }

  return table.reject('Not in this game — play a card, draw, or right-click for more.');
}

/** A draw has landed: see what it turned up. */
function afterMove(table, move) {
  if (move.t !== 'draw') return;
  var id = table.getVar('drawing');
  table.setVar('drawing', null);
  if (!id || table.getVar('turn') !== move.seat) return;
  var piece = findIn(table, 'hand' + move.seat, id);
  if (piece) landed(table, move.seat, piece);
}
`;
