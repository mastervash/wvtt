import type { ComponentDef, GamePack, PlacementDef } from '../pack.js';
import type { ZoneDef } from '../types.js';
import { CARD_W, CARD_H, CARD_D } from '../components.js';
import { handZones, MAX_SEATS, SEAT_SPOTS } from './common.js';
import { RANSOM_NOTE_SCRIPT } from './scripts/ransomnote.js';

/**
 * Ransom Note: answer the prompt with the words you happen to be holding.
 *
 * The word bag and the prompts that ship here are original and deliberately mild —
 * they exist so the pack is playable out of the box, not because these are the funniest
 * hundred and fifty words in English. The point of the pack is the shape of the game:
 * a private strip of table where a note is built one word at a time, and a judge who
 * reads the notes out. Open the editor, replace both lists with your group's own, and
 * share the result as a pack.
 */

const PROMPTS: string[] = [
  'Explain to your flatmate why the fridge is empty.',
  'Apologise to the neighbours for last night.',
  'Write the note you leave on a stranger’s windscreen.',
  'Resign from your job in one sentence.',
  'Confess to something you did not do.',
  'Leave instructions for whoever is feeding the cat.',
  'Ask your landlord for the deposit back.',
  'Threaten the pigeon that lives on your balcony.',
  'Write the sign that goes on the office fridge.',
  'Break up with someone you have never met.',
  'Explain the smell in the car.',
  'Review a restaurant you were removed from.',
  'Warn the next person to live here.',
  'Demand a ransom for something worthless.',
  'Give the wedding speech nobody asked you for.',
  'Tell your boss why you are late again.',
  'Leave a note for the babysitter.',
  'Write the note you pass in a very long meeting.',
  'Explain the hole in the wall.',
  'Write a message to yourself in ten years.',
  'Advertise something nobody wants.',
  'Write the plaque for a statue of yourself.',
  'Complain to the council about the bins.',
  'Tell the group chat what happened.',
  'Write the label for a suspicious jar.',
  'Write the fortune inside the world’s worst biscuit.',
  'Explain to the vet what the dog ate.',
  'Leave a note for whoever finds this in a hundred years.',
  'Write the slogan for a failing airline.',
  'Write a warning label for yourself.',
  'Explain to the police what the ladder was for.',
  'Caption a photograph nobody should have taken.',
  'Ask a stranger for a very large favour.',
  'Write the note that ends the friendship.',
  'Explain why the meeting is cancelled.',
  'Write the first line of your autobiography.',
];

/**
 * The word bag.
 *
 * Split by how often a note needs the word rather than by part of speech: a hand of
 * fourteen with no "the" and no "my" in it cannot say anything at all, so the glue is
 * dealt in multiples while the nouns are one of a kind.
 */
const GLUE: string[] = [
  'THE', 'A', 'MY', 'YOUR', 'AND', 'TO', 'OF', 'IN',
  'WITH', 'IS', 'WAS', 'NOT', 'IT', 'YOU', 'I',
];

const COMMON: string[] = [
  'THAT', 'THIS', 'FOR', 'ON', 'BUT', 'ALL', 'VERY', 'NO', 'ME',
  'WE', 'THEY', 'ARE', 'HAVE', 'WILL', 'JUST', 'NOW', 'SORRY', 'PLEASE',
];

