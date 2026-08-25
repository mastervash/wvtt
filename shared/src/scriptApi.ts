/**
 * The script API reference.
 *
 * Kept as data rather than prose in a docs folder because it has two consumers: the
 * editor's help panel, and the LLM prompt generator that pastes it verbatim so a model
 * can write a working pack without guessing at the API.
 */

export interface ScriptMethodDoc {
  signature: string;
  summary: string;
}

export const SCRIPT_HANDLERS: ScriptMethodDoc[] = [
  { signature: 'onSetup(table)', summary: 'Runs once when the pack loads or the table is reset. Deal starting hands and initialise variables here.' },
  { signature: 'onAction(table, action, payload)', summary: 'Runs when a player presses a game button. `action` matches an id from manifest.actions, which is what puts the button on screen in the first place.' },
  { signature: 'validateMove(table, move)', summary: 'Runs before a move is applied while rules are enforced. Return false, or call table.reject("reason"), to refuse it. Return nothing to allow it.' },
];

export const SCRIPT_METHODS: ScriptMethodDoc[] = [
  { signature: 'table.seats()', summary: 'Array of seat numbers that currently have a player in them.' },
  { signature: 'table.players()', summary: 'Array of { seat, name, connected }.' },
  { signature: 'table.zones()', summary: 'Array of { id, label, ownerSeat, visibility, layout }.' },
  { signature: 'table.piecesIn(zoneId)', summary: 'Array of { id, defId, face, value, faceUp, order, x, z } for every piece in a zone. x and z are table coordinates, which is how a grid game finds what is standing on each square.' },
  { signature: 'table.stacks()', summary: 'Array of { id, count, zoneId } for every pile on the table.' },
  { signature: 'table.getVar(key)', summary: 'Read a value you stored earlier. Returns null if unset.' },
  { signature: 'table.setVar(key, value)', summary: 'Store a JSON-serialisable value for the life of the room. Max 200 keys, 8 KB each.' },
  { signature: 'table.log(text)', summary: 'Write a line into the table log that every player can see.' },
  { signature: 'table.status(text)', summary: "Set the short status line shown in the toolbar, e.g. \"White to move\". Visible to everyone, so never put hidden information in it." },
  { signature: 'table.shuffle(stackId?)', summary: 'Shuffle a pile. Omit the id to shuffle the largest pile (usually the deck).' },
  { signature: 'table.dealTo(seat, count)', summary: "Deal from the deck into a seat's private hand. Returns how many were dealt." },
  { signature: 'table.dealToZone(zoneId, count)', summary: 'Deal from the deck into any zone, e.g. the community board.' },
  { signature: 'table.burn(stackId?)', summary: 'Move the top card face down to the muck or discard zone.' },
  { signature: 'table.recallAll(stackId?)', summary: 'Gather every piece on the table back into one pile, face down.' },
  { signature: 'table.moveTo(pieceId, zoneId)', summary: 'Move a specific piece into a zone.' },
  { signature: 'table.flip(pieceId, faceUp)', summary: 'Turn a piece face up or face down.' },
  { signature: 'table.reject(reason)', summary: 'Refuse the current move with a message shown to the player. Only has an effect inside validateMove while rules are enforced.' },
];

/** Rendered reference, embedded verbatim into the generated LLM prompt. */
export function scriptApiReference(): string {
  const handlers = SCRIPT_HANDLERS.map((m) => `  ${m.signature}\n    ${m.summary}`).join('\n');
  const methods = SCRIPT_METHODS.map((m) => `  ${m.signature}\n    ${m.summary}`).join('\n');
  return `FUNCTIONS YOU DEFINE (all optional):
${handlers}

THE table OBJECT (the only API available):
${methods}

RULES OF THE SANDBOX:
  - Write plain function declarations. Do NOT use "export", "import" or "require" —
    the script is evaluated as a classic script, not a module.
  - There is no fetch, no setTimeout, no process, no filesystem and no network.
  - Scripts run on the server inside a WASM isolate with a memory cap and an
    instruction budget. Infinite loops are killed, so avoid unbounded while loops.
  - Modern JavaScript syntax (let/const, arrow functions, template literals,
    for...of, spread, destructuring) is supported.
  - Keep every handler fast; it runs synchronously while players wait.`;
}

/** The pack JSON shape, described for a model that has to emit one. */
export function packFormatReference(): string {
  return `A pack is a single JSON object:

{
  "manifest": {
    "formatVersion": 1,
    "id": "kebab-case-id",
    "name": "Display Name",
    "author": "Your name",
    "description": "One or two sentences.",
    "minSeats": 1, "maxSeats": 6,
    "defaultEnforcement": "off" | "advisory" | "enforced",
    "tableColor": "#1f6f4a",
    "actions": [ { "id": "deal", "label": "Deal hand" } ]
  },
  "components": [ /* the physical objects; see below */ ],
  "zones":      [ /* regions of the table */ ],
  "setup":      [ /* what to put out at the start */ ],
  "script":     "function onSetup(table) { ... }"
}

COMPONENT (one kind of physical object):
{
  "id": "AS", "kind": "card", "label": "Ace of Spades", "face": "AS",
  "front": { "type": "text", "text": "Ace of Spades", "bg": "#f7f4ec", "fg": "#16161a" },
  "back":  { "type": "generated", "generator": "playing-card", "params": { "back": "default" } },
  "w": 0.63, "h": 0.88, "d": 0.006,
  "data": { "suit": "S", "value": 14 }
}
  kind: "card" | "chip" | "die" | "token" | "piece" | "tile" | "note"
  front/back types: { "type": "text", ... }
                    { "type": "generated", "generator": "playing-card"|"chip"|"die"|"chess"|"blank", "params": {...} }
                    { "type": "image", "dataUri": "data:image/png;base64,..." }
  "data" is free-form and is what your script reads via piece.defId lookups.

ZONE (a region that carries visibility rules — this is how hidden information works):
{
  "id": "hand0", "label": "Seat 1 hand",
  "ownerSeat": 0,            // or null for a shared zone
  "visibility": "owner",     // "public" = everyone sees the faces
                             // "owner"  = only the owning seat sees them (a private hand)
                             // "hidden" = nobody sees them (a face-down deck)
                             // "inherit"= each piece's own faceUp flag decides
  "x": 0, "z": 3.6, "w": 4.2, "h": 1.3,
  "layout": "free" | "row" | "fan" | "grid" | "stack",
  "gridCols": 8, "gridRows": 8,  // only when layout is "grid"
  "checkered": true              // draw alternating squares, as on a chess board
}
Coordinates are in table units on a roughly 14 x 9 table, with x to the right and z
toward the near edge. Seat 0 sits at positive z.

You may leave "components" empty when setup only uses the "deck:standard52" or
"deck:standard54" shorthand — the standard playing cards are supplied and drawn for you.
Define components only for pieces the app does not already know how to draw.

SETUP (what goes on the table at the start):
{
  "componentIds": ["deck:standard52"],  // also "deck:standard54", "repeat:d6:6", or plain ids
  "as": "stack" | "loose" | "grid",
  "zoneId": null,                        // or a zone id; "hand{seat}" with perSeat
  "x": -3.2, "z": -1.6,
  "faceUp": false, "shuffled": true,
  "perSeat": false                       // repeat once per seated player
}

LIMITS: at most 500 components, 64 zones, 256 setup steps, 800 pieces on the table,
a 64 KB script and a 4 MB pack.`;
}
