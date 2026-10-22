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
- Biomes follow temperature, humidity and drainage (low drainage = waterlogged); the rule table lives in `BIOMES` in the engine and is shown in the biome legend.
- Card slots in "all countries" mode are queued as slots and drawn only when they become active, so each card fits the map at that moment.
- Sea links: coasts on the same connected body of water count as linked at any distance.

## Product

- Choose a world-inspired or newly generated map, then play across all states, focus on one country, control only world events, or observe.
- Draw connected territory with limited ink, affect humidity through event cards, and watch autonomous countries play annual event cards.
- Map modes: countries, biomes, cultures, religions — each with a full legend (no cap on entries).
- Cards: founding (always brings a new culture), expansion, split (keeps population, culture, faith), drought, rain, new faith, culture branch. Cards are drawn only if applicable, and ink never exceeds what the map allows.
- Cells hold one leading culture and religion; population shares, dynasties, government forms and uprisings from the brief are not implemented yet.
- Full design brief: `attached_assets/ZSG_1792705944389.txt`.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- The Expo app is the current product surface; the shared API server is not required for the local game loop.
- The user wants an Android APK, not a browser-only deliverable. This Replit workspace has no Android SDK, and Replit's documented Expo workflow does not export APK files.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