const WORDS: string[] = [
  // verbs
  'ATE', 'STOLE', 'BORROWED', 'LOST', 'FOUND', 'BROKE', 'BURNED', 'HID',
  'SOLD', 'SENT', 'LEFT', 'KEPT', 'TRIED', 'FELL', 'RAN', 'DANCED',
  'SCREAMED', 'WHISPERED', 'PROMISED', 'REGRET', 'BLAME', 'FORGIVE',
  'DEMAND', 'ADMIT', 'OWE', 'NEED', 'WANT', 'LOVE', 'MISS', 'WARNED',
  'RETURN', 'REPLACE', 'EXPLAIN', 'PAY', 'SIGNED', 'MOVED', 'ATTACKED',
  // adjectives and adverbs
  'ENORMOUS', 'TINY', 'DAMP', 'HAUNTED', 'ILLEGAL', 'FREE', 'EXPENSIVE',
  'BROKEN', 'MISSING', 'SUSPICIOUS', 'LOUD', 'QUIET', 'URGENT', 'FINAL',
  'SECRET', 'HONEST', 'TERRIBLE', 'PERFECT', 'ANGRY', 'LATE', 'WRONG',
  'STRANGE', 'NORMAL', 'EMOTIONAL', 'SLIGHTLY', 'ENTIRELY', 'ACCIDENTALLY',
  'DELIBERATELY', 'IMMEDIATELY', 'FOREVER',
  // people
  'LANDLORD', 'NEIGHBOUR', 'BOSS', 'POLICE', 'LAWYER', 'DENTIST', 'WIZARD',
  'CLOWN', 'GHOST', 'BABY', 'MOTHER', 'UNCLE', 'TWIN', 'FRIEND', 'STRANGER',
  'COMMITTEE', 'COUNCIL', 'WITNESS',
  // animals
  'CAT', 'DOG', 'GOOSE', 'PIGEON', 'RACCOON', 'GOAT', 'HORSE', 'DUCK',
  'BEE', 'WORM', 'SPIDER', 'HAMSTER',
  // things
  'MONEY', 'RANSOM', 'MEETING', 'EMAIL', 'RECEIPT', 'CONTRACT', 'PASSWORD',
  'KEY', 'DOOR', 'WINDOW', 'WALL', 'CEILING', 'BATHTUB', 'FRIDGE', 'OVEN',
  'TOASTER', 'LADDER', 'VAN', 'BICYCLE', 'BOAT', 'HOSPITAL', 'PRISON',
  'LIBRARY', 'GARDEN', 'BASEMENT', 'ATTIC', 'BIN', 'CHIMNEY', 'PARCEL',
  'LAWN', 'SOUP', 'CHEESE', 'CAKE', 'BISCUIT', 'WINE', 'MILK', 'GRAVY',
  'ONION', 'SOCK', 'HAT', 'WIG', 'TROUSERS', 'HAIRCUT', 'GLITTER',
  'BALLOON', 'TRUMPET', 'PIANO', 'KAZOO', 'MOP', 'GLUE', 'ROPE', 'CANDLE',
  'MATTRESS', 'PILLOW', 'SPOON', 'KETTLE', 'TEA', 'SMOKE', 'MUD', 'RAIN',
  'MOON', 'HOLE', 'SMELL', 'NOISE',
  // occasions and abstractions
  'MIDNIGHT', 'MONDAY', 'BIRTHDAY', 'WEDDING', 'FUNERAL', 'HOLIDAY',
  'DEPOSIT', 'RENT', 'FINE', 'EVIDENCE', 'ALIBI', 'MISTAKE', 'ACCIDENT',
  'SITUATION', 'PROBLEM', 'FEELINGS', 'DIGNITY', 'TRUST', 'LUCK',
  'DESTINY', 'OPINION', 'PLAN', 'EXCUSE', 'REASON',
  // punctuation, which is half the fun
  '!', '?',
];

/** How many of each word go in the bag. */
const GLUE_COPIES = 3;
const COMMON_COPIES = 2;

/**
 * Paper stocks, cycled through so no two adjacent words match.
 *
 * A ransom note is cut from whatever was to hand, and words that all share one
 * background read as a typed sentence rather than a pile of clippings.
 */
const STOCKS: { bg: string; fg: string }[] = [
  { bg: '#f2ece0', fg: '#17161c' },
  { bg: '#17161c', fg: '#f7f4ec' },
  { bg: '#e9e4d6', fg: '#8c1d18' },
  { bg: '#dde3e6', fg: '#1b2430' },
  { bg: '#f6e7c8', fg: '#25201a' },
];

/**
 * Word tiles are smaller than a playing card and carry one word in large type.
 *
 * The proportions are a card's, not a fridge magnet's: a face is drawn onto a
 * card-shaped canvas, so a wide, short tile would stretch its word sideways.
 */
const WORD_W = CARD_W * 0.73;
const WORD_H = CARD_H * 0.73;

function wordCard(id: string, word: string, stock: number): ComponentDef {
  const { bg, fg } = STOCKS[stock % STOCKS.length];
  return {
    id,
    kind: 'card',
    label: word,
    // The face IS the word: it is what the script reads back when it prints a note
    // into the log, and several tiles deliberately share one.
    face: word,
    front: { type: 'text', text: word, bg, fg, fontScale: 1.6 },
    back: { type: 'text', text: '', bg: '#26252b', fg: '#26252b' },
    w: WORD_W, h: WORD_H, d: CARD_D,
    data: { word },
  };
}

