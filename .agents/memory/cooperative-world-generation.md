---
name: Cooperative world generation
description: Keep slow startup work responsive on mobile without changing seeded map results.
---
The app's mobile startup path should break expensive map preparation into bounded work slices that yield to the UI. Keep it output-identical to the synchronous generator, which remains useful for tests and non-interactive callers.

**Why:** synchronous map generation blocked Android's startup UI; async startup now has a regression test comparing map data against the original synchronous path.

**How to apply:** when changing seeded geography, update both paths and keep parity checks for both the real-world and random maps.
