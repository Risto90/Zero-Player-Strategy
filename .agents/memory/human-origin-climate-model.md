---
name: Human-origin climate model
description: Project interpretation for human ancestry categories, habitat ranges, and persisted mixes.
---

Climate ranges for the eight requested human-origin labels represent broad environments where generations lived; do not describe them as immutable innate comfort limits. Keep ancestry separate from current residence, and preserve the user's generation-based framing when explaining or extending the model.

**Why:** The user explicitly clarified that the profile differences come from generations living in a shared environment, not from an agent's own reinterpretation of scientific data.

**How to apply:** When changing climate behavior, preserve the named categories and canonical origin shares; distinguish those from location and residence history, and do not invent adaptation rates without an explicit game rule.

Shared composition-table IDs can also be referenced by city groups and nomad cohorts without appearing in the raster. Persist every table entry in stable order so saves cannot silently remap those references.

**Why:** Pixel-zone serialization alone loses compositions used only by a city or cohort, and loading them against a rebuilt table can assign the wrong ancestry.

**How to apply:** When serializing any field that stores a shared-table index, also preserve the referenced table or serialize the stable composition value itself.
