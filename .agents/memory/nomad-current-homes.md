---
name: Nomad current homes
description: Keep a character's present nomadic residence distinct from their historical source country.
---
For a person currently living in a nomad group, use `countryId = -1` and `nomadId` for the active group. Keep `sourceCountryId` on the nomad group as historical provenance, not as the person's current residence. When a nomad is removed and the remaining group IDs shift, remap each resident's `nomadId`. Reconstruct residents from a legacy source-country ID only when that source country has no territory.

**Why:** Treating the source-country ID as a current home causes profiles and saved worlds to assign nomadic residents to a state with no population; nominal IDs can also collide with valid country IDs.

**How to apply:** Update residence fields when registering or birthing nomad members, dissolving or settling a group, and migrating saves. Keep multi-group membership in `personIds` separate from a character's single primary home.
