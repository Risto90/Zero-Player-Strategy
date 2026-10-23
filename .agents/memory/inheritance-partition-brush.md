---
name: Inheritance partition painting
description: Constraints for automatic and player-painted inheritance partitions.
---

Treat each inheritance share as source-country pixels added to the heir's territory, not as the heir country's total pixel count. Existing land from an heir's former country is a baseline outside that share's quota. Reserve future city seeds before an earlier share grows, and if a recipient already has territory, seed its new region from an adjacent source pixel. If automatic allocation fails, restore merged home-country ownership, cities, and residents before discarding temporary states.

**Why:** A share can otherwise consume another heir's only city seed, exceed its intended quota by counting annexed land, or leave an heir's prior country partially merged when connected allocation is impossible.

**How to apply:** Use these invariants when changing inheritance partition order, quota distribution, automatic allocation, rollback, or save/resume behavior.
