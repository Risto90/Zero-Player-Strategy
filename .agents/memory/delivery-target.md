---
name: Delivery target
description: Current production delivery target for Zero Strategy and the boundary with its development runtime.
---
Production should open Zero Strategy directly in a mobile browser; the published Expo Go launch page is no longer the delivery target. The separate browser-production task changes the production bundle and server path, not necessarily the development runtime or dependencies.

**Why:** the user pointed to the browser-production task and chose to finish the ink task without changing Expo or the browser launch flow.

**How to apply:** distinguish production delivery from the app's development toolchain. Do not remove Expo dependencies or workflow as part of unrelated game-engine tasks; make those changes only as part of an explicitly approved migration.
