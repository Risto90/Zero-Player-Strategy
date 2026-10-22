# Zero Strategy

Offline zero-player grand-strategy sandbox: each year event cards are played by painting with a brush on a pixel world map; the rest of the world is painted by the AI.

## Run & Operate

- `pnpm --filter @workspace/zero-strategy run dev` — Expo app (SDK 58), opened in Expo Go on the phone; web preview at `/`
- `pnpm --filter @workspace/zero-strategy run typecheck`
- `node artifacts/zero-strategy/scripts/build-earth.mjs` — regenerate the real-Earth land mask (`game/data/earthLand.ts`) from Natural Earth 1:50m (`world-atlas`)

## Where things live

- `artifacts/zero-strategy/game/` — engine: geography and climate, zones (closed curves), composition tables, cards, brush, AI painter, renderer, persistence, binary save file, storage, game controller
- `artifacts/zero-strategy/components/map/` — map view: `MapView.tsx` (Skia, phone) and `MapView.web.tsx` (2D canvas, web preview), shared gestures and view math
- `artifacts/zero-strategy/app/` (`index.tsx` start screen, `play.tsx` game screen) and `components/game/` — UI

## Architecture decisions

- Delivered as an Expo app for stock Expo Go 58 (no PWA, no custom native code; native APK builds aren't possible here). Expo Go loads the JS from the dev server.
- Map is drawn with @shopify/react-native-skia as 16 full-width strips; only changed strips are re-uploaded. Touches use the RN responder system (not gesture-handler).
- Long work never blocks the UI: AI cards run in ~12 ms slices with a progress bar, saves trace zones in slices from a frozen copy of the world, map repaints are spread over frames.
- Save = one binary file in the document folder (expo-file-system; IndexedDB on web): JSON header + raw Int32 zone rings. Written at turn end, after strokes and when the app goes to background.
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
- Wants the game on their Android phone via Expo Go (SDK 58). No PWA, no old grid version.

## Gotchas

- Do not use EAS CLI.
- Full design brief: `attached_assets/ZSG_1792705944389.txt`.
