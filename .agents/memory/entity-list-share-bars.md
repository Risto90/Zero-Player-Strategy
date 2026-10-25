---
name: Entity list share bars
description: The established visual treatment for population share in Zero Strategy entity lists.
---

Keep population share as the existing horizontal row-background fill, tinted with the entity's color and proportional to its share. Show the percentage and absolute count together at the row's right edge. Do not replace it with a donut or another chart when list rows are consolidated.

**Why:** The user explicitly required matching the existing app style shown in their reference, and the prior implementation already used this treatment.

**How to apply:** Use the shared entity-row component for countries, cultures, religions, nomadic countries, and races. Disable the percentage and fill for city rows, which show only absolute population.
