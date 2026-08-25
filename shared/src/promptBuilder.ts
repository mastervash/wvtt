/**
 * The LLM prompt generator.
 *
 * Writing a pack by hand means learning a JSON schema and a small scripting API. Most
 * people would rather describe the game they want. This turns a handful of dropdown
 * choices plus a free-text description into a single prompt that already contains the
 * full format reference, so a model can emit a working pack in one shot instead of
 * inventing an API and getting it wrong.
 */

import { scriptApiReference, packFormatReference } from './scriptApi.js';

export interface PromptChoice {
  id: string;
  label: string;
  /** Injected into the prompt to steer the design. */
  guidance: string;
}

export const GAME_SHAPES: PromptChoice[] = [
  {
    id: 'trick',
    label: 'Trick-taking',
    guidance:
      'A trick-taking card game: players each play one card per trick from a private hand, one player wins the trick by some ranking rule, and play continues until hands are empty. Model the trick area as a shared public zone and each hand as an owner-visibility zone.',
  },
  {
    id: 'betting',
    label: 'Betting / poker-like',
    guidance:
      'A betting game: players hold private cards, chips move into a shared pot, and betting rounds alternate with cards being revealed to a public community zone. Track the pot and the current betting round in table variables.',
  },
  {
    id: 'shedding',
    label: 'Shedding / matching',
    guidance:
      'A shedding game in the family of Crazy Eights or Uno: players race to empty their hand by matching the top of a discard pile by rank or suit, drawing when they cannot play. Track whose turn it is and the direction of play in table variables.',
  },
  {
    id: 'set',
    label: 'Set collection',
    guidance:
      'A set-collection game: players draw and gather cards into matching groups, and score when a set is complete. Melds should go to a public zone so everyone can verify them.',
  },
  {
    id: 'grid',
    label: 'Grid / board movement',
    guidance:
      'A board game on a grid zone: pieces occupy squares and move by rules you enforce in validateMove. Use a zone with layout "grid" so pieces snap to cells, and read piece positions from table.piecesIn.',
  },
  {
    id: 'party',
    label: 'Party / prompt and answer',
    guidance:
      'A party game built from two text decks: a prompt deck read aloud and an answer deck held privately. One player judges each round. Generate the card text as "text" faces; no artwork is needed.',
  },
  {
    id: 'dice',
    label: 'Dice / push your luck',
    guidance:
      'A dice game: players roll, decide whether to bank or continue, and risk losing progress. Dice are rolled by the server, so read results from the die piece values rather than generating randomness in the script.',
  },
  {
    id: 'freeform',
    label: 'Freeform sandbox',
    guidance:
      'A sandbox with no enforced rules: lay out the components attractively and let players do as they wish. Keep the script minimal or omit it entirely.',
  },
];

export const TURN_STRUCTURES: PromptChoice[] = [
  { id: 'clockwise', label: 'Strict turns, clockwise', guidance: 'Play proceeds in strict clockwise turn order. Track the current seat in a table variable and reject actions taken out of turn.' },
  { id: 'simultaneous', label: 'Everyone acts at once', guidance: 'All players act simultaneously each round; there is no turn order to enforce.' },
  { id: 'realtime', label: 'Real time, no turns', guidance: 'There are no turns at all — players act freely whenever they like.' },
  { id: 'judge', label: 'Rotating judge', guidance: 'Each round one player is the judge and does not otherwise participate; the role rotates each round.' },
];

export const WIN_CONDITIONS: PromptChoice[] = [
  { id: 'points', label: 'Highest score wins', guidance: 'Players accumulate points; the highest total at the end wins. Track scores in table variables and log them when they change.' },
  { id: 'empty', label: 'First to empty their hand', guidance: 'The first player to play every card from their hand wins the round.' },
  { id: 'last', label: 'Last player standing', guidance: 'Players are eliminated as play continues; the last one remaining wins.' },
  { id: 'target', label: 'First to a target', guidance: 'The first player to reach a target score or collection wins immediately.' },
  { id: 'none', label: 'No win condition', guidance: 'There is no formal winner; the table is for open-ended play.' },
];

export const COMPONENT_SETS: PromptChoice[] = [
  { id: 'cards52', label: 'Standard 52-card deck', guidance: 'Use the standard deck via the "deck:standard52" shorthand in setup, with "generated" playing-card faces.' },
  { id: 'textcards', label: 'Custom text cards', guidance: 'Generate the card set yourself as components with "text" faces. Write the actual card text — do not leave placeholders.' },
  { id: 'chips', label: 'Chips', guidance: 'Include chip components in several denominations, given to each seat with a perSeat setup step.' },
  { id: 'dice', label: 'Dice', guidance: 'Include die components with the appropriate "sides" value.' },
  { id: 'tokens', label: 'Tokens / pawns', guidance: 'Include one coloured token component per seat.' },
  { id: 'board', label: 'A grid board', guidance: 'Include a zone with layout "grid" sized to the board, and place pieces on it in setup.' },
];

export interface PromptOptions {
  description: string;
  shape: string;
  turns: string;
  win: string;
  components: string[];
  seats: [number, number];
  enforcement: 'off' | 'advisory' | 'enforced';
  /** An existing pack to modify rather than start from scratch. */
  basePack?: string;
}

function look(list: PromptChoice[], id: string): PromptChoice | undefined {
  return list.find((c) => c.id === id);
}

/** Build the full prompt a user copies into an LLM. */
export function buildPrompt(opts: PromptOptions): string {
  const shape = look(GAME_SHAPES, opts.shape);
  const turns = look(TURN_STRUCTURES, opts.turns);
  const win = look(WIN_CONDITIONS, opts.win);
  const comps = opts.components.map((id) => look(COMPONENT_SETS, id)).filter(Boolean) as PromptChoice[];

  const design = [
    shape && `- Game shape: ${shape.label}. ${shape.guidance}`,
    turns && `- Turn structure: ${turns.label}. ${turns.guidance}`,
    win && `- Winning: ${win.label}. ${win.guidance}`,
    comps.length > 0 && `- Components:\n${comps.map((c) => `    - ${c.label}. ${c.guidance}`).join('\n')}`,
    `- Players: ${opts.seats[0]} to ${opts.seats[1]}.`,
    `- Rules enforcement: "${opts.enforcement}".${
      opts.enforcement === 'off'
        ? ' The script should not refuse moves.'
        : ' Implement validateMove so illegal moves are caught.'
    }`,
  ].filter(Boolean).join('\n');

  const base = opts.basePack
    ? `\n\nSTART FROM THIS EXISTING PACK and modify it rather than starting over:\n\n\`\`\`json\n${opts.basePack}\n\`\`\``
    : '';

  return `You are writing a game pack for a browser multiplayer 3D tabletop app.

Output EXACTLY ONE JSON object and nothing else — no explanation before or after, no
markdown code fence. It must parse with JSON.parse. The "script" field is a string
containing JavaScript, so remember to escape it correctly as JSON.

THE GAME I WANT:
${opts.description.trim() || '(no extra description given — use your judgement)'}

DESIGN CONSTRAINTS:
${design}

${packFormatReference()}

${scriptApiReference()}

CHECKLIST BEFORE YOU ANSWER:
  - Every id referenced in "setup" exists in "components".
  - Every zoneId referenced in "setup" exists in "zones", unless it contains "{seat}".
  - Private hands use "visibility": "owner" with the matching "ownerSeat".
  - Zones do not overlap awkwardly and all fit on a 14 x 9 table.
  - The script uses only the table methods listed above, with no export/import.
  - Card text is written out in full, with no placeholders left behind.${base}`;
}
