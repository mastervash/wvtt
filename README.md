# WVTT — Web Virtual Table Top

A browser multiplayer sandbox tabletop. Cards, chips, dice and boards in 3D, playable on
a phone or a desktop, in a room you share with a six-character code. No account needed.

Games are **packs**: plain JSON describing the components, the table layout and an
optional rules script. Chess and poker are packs. So is anything you make.

## Running it

```bash
npm install
npm run dev
```

The client is on <http://localhost:5173> and the game server on
<http://localhost:2567>. In development the client talks to the server directly, because
Colyseus's websocket path cannot share Vite's HMR socket.

```bash
npm run build      # build client and server
npm start          # serve the built client and the game from one port
```

For the VPS, see [deploy/README.md](deploy/README.md) — a systemd unit and an nginx site
are included.

## How it is put together

```
shared/    types, component helpers, the built-in packs, the pack format reference
server/    authoritative game server: engine, ops, visibility, script sandbox
client/    Vite + React + three.js
test/e2e/  browser tests driven by Playwright
```

Three layers, and the boundary between them is the point:

**Layer 0 — the sandbox engine.** Pieces, stacks, zones and seats. Grab, move, flip,
stack, shuffle, deal, peek. Always on and never bypassable, not even by a pack script.

**Layer 1 — the pack.** Data: what components exist, where the zones are, what goes on
the table at the start.

**Layer 2 — the rules script.** Optional JavaScript that reacts to actions and can veto
moves. A refused move is not merely flagged: the piece is put back where it was picked
up. Dragging streams position updates so other players can watch a piece travel, so
without that the piece would sit wherever it was dragged and a rejection would be
cosmetic. Every room has a rules switch — **off**, **advisory** or **enforced** — and
players can flip it mid-game. A script can also set the toolbar's status line (`table.status`),
which is how "White to move" and "Ana to play — match hearts or ace" get there.

## Hidden information

The reason the server is authoritative rather than peer-to-peer: a client must never
receive a card it is not entitled to see. Devtools are always one keypress away, so
"the client politely hides it" is not a design.

Every piece's identity lives in a separate `secret` field tagged with Colyseus's
`view()`. The server recomputes, per player, exactly which secrets that player may know,
and the encoder refuses to serialise the rest. A face-down deck is genuinely opaque; a
private hand reaches exactly one person.

All the rules for who may see what live in one file, [`server/src/visibility.ts`](server/src/visibility.ts),
and are covered by tests that inspect what actually crossed the wire rather than what
the server meant to send:

```bash
npm test           # hidden-information and script-sandbox suites
npm run test:e2e   # real browsers, two players, checking for leaks
```

One thing that is deliberately *not* protected: a player who was shown a card remembers
it. Standing up does not erase what you already saw, any more than it would at a real
table.

## The script sandbox

Pack scripts are untrusted — anyone in a room can paste one — so they run inside QuickJS
compiled to WebAssembly: separate heap, 16 MB memory cap, an instruction budget that
kills infinite loops, a bounded stack, and no host bindings at all. No `fetch`, no
`require`, no `process`, no timers, no filesystem. The only way out is a single JSON
bridge function.

What a script **can** do is read the whole table, including face-down cards, because
enforcing the rules of poker means knowing the hole cards. **A pack you did not write is
trusted the way a human dealer is trusted.** Loading someone's pack means letting their
code see the table. Rules can be switched off at any time, which stops the script dead.

## Making a game

Menu → **Make your own game**. Four tabs:

- **Describe** — pick a shape, turn structure and win condition, describe the game, and
  it writes a prompt containing the entire format and script API. Paste that into any AI
  assistant and paste the JSON it returns back under Export. This is the fastest path
  from idea to playable table.
- **Pieces & zones** — build decks (including text decks, one card per line), place zones
  and set their visibility.
- **Rules** — write the script, with the API reference alongside it.
- **Export** — copy the pack, download it, paste someone else's, or load it onto the table.

A pack is one JSON blob. Sharing a game is sharing that blob.

### A minimal pack

```json
{
  "manifest": {
    "formatVersion": 1, "id": "high-card", "name": "High Card", "author": "me",
    "description": "Everyone flips one card. Highest wins.",
    "minSeats": 2, "maxSeats": 6, "defaultEnforcement": "advisory",
    "actions": [{ "id": "deal", "label": "Deal" }]
  },
  "components": [],
  "zones": [
    { "id": "hand0", "label": "Seat 1", "ownerSeat": 0, "visibility": "owner",
      "x": 0, "z": 3.6, "w": 4.2, "h": 1.3, "layout": "fan" }
  ],
  "setup": [
    { "componentIds": ["deck:standard52"], "as": "stack", "zoneId": null,
      "x": -3, "z": -1.5, "faceUp": false, "shuffled": true }
  ],
  "script": "function onAction(table, action) { if (action === 'deal') { for (const s of table.seats()) table.dealTo(s, 1); } }"
}
```

`components` can be empty when setup uses a shorthand like `deck:standard52`; the
standard deck is generated for you. Card artwork is drawn procedurally in the browser, so
the app ships no image assets.

## Built-in packs

| Pack | What it is |
|---|---|
| Card Sandbox | A 52-card deck and no rules. The default table. |
| Crazy Eights | Fully enforced: turn order, legal plays, and winning by emptying your hand. |
| Texas Hold'em | Chips, blinds, dealer button; the script runs the betting rounds. |
| Dice Tray | Full polyhedral set, rolled by the server so results are honest. |
| Chess | Snapping 8×8 board with enforced moves, captures and check. |
| Blank Board | A 10×10 grid and tokens, meant to be copied and edited. |

Chess enforces turn order, legal movement, blocked paths, captures and the rule that you
may not leave your own king in check. Castling, en passant and promotion are not
enforced — switch rules off to set those up by hand, or to play checkers with the same
pieces.

## Controls

Drag a piece to move it. Tap a deck to draw; tap a loose card to flip it. Two fingers (or
right-drag) move the camera. Your hand is mirrored in the tray at the bottom, because
reading an angled 3D card on a phone is miserable — tap a card there to play it.

**Pulling from a pile depends on how you start.** Pull away straight from a pile and you
take the top card off it. Press and hold first, then pull, and you drag the whole pile.
Hold without pulling and you get the menu instead: roll a die, split a pile, peek at a
card, turn a pile over.

**Cards laid on each other form a pile**, the way they would on a real table. Turn that
off in the menu if you would rather everything stayed exactly where you put it.

**Recentre** in the toolbar puts the camera back if you lose your bearings. **Chat** opens
a panel down the right-hand side, with each player's messages in their own colour.

## The clock

Any table can have a game clock: choose a time from the menu and it appears beside the
board. Two modes — **automatic** switches when you finish a move, **press to end** works
like a real chess clock. Time is counted on the server, so lag does not buy you seconds
and reloading does not reset anything. Set an increment if you want time added back each
move.

## Rooms across restarts

Tables are snapshotted to disk every minute and when they close, so a room code keeps
working across a restart or a deploy. Snapshots older than a week are swept up at
startup. Set `DATA_DIR` to move them; the default is `server/data`.

Players are deliberately **not** restored. Sessions do not survive a restart, so everyone
rejoins as a new guest and takes a seat again — re-granting a peek to whoever inherits a
seat would leak information.

## Known limits

- Guests only; there are no accounts yet, so a name is whatever you type.
- No physics, deliberately — pieces animate rather than tumble.
- Anyone in a room can load a pack or reset the table. Rooms are trusted spaces shared by
  code, not moderated ones.
