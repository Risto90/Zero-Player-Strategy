---
name: Pixel engine checks
description: How to validate the zero-strategy engine headlessly and what to look for.
---
- Bundle a harness that imports artifacts/zero-strategy/game/* with esbuild (`--platform=node --format=esm`, alias expo-file-system to a stub, set Game.persist=false and Game.pause to an immediate promise, await nextTurn; binary at artifacts/api-server/node_modules/.bin/esbuild) and run observer turns.
- Check: culture totals == 100 on owned pixels, religion totals ≤ 100, serialize→deserialize gives 0 raster diffs, turn time (~200 ms on server with ~80 countries).
- Count of religions/cultures after 100 years is the main balance signal; faith weights scale down with the number of existing faiths.
- Render a PPM from renderer.pixels and convert with `magick` to eyeball country shapes (AI painter must grow compact blobs, not snakes).
**Why:** the UI can't show long-run behaviour quickly; earlier balance issues only showed in long simulations.
- Phone speed proxy: run the same bundle with `node --jitless` (no JIT, closer to Hermes than plain Node).
