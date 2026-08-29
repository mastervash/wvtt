/**
 * Prompt Party rules, as a pack script.
 *
 * One player is the judge each round. Everyone else plays an answer card face down,
 * the judge turns them over and picks a winner, and the judge's hat moves along.
 *
 * The interesting part is the hidden information: submissions go into a zone whose
 * visibility is "hidden", so the server never sends their identity to anyone at all —
 * not even to the player who submitted. Revealing them means MOVING them to a public
 * zone, which is the only thing that changes what the engine will send. A script
 * cannot leak a card by getting this wrong, because it is not the script that decides.
 */

export const PROMPT_PARTY_SCRIPT = `
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

function getMap(table, key) {
  var v = table.getVar(key);
  return v && typeof v === 'object' ? v : {};
}

function scoreLine(table) {
  var scores = getMap(table, 'scores');
  var seats = seatsInOrder(table);
  var parts = [];
  for (var i = 0; i < seats.length; i++) {
    parts.push(nameOfSeat(table, seats[i]) + ' ' + (scores[seats[i]] || 0));
  }
  return parts.join(' · ');
}

function announce(table) {
  var judge = table.getVar('judge');
  var phase = table.getVar('phase');
  if (judge === null || judge === undefined) { table.status('Take a seat, then press New game'); return; }
  var who = nameOfSeat(table, judge);
  if (phase === 'submit') table.status(who + ' judges — everyone else plays a card');
  else if (phase === 'reveal') table.status(who + ' judges — press Reveal answers');
  else table.status(who + ' is picking a winner');
}

/** Turn over the next prompt. Prompt cards live in their own face-down zone. */
function drawPrompt(table) {
  var deck = table.piecesIn('prompts');
  if (deck.length === 0) {
    table.log('The prompt deck is empty. That is the game.');
    table.status('Out of prompts — press New game');
    table.setVar('phase', 'over');
    return null;
  }
  var next = deck[deck.length - 1];
  table.moveTo(next.id, 'prompt');
  table.flip(next.id, true);
  table.setVar('promptId', next.id);
  return next;
}

function startRound(table) {
  table.setVar('submissions', {});
  table.setVar('phase', 'submit');
  drawPrompt(table);
  announce(table);
}

/**
 * Start a game.
 *
 * The reason is 'reset' when a player pressed Reset table: that must leave the table
 * cleared and waiting, not deal a fresh game, or the button appears to do nothing.
 */
function onSetup(table, reason) {
  var seats = seatsInOrder(table);
  table.setVar('scores', {});
  table.setVar('submissions', {});
  table.setVar('promptId', null);

  if (reason === 'reset') {
    table.setVar('judge', null);
    table.setVar('phase', 'idle');
    table.status('Table cleared — press New game to start');
    table.log('Table reset. Both decks are back and every hand is empty.');
    return;
  }

  if (seats.length === 0) {
    table.setVar('judge', null);
    table.setVar('phase', 'idle');
    table.status('Take a seat, then press New game');
    table.log('Prompt Party ready. Take a seat and press New game.');
    return;
  }

  // Hands are dealt from the largest pile, which is the answer deck.
  for (var i = 0; i < seats.length; i++) table.dealTo(seats[i], 7);
  table.setVar('judge', seats[0]);
  table.log('Prompt Party. ' + nameOfSeat(table, seats[0]) + ' judges first.');
  startRound(table);
}

function submit(table, payload) {
  if (table.getVar('phase') !== 'submit') return table.reject('Not taking submissions right now.');
  var seat = payload.seat;
  if (seat === null || seat === undefined || seat < 0) return table.reject('Take a seat first.');
  if (seat === table.getVar('judge')) return table.reject('You are judging this round.');

  var pieceId = payload.pieceId;
  var hand = table.piecesIn('hand' + seat);
  var found = null;
  for (var i = 0; i < hand.length; i++) if (hand[i].id === pieceId) found = hand[i];
  if (!found) return table.reject('Play a card from your own hand.');

  var subs = getMap(table, 'submissions');
  for (var key in subs) if (subs[key] === seat) return table.reject('You have already played this round.');

  // Into the hidden zone: face down, and unreadable by every client including the
  // one that sent it.
  table.moveTo(pieceId, 'submissions');
  subs[pieceId] = seat;
  table.setVar('submissions', subs);
  table.log(nameOfSeat(table, seat) + ' has played a card.');

  var seats = seatsInOrder(table);
  var expected = seats.length - 1;
  var count = 0;
  for (var k in subs) count++;
  if (count >= expected && expected > 0) {
    table.setVar('phase', 'reveal');
    table.log('Everyone has played. Over to the judge.');
  }
  announce(table);
}

function reveal(table, payload) {
  if (payload.seat !== table.getVar('judge')) return table.reject('Only the judge can reveal.');
  var pending = table.piecesIn('submissions');
  if (pending.length === 0) return table.reject('Nothing has been played yet.');
  for (var i = 0; i < pending.length; i++) {
    table.moveTo(pending[i].id, 'play');
    table.flip(pending[i].id, true);
  }
  table.setVar('phase', 'judge');
  table.log('The answers are face up. The judge picks a winner.');
  announce(table);
}

function award(table, payload) {
  if (payload.seat !== table.getVar('judge')) return table.reject('Only the judge picks the winner.');
  if (table.getVar('phase') !== 'judge') return table.reject('Reveal the answers first.');

  var subs = getMap(table, 'submissions');
  var winnerSeat = subs[payload.pieceId];
  if (winnerSeat === null || winnerSeat === undefined) return table.reject('That is not one of this round\\'s answers.');

  var scores = getMap(table, 'scores');
  scores[winnerSeat] = (scores[winnerSeat] || 0) + 1;
  table.setVar('scores', scores);
  table.log(nameOfSeat(table, winnerSeat) + ' wins the round. ' + scoreLine(table));

  // Clear the table: everything played this round goes to the muck, face down.
  var played = table.piecesIn('play');
  for (var i = 0; i < played.length; i++) table.moveTo(played[i].id, 'muck');
  var promptId = table.getVar('promptId');
  if (promptId) table.moveTo(promptId, 'muck');

  // Top everyone who played back up to a full hand, then pass the judge's hat along.
  for (var pid in subs) table.dealTo(subs[pid], 1);

  var seats = seatsInOrder(table);
  var i2 = seats.indexOf(table.getVar('judge'));
  table.setVar('judge', seats[(i2 + 1) % seats.length]);
  table.log(nameOfSeat(table, table.getVar('judge')) + ' judges next.');
  startRound(table);
}

function onAction(table, action, payload) {
  if (action === 'newgame') { onSetup(table); return; }
  if (action === 'submit') { submit(table, payload); return; }
  if (action === 'reveal') { reveal(table, payload); return; }
  if (action === 'award') { award(table, payload); return; }
  if (action === 'scores') { table.log('Scores: ' + scoreLine(table)); return; }
}

/**
 * The only move the sandbox itself has to police here is a player trying to shortcut
 * the round by playing a card straight onto the table: submissions have to go through
 * the Play this answer button, or they arrive face up and the round is spoiled.
 */
function validateMove(table, move) {
  var phase = table.getVar('phase');
  if (!phase || phase === 'idle') return;

  if (move.t === 'reveal') {
    return table.reject('Right-click the card and choose “Play this answer”.');
  }
  if (move.t === 'deal' || move.t === 'shuffle') {
    return table.reject('The round deals itself. Use New game to start over.');
  }
}
`;
