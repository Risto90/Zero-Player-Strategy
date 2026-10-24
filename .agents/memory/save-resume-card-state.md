---
name: Card save and resume
description: Preserve in-progress card behavior across a save/load boundary.
---
Saving the world raster alone is not enough to resume a card exactly. Keep the active card's transient brush state with the saved game and restore it before the next player action.

**Why:** brush eligibility and completion side effects depend on per-card history that is not represented by the current map.

**How to apply:** when changing card painting or in-progress saves, compare uninterrupted and save/load continuations through card completion, including ink use, selected options, and pending placements.
