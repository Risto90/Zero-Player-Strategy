# Zero Strategy

Offline zero-player grand-strategy sandbox: each year event cards are played by painting with a brush on a pixel world map; the rest of the world is painted by the AI.

## Run & Operate

- `pnpm --filter @workspace/zero-strategy-web run dev` — run the main app (installable offline web app, path `/zero-strategy-web/`)
- `pnpm --filter @workspace/zero-strategy-web run typecheck`
- `node artifacts/zero-strategy-web/scripts/build-earth.mjs` — regenerate the real-Earth land mask (`src/game/data/earthLand.ts`) from Natural Earth 1:50m (`world-atlas`)
- `pnpm --filter @workspace/zero-strategy run dev` — older Expo grid version (kept, not developed further)

## Where things live

- `artifacts/zero-strategy-web/src/game/` — engine: geography and climate, zones (closed curves), composition tables, cards, brush, AI painter, renderer, persistence, game controller
- `artifacts/zero-strategy-web/src/components/MapCanvas.tsx` — canvas with pan / pinch zoom / brush
- `artifacts/zero-strategy-web/src/pages/` and `src/components/game/` — start screen and game screen UI
- `artifacts/zero-strategy/` — older Expo grid-based version

## Architecture decisions

- Delivered as an installable PWA (vite-plugin-pwa, everything precached) because native APK builds are not possible in this workspace (no Android SDK).
- Map: 2048×832 equirectangular pixels, latitude 84°N to −62.25°. Real map = Natural Earth coastlines rasterized at build time, with a fixed climate seed, so it's identical on every launch.
- Saved form of every layer is zones bounded by closed rectilinear rings on pixel edges (OSM-like): political (one zone set per country), density/humidity/temperature/drainage (one zone set per value — values in steps of 5), and one layer per culture and per religion (zones per share). Rasterizing zones back is exact.
- Working form: per-pixel rasters; culture and religion are per-pixel ids into an interned composition table. Culture shares sum to 100; religion shares ≤ 100 (rest = no faith).
- Ink is counted in pixels; cards are drawn only when applicable and ink never exceeds what can be spent.
- Sea links: coasts on the same connected body of water (map wraps east–west for water) count as linked at any distance.
- New faiths get rarer as their number grows (otherwise hundreds of tiny sects appear).

## Product

- Start: real Earth or a new random world; roles: all, one country, world events only, observer.
- Cards: founding (always brings a new culture), expansion, split (keeps population, culture, faith), drought, rain, new faith (converts 40% per stroke), culture branch (moves 50% of the source culture).
- Map modes: countries, biomes, cultures, religions, humidity, temperature, drainage, population; single culture/religion share layers from the legend; tap-to-inspect shows per-point shares.

## User preferences

- The user writes in Russian.
- Wants a game that runs offline on their Android phone.

## Gotchas

- Do not use EAS CLI.
- Full design brief: `attached_assets/ZSG_1792705944389.txt`.
