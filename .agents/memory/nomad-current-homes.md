---
name: Unified country residence
description: Characters have one current country ID, whether their country is settled or nomadic.
---
Every character has one active `countryId`. A nomadic country is a `Country` in the shared collection, distinguished by type and its range/population cells. Converting it to settled changes that same country's type and preserves its ID and residents. Historical source-country provenance, when retained, is not a current residence.

**Why:** Separate nomad IDs and residence fields create collisions and require duplicate profile, turn, and migration paths.

**How to apply:** Migrate legacy group IDs into appended country IDs on load, then keep gameplay, profiles, and saves on the shared country ID. Do not add a separate nomad residence field or active collection.
