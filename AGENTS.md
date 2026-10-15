# Repository Guidelines

## Project Structure & Module Organization

WVTT is an npm workspace (Node.js 20+) with three TypeScript packages:

- `shared/src/` contains game-pack types, validation, component helpers, and built-in packs/scripts.
- `server/src/` is the authoritative Colyseus server: table state, operations, persistence, visibility, rooms, and the QuickJS rules sandbox. Server tests live in `server/test/`.
- `client/src/` is the Vite, React, and Three.js interface. Keep UI in `ui/`, rendering in `render/`, and client networking/state in `net/`.

Browser tests are in `test/e2e/`; deployment artifacts are in `deploy/`; screenshots for documentation are in `docs/images/`.

## Build, Test, and Development Commands

Run commands from the repository root:

```bash
npm install          # install all workspace dependencies
npm run dev          # start Vite (5173) and game server (2567)
npm run typecheck    # strict TypeScript checks for server and client
npm test             # server unit/integration regression suites
npm run test:e2e     # Playwright suites; starts dev servers itself
npm run test:all     # typecheck, tests, E2E, and production smoke test
npm run build        # build the deployable client and server
```

Use `npm run dev --workspace=client` or `--workspace=server` when working on one layer.

## Coding Style & Naming Conventions

Use ESM TypeScript and follow nearby code: two-space indentation, semicolons, single quotes, and concise names. Use `PascalCase` for React components and schema classes (`TableRoom.ts`), `camelCase` for functions/variables, and descriptive lowercase file names where the existing area does so (for example, `visibility.ts`). There is no repository formatter or linter; make focused edits and run `npm run typecheck`.

For Colyseus schema fields, use `declare field: Type`, never definite-assignment class fields (`field!: Type`), which breaks change tracking. Preserve the server/client/shared boundary rather than duplicating types.

## Testing Guidelines

Add a focused `server/test/<behavior>.ts` regression test for engine, pack, visibility, persistence, or sandbox changes. E2E tests are named by feature, such as `test/e2e/mobile.mjs`. Run the smallest relevant test while iterating, then `npm test`; run `npm run test:e2e` for user-visible interaction changes.

Test hidden information at the wire boundary: card identities must never reach an unauthorized client. Do not weaken `server/src/visibility.ts` or bypass validation/sandbox checks.

## Commits & Pull Requests

Recent history uses concise Conventional Commit-style subjects: `feat: add Short Fuse`, `fix: ...`, `docs: ...`, and `chore: ...`. Keep commits scoped and imperative. PRs should explain the behavior change, list commands run, link relevant issues, and include screenshots or a short recording for visual/UI changes. Flag any multiplayer, security, persistence, or pack-format compatibility impact explicitly.
