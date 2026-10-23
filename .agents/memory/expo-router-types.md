---
name: Expo Router generated route types
description: Keeping Expo Router typed paths current when adding file-based screens
---
After adding an Expo Router screen, the generated `.expo/types/router.d.ts` may still list only old routes until the Expo development workflow starts or refreshes.

**Why:** A new screen's `router.push('/new-route')` initially failed TypeScript because the checked-in generated route declarations were stale; restarting the Expo workflow regenerated them and typechecking passed.

**How to apply:** If a newly added route is rejected by typed navigation, first verify the route file exists, then restart the managed Expo workflow and rerun typecheck before adding casts or editing generated files.
