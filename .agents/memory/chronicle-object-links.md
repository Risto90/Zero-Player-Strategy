---
name: Chronicle object links
description: Rules for associating saved event records with game objects.
---
Chronicle associations are explicit typed references captured when an event occurs. Keep legacy text-only entries unlinked; do not infer object relationships from names or wording. When index-based entities are removed, drop links to the removed object and shift references for surviving entities along with their IDs.

**Why:** Old prose can mention names that are ambiguous or reused, and array-index IDs can shift after removals. Guessing or leaving stale references can put events on the wrong profile.

**How to apply:** When adding chronicle events, migrations, filters, or entity-removal flows, verify explicit references are saved and loaded, and update them when entity IDs change.
