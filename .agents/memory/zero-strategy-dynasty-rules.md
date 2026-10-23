---
name: Zero Strategy dynasty and relationship rules
description: Persistent rules for births, relationships, succession, country inheritance, and dynasty surnames.
---
Every recorded child must have exactly two recorded parents who are mutually married or in a love relationship. Marriage, births, and lineage tracking must work under every government form; tribal and tyrannical rulers can pass power to children. If a sitting ruler inherits another country, that ruler's former country is absorbed into the new realm. Living dynasties use distinct surnames, not numeric IDs. The displayed ruling dynasty is only the sitting ruler's family; former ruling families belong in the separate important-people history. For ages below 66, calculate an annual death chance whose compounded probability over the full age band equals the design's stated period risk; only elderly characters use the design's separate annual risk.

**Why:** the user explicitly required these rules for Zero Strategy.

**How to apply:** enforce the relationship invariant in birth/event resolution and save migration; preserve descendant eligibility across government changes; route every succession through foreign-ruler annexation; keep surname identity stable by dynasty; display current-house members separately from historical important people; use `1 - (1 - periodRisk)^(1 / yearsInBand)` for each annual risk below age 66.
