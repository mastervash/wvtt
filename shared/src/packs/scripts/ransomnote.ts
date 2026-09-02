/**
 * Ransom Note rules, as a pack script.
 *
 * Everyone holds a fistful of cut-out words. A prompt is turned over — "explain the
 * hole in the wall" — and each player builds a reply out of the words they happen to
 * hold, one word at a time, left to right. The judge then reads the notes out one by
 * one and picks the one that deserves it.
 *
 * The hidden information is the same shape as Prompt Party's, but it lasts longer: a
 * note is composed over a whole round rather than played in one action, so it lives in
 * a zone whose visibility is "owner" for as long as it is being written. Nobody else
 * is sent those words at all. Reading a note out means MOVING it to the public board,
 * which is the only thing that changes what the engine will send — and moving it back
 * makes it private again, so the judge can go round the notes as many times as they
 * like without spoiling the ones still to come.
 */

export const RANSOM_NOTE_SCRIPT = `
var HAND_SIZE = 12;
var MAX_WORDS = 8;

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

function getList(table, key) {
  var v = table.getVar(key);
  return v && v.length !== undefined ? v : [];
}

function countKeys(map) {
  var n = 0;
  for (var k in map) n++;
  return n;
}

/** How many pieces are left in a face-down pile, by the zone it sits in. */
function pileCount(table, zoneId) {
  var stacks = table.stacks();
  for (var i = 0; i < stacks.length; i++) if (stacks[i].zoneId === zoneId) return stacks[i].count;
  return 0;
}

/** The words of a note, in the order they were laid down. */
function noteText(table, zoneId) {
  var pieces = table.piecesIn(zoneId);
  var words = [];
  for (var i = 0; i < pieces.length; i++) words.push(pieces[i].face);
  return words.join(' ');
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
  if (phase === 'write') {
    var locked = countKeys(getMap(table, 'locked'));
    var expected = Math.max(0, seatsInOrder(table).length - 1);
    table.status(who + ' judges — ' + locked + ' of ' + expected + ' notes are in');
  } else if (phase === 'read') {
    var order = getList(table, 'order');
    var idx = table.getVar('idx');
    if (idx === null || idx === undefined || idx < 0) table.status(who + ' reads the notes out');
    else table.status(who + ' is reading note ' + (idx + 1) + ' of ' + order.length);
  } else if (phase === 'over') {
    table.status('The word bag is empty — press New game');
  } else {
    table.status('Press New game to start');
  }
}

/**
 * Deal a seat back up to a full hand.
 *
 * dealTo() deals from the largest pile on the table, which is the word bag — right up
 * until the bag is emptier than the prompt deck, at which point the prompts would
 * become the largest pile and players would be dealt prompts as if they were words.
 * So the bag is checked before every single card, not once per round.
 */
function topUp(table, seat) {
  var need = HAND_SIZE - table.piecesIn('hand' + seat).length;
  var dealt = 0;
  for (var i = 0; i < need; i++) {
    if (pileCount(table, 'words') <= pileCount(table, 'prompts')) break;
    table.dealTo(seat, 1);
    dealt++;
  }
  return dealt;
}

/** Turn over the next prompt. Prompt cards live in their own face-down pile. */
function drawPrompt(table) {
  var deck = table.piecesIn('prompts');
  if (deck.length === 0) {
    table.log('The prompt deck is empty. That is the game.');
    table.setVar('phase', 'over');
    announce(table);
    return null;
  }
  var next = deck[deck.length - 1];
  table.moveTo(next.id, 'prompt');
  table.flip(next.id, true);
  table.setVar('promptId', next.id);
  return next;
}

function startRound(table) {
  table.setVar('locked', {});
  table.setVar('order', []);
  table.setVar('idx', -1);
  table.setVar('shown', null);
  table.setVar('phase', 'write');
  drawPrompt(table);
  if (table.getVar('phase') === 'write') table.log('New prompt. Build your note, then lock it in.');
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
  table.setVar('locked', {});
  table.setVar('order', []);
  table.setVar('idx', -1);
  table.setVar('shown', null);
  table.setVar('promptId', null);

  if (reason === 'reset') {
    table.setVar('judge', null);
    table.setVar('phase', 'idle');
    table.status('Table cleared — press New game to start');
    table.log('Table reset. The bag is full again and every hand is empty.');
    return;
  }

  if (seats.length === 0) {
    table.setVar('judge', null);
    table.setVar('phase', 'idle');
    table.status('Take a seat, then press New game');
    table.log('Ransom Note ready. Take a seat and press New game.');
    return;
  }

  for (var i = 0; i < seats.length; i++) table.dealTo(seats[i], HAND_SIZE);
  table.setVar('judge', seats[0]);
  table.log('Ransom Note. ' + nameOfSeat(table, seats[0]) + ' judges first.');
  startRound(table);
}

/** The seat that pressed a button, or null when a spectator did. */
function actorSeat(table, payload) {
  var seat = payload.seat;
  if (seat === null || seat === undefined || seat < 0) return null;
  return seat;
}

function addWord(table, payload) {
  if (table.getVar('phase') !== 'write') return table.reject('Nobody is writing right now.');
  var seat = actorSeat(table, payload);
  if (seat === null) return table.reject('Take a seat first.');
  if (seat === table.getVar('judge')) return table.reject('You are judging this round.');
  if (getMap(table, 'locked')[seat]) return table.reject('Your note is locked in.');

  var hand = table.piecesIn('hand' + seat);
  var found = null;
  for (var i = 0; i < hand.length; i++) if (hand[i].id === payload.pieceId) found = hand[i];
  if (!found) return table.reject('Use a word from your own hand.');
  if (table.piecesIn('note' + seat).length >= MAX_WORDS) {
    return table.reject('A note is ' + MAX_WORDS + ' words at most.');
  }

  // Into the seat's own note strip: face up to its owner, and sent to nobody else.
  table.moveTo(found.id, 'note' + seat);
}

function takeBack(table, payload) {
  if (table.getVar('phase') !== 'write') return table.reject('Nobody is writing right now.');
  var seat = actorSeat(table, payload);
  if (seat === null) return table.reject('Take a seat first.');
  if (getMap(table, 'locked')[seat]) return table.reject('Your note is locked in.');

  var note = table.piecesIn('note' + seat);
  for (var i = 0; i < note.length; i++) {
    if (note[i].id === payload.pieceId) { table.moveTo(note[i].id, 'hand' + seat); return; }
  }
  table.reject('That word is not in your note.');
}

function clearNote(table, payload) {
  var seat = actorSeat(table, payload);
  if (seat === null) return table.reject('Take a seat first.');
  if (getMap(table, 'locked')[seat]) return table.reject('Your note is locked in.');
  var note = table.piecesIn('note' + seat);
  for (var i = 0; i < note.length; i++) table.moveTo(note[i].id, 'hand' + seat);
}

function lockIn(table, payload) {
  if (table.getVar('phase') !== 'write') return table.reject('Nobody is writing right now.');
  var seat = actorSeat(table, payload);
  if (seat === null) return table.reject('Take a seat first.');
  if (seat === table.getVar('judge')) return table.reject('You are judging this round.');

  var locked = getMap(table, 'locked');
  if (locked[seat]) return table.reject('You have already locked your note in.');
  if (table.piecesIn('note' + seat).length === 0) return table.reject('Your note is empty.');

  locked[seat] = true;
  table.setVar('locked', locked);
  table.log(nameOfSeat(table, seat) + ' has locked a note in.');

  var expected = seatsInOrder(table).length - 1;
  if (countKeys(locked) >= expected && expected > 0) {
    table.setVar('phase', 'read');
    table.log('Every note is in. Over to the judge.');
  }
  announce(table);
}

/**
 * Show the next note on the public board.
 *
 * The note currently on the board goes back to its writer's own strip first, which
 * makes it private again — so this can be pressed round and round while the judge
 * makes up their mind, and a note is only ever readable by the table while it is the
 * one being read out.
 */
function readNext(table, payload) {
  if (payload.seat !== table.getVar('judge')) return table.reject('Only the judge reads the notes out.');
  if (table.getVar('phase') !== 'read') return table.reject('Not everyone has locked a note in yet.');

  var order = getList(table, 'order');
  if (order.length === 0) {
    var locked = getMap(table, 'locked');
    var seats = seatsInOrder(table);
    for (var i = 0; i < seats.length; i++) {
      if (locked[seats[i]] && table.piecesIn('note' + seats[i]).length > 0) order.push(seats[i]);
    }
    if (order.length === 0) return table.reject('There is nothing to read.');
    table.setVar('order', order);
  }

  var shown = table.getVar('shown');
  if (shown !== null && shown !== undefined) {
    var onBoard = table.piecesIn('board');
    for (var j = 0; j < onBoard.length; j++) table.moveTo(onBoard[j].id, 'note' + shown);
  }

  var idx = table.getVar('idx');
  idx = (idx === null || idx === undefined ? -1 : idx) + 1;
  if (idx >= order.length) idx = 0;
  var seat = order[idx];

  var note = table.piecesIn('note' + seat);
  for (var k = 0; k < note.length; k++) table.moveTo(note[k].id, 'board');
  table.setVar('idx', idx);
  table.setVar('shown', seat);

  // The writer is not named: the judge should be picking the note, not the friend.
  table.log('Note ' + (idx + 1) + ' of ' + order.length + ': ' + noteText(table, 'board'));
  announce(table);
}

function award(table, payload) {
  if (payload.seat !== table.getVar('judge')) return table.reject('Only the judge picks the winner.');
  if (table.getVar('phase') !== 'read') return table.reject('Read the notes out first.');
  var shown = table.getVar('shown');
  if (shown === null || shown === undefined) return table.reject('Read a note out first, then pick it.');

  var scores = getMap(table, 'scores');
  scores[shown] = (scores[shown] || 0) + 1;
  table.setVar('scores', scores);
  table.log(nameOfSeat(table, shown) + ' wins the round with "' + noteText(table, 'board') + '". ' + scoreLine(table));

  // Every word written this round is spent, whether it was the winner or not.
  var onBoard = table.piecesIn('board');
  for (var i = 0; i < onBoard.length; i++) table.moveTo(onBoard[i].id, 'muck');
  var seats = seatsInOrder(table);
  for (var s = 0; s < seats.length; s++) {
    var note = table.piecesIn('note' + seats[s]);
    for (var n = 0; n < note.length; n++) table.moveTo(note[n].id, 'muck');
  }
  var promptId = table.getVar('promptId');
  if (promptId) table.moveTo(promptId, 'muck');

  var short = false;
  for (var t = 0; t < seats.length; t++) {
    topUp(table, seats[t]);
    if (table.piecesIn('hand' + seats[t]).length < HAND_SIZE) short = true;
  }
  if (short) table.log('The word bag is running out. Play the words you have left.');

  var at = seats.indexOf(table.getVar('judge'));
  table.setVar('judge', seats[(at + 1) % seats.length]);
  table.log(nameOfSeat(table, table.getVar('judge')) + ' judges next.');
  startRound(table);
}

function onAction(table, action, payload) {
  if (action === 'newgame') { onSetup(table); return; }
  if (action === 'addword') { addWord(table, payload); return; }
  if (action === 'takeback') { takeBack(table, payload); return; }
  if (action === 'clear') { clearNote(table, payload); return; }
  if (action === 'lockin') { lockIn(table, payload); return; }
  if (action === 'read') { readNext(table, payload); return; }
  if (action === 'award') { award(table, payload); return; }
  if (action === 'scores') { table.log('Scores: ' + scoreLine(table)); return; }
}

/**
 * What the sandbox has to police.
 *
 * Words are meant to reach a note either by being dragged into it or through the
 * right-click menu. Playing one straight onto the table would put it face up in front
 * of everyone, which spoils the round for its writer and nobody else — so it is
 * refused with the instruction rather than silently allowed.
 */
function validateMove(table, move) {
  var phase = table.getVar('phase');
  if (!phase || phase === 'idle' || phase === 'over') return;

  if (move.t === 'reveal') {
    return table.reject('Drag the word into your note, or right-click it and choose “Add to my note”.');
  }
  if (move.t === 'deal' || move.t === 'shuffle') {
    return table.reject('The round deals itself. Use New game to start over.');
  }
  if (phase === 'read' && move.t === 'drop') {
    return table.reject('The judge is reading. Leave the words where they are.');
  }
  if (phase === 'write' && move.t === 'drop' && getMap(table, 'locked')[move.seat]) {
    return table.reject('Your note is locked in.');
  }
}
`;
