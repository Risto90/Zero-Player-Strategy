# Zero Strategy

Offline mobile zero-player strategy: draw the first borders, then watch an autonomous world change over time.

## Run & Operate

- `pnpm --filter @workspace/zero-strategy run dev` — run the mobile app
- `pnpm --filter @workspace/zero-strategy run typecheck` — typecheck the mobile app
- `pnpm run typecheck` — full workspace typecheck
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/zero-strategy/app/index.tsx` — world setup and game screen
- `artifacts/zero-strategy/game/engine.ts` — map generation, brush rules, cards, timer, and autonomous turns
- `artifacts/zero-strategy/constants/colors.ts` — atlas-inspired mobile theme
- The active game is saved locally with AsyncStorage; no server or account is required.

## Architecture decisions

- Keep the first game loop offline and device-local so a world can be played without account setup or a network connection.
- The world map is a playable geographic approximation and does not yet contain imported elevation, drainage, or humidity datasets.

## Product

- Choose a world-inspired or newly generated map, then play across all states, focus on one country, control only world events, or observe.
- Draw connected territory with limited ink, affect humidity through event cards, and watch autonomous countries play annual event cards.
- The current playable slice covers founding, expansion, splits, drought, rain, autonomous world events, pausing, and automatic local saves. Population systems, faith, dynasties, government, and uprisings from the broader brief are not implemented yet.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- The Expo app is the current product surface; the shared API server is not required for the local game loop.
- The user wants an Android APK, not a browser-only deliverable. This Replit workspace has no Android SDK, and Replit's documented Expo workflow does not export APK files.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