function promptCard(id: string, text: string): ComponentDef {
  return {
    id,
    kind: 'card',
    label: text.length > 40 ? `${text.slice(0, 37)}…` : text,
    face: id,
    front: { type: 'text', text, bg: '#101216', fg: '#f4f2ec', fontScale: 0.6 },
    back: { type: 'text', text: '', bg: '#0b0c10', fg: '#0b0c10' },
    w: CARD_W, h: CARD_H, d: CARD_D,
    data: { text },
  };
}

const promptCards = PROMPTS.map((t, i) => promptCard(`p${i}`, t));

const wordCards: ComponentDef[] = [];
const bag: string[] = [];
[...GLUE, ...COMMON, ...WORDS].forEach((word, i) => {
  const id = `w${i}`;
  wordCards.push(wordCard(id, word, i));
  const copies = GLUE.includes(word) ? GLUE_COPIES : COMMON.includes(word) ? COMMON_COPIES : 1;
  for (let n = 0; n < copies; n++) bag.push(id);
});

/**
 * Where each seat writes.
 *
 * One strip per seat, laid just inboard of that seat's hand and owned by it, so the
 * words in a half-written note are sent to nobody else. The strips are placed by hand
 * rather than derived from SEAT_SPOTS: the table already carries six hand zones, a
 * board and three piles, and the only arrangement that leaves no two rectangles
 * overlapping — which would make a dropped word land in the wrong zone — is this one.
 */
const NOTE_SPOTS: { x: number; z: number }[] = [
  { x: 0, z: 2.4 },
  { x: 0, z: -2.4 },
  { x: -4.6, z: 1.15 },
  { x: 4.6, z: -1.15 },
  { x: -4.6, z: 3.5 },
  { x: 4.6, z: -3.5 },
];

const noteZones: ZoneDef[] = SEAT_SPOTS.slice(0, MAX_SEATS).map((_, i) => ({
  id: `note${i}`,
  label: `Seat ${i + 1} note`,
  ownerSeat: i,
  visibility: 'owner' as const,
  x: NOTE_SPOTS[i].x, z: NOTE_SPOTS[i].z, w: 4.2, h: 0.9,
  layout: 'row' as const,
}));

const setup: PlacementDef[] = [
  { componentIds: promptCards.map((c) => c.id), as: 'stack', zoneId: 'prompts', x: 0, z: 0, faceUp: false, shuffled: true },
  { componentIds: bag, as: 'stack', zoneId: 'words', x: 0, z: 0, faceUp: false, shuffled: true },
];

export const ransomNotePack: GamePack = {
  manifest: {
    formatVersion: 1,
    id: 'ransomnote',
    name: 'Ransom Note',
    author: 'built-in',
    description: 'Answer the prompt with the words you were dealt, one clipping at a time. Your note stays private until the judge reads it out, and the best one takes the round. Swap the word bag for your own in the editor.',
    minSeats: 3,
    maxSeats: MAX_SEATS,
    defaultEnforcement: 'enforced',
    tableColor: '#2f3a44',
    actions: [
      { id: 'newgame', label: 'New game' },
      { id: 'lockin', label: 'Lock in my note' },
      { id: 'clear', label: 'Clear my note' },
      { id: 'read', label: 'Read the next note' },
      { id: 'scores', label: 'Scores' },
      // These need a specific word or note, which a toolbar button cannot name — so
      // they live in the right-click menu instead.
      { id: 'addword', label: 'Add to my note', target: 'piece' },
      { id: 'takeback', label: 'Take this word back', target: 'piece' },
      { id: 'award', label: 'This note wins the round', target: 'piece' },
    ],
  },
  components: [...wordCards, ...promptCards],
  zones: [
    ...handZones(MAX_SEATS),
    ...noteZones,
    { id: 'board', label: 'Being read out', ownerSeat: null, visibility: 'public', x: 0, z: 0.55, w: 4.6, h: 1.0, layout: 'row' },
    { id: 'prompt', label: 'The prompt', ownerSeat: null, visibility: 'public', x: 0, z: -0.85, w: 1.5, h: 1.7, layout: 'free' },
    { id: 'prompts', label: 'Prompt deck', ownerSeat: null, visibility: 'hidden', x: -1.7, z: -0.85, w: 1.4, h: 1.7, layout: 'stack' },
    { id: 'words', label: 'Word bag', ownerSeat: null, visibility: 'hidden', x: 1.7, z: -0.85, w: 1.4, h: 1.7, layout: 'stack' },
    { id: 'muck', label: 'Spent words', ownerSeat: null, visibility: 'hidden', x: -6.2, z: -3.6, w: 1.4, h: 1.6, layout: 'stack' },
  ],
  setup,
  script: RANSOM_NOTE_SCRIPT,
};
