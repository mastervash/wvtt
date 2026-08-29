import type { ComponentDef, GamePack } from '../pack.js';
import { CARD_W, CARD_H, CARD_D } from '../components.js';
import { handZones, MAX_SEATS } from './common.js';
import { PROMPT_PARTY_SCRIPT } from './scripts/promptparty.js';

/**
 * Prompt Party: fill in the blank, and let the judge decide.
 *
 * The deck that ships here is original and deliberately mild — it exists so the pack
 * is playable out of the box, not because these are the best jokes anyone could
 * write. The point of the pack is the shape of the game: a hidden submission phase, a
 * rotating judge, and text cards that are just strings. Open the editor, replace both
 * lists with your group's own, and share the result as a pack.
 */

const PROMPTS: string[] = [
  'The fastest way to ruin a first date is ______.',
  'My therapist says my real problem is ______.',
  'Nothing brings a family together like ______.',
  'I lost the job interview the moment I mentioned ______.',
  'The secret ingredient is ______.',
  "What's the one thing you should never bring to a funeral? ______.",
  'Local council bans ______ after complaints.',
  'My autobiography will be titled ______.',
  'Life was simpler before ______.',
  'The new gym membership includes unlimited ______.',
  'I told the police it was ______.',
  'Every group chat eventually descends into ______.',
  'The doctor took one look and said ______.',
  'This holiday season, give the gift of ______.',
  'Our start-up disrupts the industry with ______.',
  'I was banned from the library for ______.',
  'The zoo added a new exhibit: ______.',
  'What kept me going through the long winter? ______.',
  'My grandmother left me nothing but ______.',
  'The captain went down with ______.',
  'Studies show that children exposed to ______ grow up happier.',
  'The recipe called for two cups of ______.',
  'I could forgive anything except ______.',
  'The reunion was going fine until someone mentioned ______.',
  'Warning: this product may cause ______.',
  'The village elders still speak of ______.',
  'My superpower is ______, which is less useful than it sounds.',
  'The wedding vows included a clause about ______.',
  'Nothing says romance like ______.',
  'The team-building exercise ended in ______.',
  'I keep a jar of ______ for emergencies.',
  'The prophecy foretold ______.',
];

const ANSWERS: string[] = [
  'A suspiciously damp handshake',
  'Interpretive dance',
  'My browser history',
  'Six geese in a trench coat',
  'A confident wrong answer',
  'Aggressive small talk',
  'The last slice of cake',
  'Unpaid parking fines',
  'A goose with a grudge',
  'Mandatory karaoke',
  'The smell of a public swimming pool',
  'Tax season',
  'A bag of expired coupons',
  'Eye contact held two seconds too long',
  'Emotional damage',
  'Three hundred rubber ducks',
  'A very committed pigeon',
  'Reading the terms and conditions',
  'The group project',
  'An unreasonable number of cats',
  'A haunted photocopier',
  'My uncle’s opinions',
  'Free samples',
  'A slightly wrong shade of beige',
  'Speaking exclusively in quotes',
  'Cold soup',
  'The sound of someone else chewing',
  'A collapsing deck chair',
  'Passive-aggressive sticky notes',
  'The office fridge',
  'Beginner’s luck',
  'A haircut I did not agree to',
  'The concept of Monday',
  'A raccoon in a bow tie',
  'Unnecessary jazz hands',
  'Four hours of hold music',
  'A single sock',
  'My imaginary friend’s lawyer',
  'The last biscuit in the tin',
  'Loudly correcting strangers',
  'A very serious duck',
  'Committing to the bit',
  'A trampoline indoors',
  'Snacks that betray you',
  'Sudden confidence',
  'A hedgehog with opinions',
  'The wrong kind of silence',
  'An overqualified hamster',
  'Whispering during films',
  'Instructions in the wrong language',
  'A truly enormous hat',
  'Vigorous nodding',
  'A pyramid scheme run by ducks',
  'The last bus home',
  'Buying a boat on impulse',
  'An unearned sense of destiny',
  'Karaoke at nine in the morning',
  'The smell of burnt toast',
  'A goat that knows what it did',
  'Overwatering the houseplants',
  'A firm but fair badger',
  'The neighbours’ wifi',
  'Two hundred unread emails',
  'A very slow chase scene',
  'Applause at the wrong moment',
  'Motivational posters',
  'A sandwich made in anger',
  'Explaining the joke',
  'A dog that has learned to lie',
  'Weaponised politeness',
  'A brief but intense friendship',
  'The urge to redecorate at midnight',
  'A bucket of lukewarm chips',
  'Directions from a stranger',
  'An alarming amount of glitter',
  'Someone else’s umbrella',
  'A tactical nap',
  'The world’s smallest violin',
  'Shouting at a printer',
  'A pigeon on the departure board',
  'Homemade wine',
  'A firm handshake with a stranger’s dad',
  'Slowly reversing out of the room',
  'Feral optimism',
  'The bit of the map that says “here be dragons”',
  'A cheerful bureaucrat',
  'One thousand loyalty points',
  'A cat that pays rent',
  'Undercooked ambition',
  'The wrong twin',
  'A suspiciously cheap flight',
  'Aggressive gardening',
  'A biscuit of unclear provenance',
  'Arriving fashionably feral',
  'A minor prophecy',
  'The urge to send a risky text',
  'An enthusiastic amateur',
  'A crab in a small hat',
  'My unfinished novel',
  'Snacks smuggled into the cinema',
  'A ferociously specific playlist',
  'The nice fork',
  'A polite argument about bins',
  'An owl that has seen things',
  'Twelve identical keys',
  'The scenic route',
  'A group hug nobody wanted',
  'Being right too loudly',
  'A pond of unknown depth',
  'The concept of brunch',
  'A wheelbarrow full of regret',
  'Second-hand embarrassment',
  'A stapler with a past',
];

