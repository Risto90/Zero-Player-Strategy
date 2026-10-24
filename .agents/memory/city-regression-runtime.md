---
name: City regression test runtime
description: The full city regression test can exceed short validation windows in this workspace.
---

The city regression suite builds successfully but can run beyond a five-minute validation window, while the smaller city population check completes quickly.

**Why:** The regression fixtures repeatedly initialize and scan full map data; this is separate from interface changes and needs its own performance work.

**How to apply:** For UI-only changes, use type checking and targeted regression scripts, and report the city regression timeout rather than changing game simulation behavior. Revisit its runtime when working on city performance.
