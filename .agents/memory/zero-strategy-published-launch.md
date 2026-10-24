---
name: Zero Strategy browser build paths
description: Expo static-web base paths must align across generated browser resources, router URLs, and the production server.
---
Set Expo's `experiments.baseUrl` to the configured `BASE_PATH` during the web export. The production server must strip that same prefix before resolving files, and deep links must be tested under both `/` and a non-empty prefix. Setting only `EXPO_BASE_URL` does not configure SDK 58's static export resources or router bundle.

**Why:** Expo SDK 58 derives static asset URLs and the router's compiled base URL from its app config, not just from environment variables. A mismatch can return HTML at the public root while nested routes, fonts, and images fail.

**How to apply:** For builds where the artifact's base path is injected at build time, temporarily set `experiments.baseUrl` in `app.json`, restore the original file after export, and verify `/`, deep routes, and all static assets against the same server prefix.

Keep the generated `static-build/` directory out of Git, but do not exclude it from `.replitignore`: production creates those files during its build and the running server needs them in the published image.

**Why:** A successful build can generate valid static assets that are then omitted from the runtime image, causing the public app or its assets to return 404.

**How to apply:** When changing static Expo build output, check both the generation logs and whether the output directory survives into the published runtime; retain a regression test for the ignore configuration.