const PROMPT_BG = '#15161a';
const ANSWER_BG = '#f4f2ec';

function textCard(id: string, text: string, bg: string, fg: string): ComponentDef {
  return {
    id,
    kind: 'card',
    label: text.length > 40 ? `${text.slice(0, 37)}…` : text,
    face: id,
    // Text cards carry a lot of words, so they are drawn smaller than a playing card's
    // rank. The hand tray renders the same artwork, which is where they are read.
    front: { type: 'text', text, bg, fg, fontScale: 0.55 },
    back: { type: 'text', text: '', bg: bg === PROMPT_BG ? '#0e0f12' : '#22252b', fg: bg },
    w: CARD_W, h: CARD_H, d: CARD_D,
    data: { text },
  };
}

const promptCards = PROMPTS.map((t, i) => textCard(`p${i}`, t, PROMPT_BG, '#f4f2ec'));
const answerCards = ANSWERS.map((t, i) => textCard(`a${i}`, t, ANSWER_BG, '#15161a'));

export const promptPartyPack: GamePack = {
  manifest: {
    formatVersion: 1,
    id: 'promptparty',
    name: 'Prompt Party',
    author: 'built-in',
    description: 'Fill in the blank and let the judge decide. Play an answer face down, the judge turns them all over and picks a winner, then the hat moves along. Swap in your own cards from the editor.',
    minSeats: 3,
    maxSeats: MAX_SEATS,
    defaultEnforcement: 'enforced',
    tableColor: '#3a2c3f',
    actions: [
      { id: 'newgame', label: 'New game' },
      { id: 'reveal', label: 'Reveal answers' },
      { id: 'scores', label: 'Scores' },
      // These need a specific card, which a toolbar button cannot name — so they live
      // in the right-click menu instead.
      { id: 'submit', label: 'Play this answer', target: 'piece' },
      { id: 'award', label: 'This one wins the round', target: 'piece' },
    ],
  },
  components: [...promptCards, ...answerCards],
  zones: [
    ...handZones(MAX_SEATS),
    { id: 'prompt', label: 'The prompt', ownerSeat: null, visibility: 'public', x: -3.4, z: 0, w: 1.5, h: 1.7, layout: 'free' },
    { id: 'prompts', label: 'Prompt deck', ownerSeat: null, visibility: 'hidden', x: -5.1, z: 0, w: 1.5, h: 1.7, layout: 'stack' },
    { id: 'submissions', label: 'Face-down answers', ownerSeat: null, visibility: 'hidden', x: 0, z: -1.4, w: 6.4, h: 1.5, layout: 'row' },
    { id: 'play', label: 'The answers', ownerSeat: null, visibility: 'public', x: 0, z: 0.4, w: 6.4, h: 1.5, layout: 'row' },
    { id: 'answers', label: 'Answer deck', ownerSeat: null, visibility: 'hidden', x: 3.4, z: 0, w: 1.5, h: 1.7, layout: 'stack' },
    { id: 'muck', label: 'Played cards', ownerSeat: null, visibility: 'hidden', x: 5.1, z: 0, w: 1.5, h: 1.7, layout: 'stack' },
  ],
  setup: [
    // Two face-down decks. The answer deck is much the larger of the two, and that is
    // what makes it "the deck" for the script's dealTo() — prompts are drawn by id
    // out of their own zone instead.
    { componentIds: promptCards.map((c) => c.id), as: 'stack', zoneId: 'prompts', x: 0, z: 0, faceUp: false, shuffled: true },
    { componentIds: answerCards.map((c) => c.id), as: 'stack', zoneId: 'answers', x: 0, z: 0, faceUp: false, shuffled: true },
  ],
  script: PROMPT_PARTY_SCRIPT,
};
