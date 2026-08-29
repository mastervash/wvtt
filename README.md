# WVTT — Web Virtual Table Top

A browser multiplayer sandbox tabletop. Cards, chips, dice and boards in 3D, playable on
a phone or a desktop, in a room you share with a six-character code. No account needed.

Games are **packs**: plain JSON describing the components, the table layout and an
optional rules script. Chess and poker are packs. So is anything you make.

## Run your own

One container, one port, no database. Everything below assumes nothing but Docker.

```bash
curl -O https://raw.githubusercontent.com/mastervash/wvtt/main/docker-compose.yml
docker compose up -d
```

Open <http://localhost:2567>. That is the whole install: the image serves the client,
the JSON API and the game websocket together, and keeps tables in a named volume so a
restart does not lose a game in progress.

| Setting | Default | What it does |
|---|---|---|
| `WVTT_PORT` | `2567` | Host port to publish. Change it if 2567 is taken. |
| `WVTT_BIND` | `0.0.0.0` | Host address to publish on. Set this if a proxy fronts the app — see below. |
| `ROOM_TTL_HOURS` | `168` | How long a table is kept after everyone leaves. |
| `DATA_DIR` | `/data` | Where room snapshots go inside the container. |

```bash
WVTT_PORT=8080 docker compose up -d   # somewhere else
docker compose logs -f                # what it is doing
docker compose pull && docker compose up -d   # update
```

Images are built by GitHub Actions for `linux/amd64` and `linux/arm64` and published to
`ghcr.io/mastervash/wvtt` — `latest` follows `main`, and each release is tagged with its
version. To build your own instead, uncomment `build: .` in
[docker-compose.yml](docker-compose.yml) and run `docker compose up -d --build`.

### Putting it on the internet

The container speaks plain HTTP; put a reverse proxy in front of it for TLS. Three things
matter, whatever proxy you use:

- **Websockets must be enabled.** The API and the game share one connection.
- **Do not buffer, and do not time out an idle connection quickly.** A table can sit
  still for a long time between turns.
- **Set `WVTT_BIND`.** Docker publishes ports by writing NAT rules that run *before* ufw
  or firewalld, so a port published on the default `0.0.0.0` is reachable from the
  internet even when your firewall is configured to refuse it. Bind to the address your
  proxy reaches the app on and nothing else can get in:

  ```bash
  # proxy on the same host
  WVTT_BIND=127.0.0.1 docker compose up -d

  # proxy in a container, reaching the host over its bridge
  WVTT_BIND=172.18.0.1 docker compose up -d
  ```

  `docker compose ps` shows what you actually published: `0.0.0.0:2567->2567/tcp` is open
  to the world, `127.0.0.1:2567->2567/tcp` is not.

There is a worked nginx site and a systemd unit for a non-Docker install in
[deploy/](deploy/README.md).

## Working on it

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

## How it is put together

