---
name: Pixel engine checks
description: How to validate the zero-strategy engine headlessly and what to look for.
---
- Bundle a harness that imports artifacts/zero-strategy/game/* with esbuild (`--platform=node --format=esm`, alias expo-file-system to a stub, set Game.persist=false and Game.pause to an immediate promise, await nextTurn; binary at artifacts/api-server/node_modules/.bin/esbuild) and run observer turns.
- Check: culture totals == 100 on owned pixels, religion totals ≤ 100, serialize→deserialize gives 0 raster diffs, turn time (~200 ms on server with ~80 countries).
- Count of religions/cultures after 100 years is the main balance signal; faith weights scale down with the number of existing faiths.
- Render a PPM from renderer.pixels and convert with `magick` to eyeball country shapes (AI painter must grow compact blobs, not snakes).
- When painting sequential inheritance partitions, clear unconsumed frontier marks between heirs; stale marks can make later allocations disconnected even if each brush pass grows contiguously.
**Why:** the UI can't show long-run behaviour quickly; earlier balance issues only showed in long simulations.
- Phone speed proxy: run the same bundle with `node --jitless` (no JIT, closer to Hermes than plain Node).
- For any city-placement change, test both observer auto-placement and the player placement gate after a country already has its mandatory capital.
**Why:** the create-city and build-city flows can share a card but require different eligibility checks; testing only new countries misses a silent block on every later city.
**How to apply:** in the headless harness, confirm a build-city card is offered, the observer adds a non-capital city, and a player can place one in an existing country.

Map visuals can have separate browser and native renderers; verify the renderer used by the target preview before changing or testing map overlays.

**Why:** a marker change in the native renderer did not affect the browser preview, which uses a different drawing path.

**How to apply:** identify the platform-specific renderer first, then verify its output in that same platform.
