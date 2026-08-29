# WVTT — Web Virtual Table Top

Browser multiplayer 3D sandbox tabletop. Cards, chips, dice and boards, playable on phone
or desktop, in a room shared by a six-character code. Guests only, no accounts.

Repo: https://github.com/mastervash/wvtt

## Layout on this machine

This project has been moved and renamed once, so check before assuming a path:

- Working copy for development: whichever directory this file sits in.
- The **deployed** instance is whatever `WorkingDirectory` in
  `/etc/systemd/system/wvtt.service` points at. Confirm with
  `systemctl show wvtt -p WorkingDirectory` before deploying — it is not always the
  directory you are editing.

Deploy with `npm run build` then `sudo systemctl restart wvtt`. The service serves the
built client, the JSON API and the game websocket on port 2567.

Port 2567 is closed to the internet; a reverse proxy in front of it terminates TLS. When
that proxy runs in a container it reaches the host over the container bridge, so the
firewall rule has to allow that interface and nothing else — check the deployment's own
notes for the address, it is not in this repo. Whatever the proxy, it needs **websocket
support switched on**: the API and the game share one connection.

## Architecture

Three layers, and the boundary between them is the point:

- **Layer 0, the sandbox engine** — pieces, stacks, zones, seats. Never bypassable, not
  even by a pack script.
- **Layer 1, the pack** — plain JSON: components, layout, what goes on the table.
- **Layer 2, the rules script** — optional sandboxed JavaScript that can veto moves.
  Per-room switch: off / advisory / enforced.

Built-in packs (card sandbox, dice tray, blank board, Crazy Eights, Wild Colours, Prompt
Party, Hold'em, chess) are authored in exactly
the format users get from the in-app editor. There is no privileged built-in path — if a
built-in needs a capability, the format gains it and every user pack gains it too.

## Things that will bite you

**Hidden information is the whole design.** Card identities sit behind Colyseus
`StateView`; a face-down deck is opaque on the wire, not merely hidden by the client. All
the rules live in `server/src/visibility.ts` — put new ones there, nowhere else.

**Colyseus versions are pinned deliberately.** `@colyseus/core` is exactly `0.16.24`.
`0.16.25` and the `colyseus` meta-package are broken publishes (unresolved `workspace:^`),
and no `colyseus.js` client above `0.16.22` exists, so 0.17+ servers cannot be talked to.

**Schema fields must use `declare`**, never `field!: type`. ES2022 class fields shadow the
prototype accessors and silently break change tracking, failing far from the cause.

**`Encoder.BUFFER_SIZE` is raised on purpose** in `server/src/state.ts`. The 8 KB default
silently drops state past ~85 pieces when StateView is in play.

**Rule enforcement depends on move reversal.** Dragging streams `move` ops, so a piece is
already relocated by the time a `drop` is judged. The room records an origin on `grab`,
restores it before calling `validateMove` (so the script judges the pre-drag board), and
leaves it restored if refused. Removing that restore silently guts enforcement.

**`DATA_DIR` is anchored to the module, not `process.cwd()`.** npm runs workspace scripts
from inside the workspace, so a cwd-relative default made dev and production write room
snapshots to two different directories.

## Testing

```bash
npm test          # unit and integration, no browser needed
npm run test:e2e  # Playwright, needs the dev servers (the runner starts them)
npm run test:all  # everything, including a production build smoke test
```

Snapshots in `server/data/rooms/` contain every card's identity, including face-down
ones. They are gitignored and written `0600`. Never commit them.