```
shared/    types, component helpers, pack validation, the built-in packs
server/    authoritative game server: engine, ops, visibility, script sandbox
client/    Vite + React + three.js
test/e2e/  browser tests driven by Playwright
deploy/    systemd unit and nginx site for a non-Docker install
Dockerfile, docker-compose.yml
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
the server meant to send — see [Tests](#tests).

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

## Controls

Drag a piece to move it. Tap a deck to draw; tap a loose card to flip it. Two fingers (or
right-drag) move the camera. Your hand is mirrored in the tray at the bottom, because
reading an angled 3D card on a phone is miserable — tap a card there to play it.

**The buttons can be swapped.** By default the left button moves pieces and the right one
opens the menu and pans; the menu offers the mirror image of that for anyone who expects
right-drag to move pieces. The middle button always **pings**: a coloured ring and your
name appear where you clicked, so you can point at a card without narrating it in chat.
The same ping is on every context menu.

**The interface scales.** A slider in the menu sizes every panel between 70% and 160%,
which is separate from the camera zoom on the table itself.

**Graphics can be turned down.** A full table is a hundred-odd shadow-casting meshes,
which is more than a laptop without a discrete GPU wants to draw. The menu offers High,
Balanced and Fastest — shadow resolution, pixel ratio and antialiasing — and the app
picks a starting point from the machine it finds itself on. If frames stay slow for a
few seconds and you have not chosen a level yourself, it steps down one and says so.

**Reset table** puts the deck back together and empties every hand. For a pack that
deals its own hands, the pack's own button (New round, New hand, New game) is what starts
play; scripts are told which of the two is happening through `onSetup(table, reason)`.

## Keyboard shortcuts

Point at a piece or a pile — it picks up a ring on the felt — and press a key. Every
shortcut builds the same op its menu item builds, so the server validates them the same
way: a shortcut cannot bypass a lock, a seat rule or a pack's rules script.

| Key | What it does |
|---|---|
| `F` | Flip it over |
| `S` | Shuffle the pile |
| `D` | Draw one to your hand |
| `1`–`9`, `0` | Draw that many (`0` draws ten) |
| `T` | Take the top card off |
| `R` | Roll the die |
| `Q` / `E` | Turn 90° left or right |
| `V` | Peek, and again to stop |
| `H` | Take into your hand, or play it from there |
| `L` | Lock or unlock in place |
| `P` | Ping where you are pointing |
| `M` | Open the menu for it |

Bare keys, no modifiers — a table is played with one hand on the mouse. They are off
while you are typing anywhere, and while the pack editor is open. The whole scheme can
be switched off in the menu, where the same list is shown for reference.

**Pulling from a pile depends on how you start.** Pull away straight from a pile and you
take the top card off it. Press and hold first, then pull, and you drag the whole pile.
Hold without pulling and you get the menu instead: roll a die, split a pile, peek at a
card, turn a pile over.

**Cards laid on each other form a pile**, the way they would on a real table. Turn that
off in the menu if you would rather everything stayed exactly where you put it.

**Piles can be named, tagged and locked.** Right-click a pile to call it "Discard" or
"Bob's stash", give it a group tag that colours its label, or pin it in place so nobody
can drag, draw from or shuffle it by accident. Locking is enforced on the server, not in
the interface. The same menu takes an exact number of cards off a pile, draws several
into your hand at once, or deals a chosen number to everyone or to one player.

**Recentre** in the toolbar puts the camera back if you lose your bearings. **Chat** opens
a panel down the right-hand side, with each player's messages in their own colour.

## The table log

Every physical action lands in the log with the name of whoever did it, in their own
colour: who moved what where, who drew, who shuffled, who rolled and what they got. It
is filterable by category and can be narrowed to just your own actions.

The log is public state, so it never names a card that is not already common knowledge —
a face-down card is "a card" even in the line describing the player who moved it. The
rule lives in one place, `publiclyKnown()` in `server/src/visibility.ts`, and is the same
rule the wire filter uses.

## The clock

Any table can have a game clock: choose a time from the menu and it appears beside the
board. Two modes — **automatic** switches when you finish a move, **press to end** works
like a real chess clock. Time is counted on the server, so lag does not buy you seconds
and reloading does not reset anything. Set an increment if you want time added back each
move.

## Built-in packs

| Pack | What it is |
|---|---|
| Card Sandbox | A 52-card deck and no rules. The default table. |
| Dice Tray | Full polyhedral set, rolled by the server so results are honest. |
| Blank Board | A 10×10 grid and tokens, meant to be copied and edited. |
| Crazy Eights | Fully enforced: turn order, legal plays, and winning by emptying your hand. |
| Wild Colours | Match the colour or the symbol. Skips, reverses, draw-twos and wilds. |
| Prompt Party | Fill in the blank; answers are played face down and a rotating judge picks a winner. |
| Texas Hold'em | Chips, blinds, dealer button; the script runs the betting rounds. |
| Chess | Snapping 8×8 board with enforced moves, captures and check. |

The home page splits these in two: sandboxes on the left, packs that referee themselves
on the right. Wild Colours and Prompt Party are original packs built from plain text
cards — no licensed content — and both are meant to be copied and rewritten. Prompt
Party in particular ships a deliberately mild deck; swap both lists for your group's own
in the editor.

Chess enforces turn order, legal movement, blocked paths, captures and the rule that you
may not leave your own king in check. Castling, en passant and promotion are not
enforced — switch rules off to set those up by hand, or to play checkers with the same
pieces.

## Making a game

**Open the pack editor** on the home page, or **Make your own game** in the table menu.
Four tabs:

- **Describe** — pick a shape, turn structure and win condition, describe the game, and
  it writes a prompt containing the entire format and script API. Paste that into any AI
  assistant and paste the JSON it returns back under Export. This is the fastest path
  from idea to playable table.
- **Pieces & zones** — build decks (including text decks, one card per line), place and
  size zones, set their visibility, lay out grids, and choose what goes on the table at
  the start (including one lot per seat).
- **Rules** — write the script, with the API reference alongside it.
- **Export** — copy the pack, download it, paste someone else's, or load it onto the table.

A pack is one JSON blob. Sharing a game is sharing that blob.

The editor runs the server's own validator as you type: a pack that cannot load says why
before you press anything, and the Load button stays dead until it is fixed. Work in
progress is saved in your browser, so closing the editor does not lose a script you just
pasted in. The validator lives in `shared/` so both sides run the same checks — a
convenience for the author, not a security boundary, since the server validates every
pack again on arrival and believes nothing the client says about it.

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

## Rooms across restarts

The lobby lists the tables this browser has been at, so coming back does not depend on
remembering a six-character code. A table is kept for a week after everyone leaves —
set `ROOM_TTL_HOURS` to change that — and rejoining rebuilds it with the cards where
they were left. Seats are not kept: sit down again and your hand is still yours.

Tables are snapshotted to disk every minute and when they close, so a room code keeps
working across a restart or a deploy. Stale ones are swept hourly. `DATA_DIR` sets where
they go — `server/data` from a source checkout, `/data` in the container, which is what
the compose file's volume is mounted on.

The snapshots hold every card's identity, including the face-down ones. They are written
`0600` and the directory `0700`, and the container runs as a non-root user; anything that
can read them can read the whole table.

Players are deliberately **not** restored. Sessions do not survive a restart, so everyone
rejoins as a new guest and takes a seat again — re-granting a peek to whoever inherits a
seat would leak information.

## Tests

```bash
npm run typecheck   # server and client
npm test            # engine, visibility, scripting, packs, persistence, security
npm run test:e2e    # eight Playwright suites in a real browser
npm run test:all    # all of the above, plus a production-build smoke test
```

The end-to-end suites drive two browsers against a real server, and several of them
exist to guard one specific mistake: that a client can be made to draw a card it is not
entitled to see. They assert on what crossed the wire and what the renderer is allowed
to put on screen, not on what the server intended.

If a deployed instance already holds port 2567 on this machine, run the pair on another
port instead of stopping it:

```bash
PORT=2599 npm run dev:server
VITE_SERVER_HOST=localhost:2599 npm run dev:client
```

## Licence

MIT — see [LICENSE](LICENSE). The card faces, dice and chips are drawn procedurally, so
there is no third-party artwork in here to trip over. The two party packs ship original
text, not licensed content.

## Known limits

- Guests only; there are no accounts yet, so a name is whatever you type.
- No physics, deliberately — pieces animate rather than tumble.
- Anyone in a room can load a pack or reset the table. Rooms are trusted spaces shared by
  code, not moderated ones.
