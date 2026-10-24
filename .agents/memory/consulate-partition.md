---
name: Consulate and partition
description: User-defined rules for the simultaneous Consulate and inheritance Partition modifiers.
---

Only when Consulate and Partition are both active, determine the number of resulting countries from available offices: `P = min(G, max(1, ceil((H + R) / K)))`. Here `H` is the selected eligible children who need consul seats, `R` is the living officeholders not included in `H`, `K` is the consulate degree, and `G` is the source's city count. Every resulting country retains the source government and modifiers, including `K`. Territory still follows the existing Partition brush and quota rules. Recalculate from current heirs and active officeholders after each consul death.

**Why:** The design document does not specify this modifier combination; the user supplied these mechanics and explicitly asked not to edit the design text.

**How to apply:** Keep this formula, its reform-weight adjustments, and vacant-seat handling scoped to the combined modifiers. Preserve ordinary inheritance and reform behavior when either modifier is absent.
