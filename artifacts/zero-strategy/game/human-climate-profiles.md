# Human-origin categories and climate fit

## Model contract

The eight requested labels are game ancestry categories under one human species. They all share the same human age stages. The categories do not change culture, religion, or age rules.

Climate ranges represent broad reference habitats associated with generations living in those regions. They are game-scale habitat estimates, not fixed individual thermal limits or a claim that the labels are discrete biological races. A person's ancestry mix is separate from their current residence; children inherit a canonical mixture from both parents, and new population at a point uses the local category counts and pair frequencies.

## Scale and approximation

Temperature and humidity are game indices from 0 to 100, not Celsius or relative humidity percentages. `geography.ts` derives temperature mainly from latitude (`96 − |latitude| × 1.22`), then adds terrain-scale noise and a small inland reduction. Humidity starts from a latitude curve (wet equator, dry subtropics, wetter temperate belt, drier poles), then changes with inland distance and noise.

The ranges below are broad, rounded envelopes chosen to match those internal scales. They are not direct measurements of human comfort. The range distance is converted to a simple fit score (100 inside the interval, decreasing with distance outside it); a mixed population receives the weighted score from its stored canonical shares only.

| Category | Temperature | Humidity | Habitat used as the broad reference |
| --- | ---: | ---: | --- |
| Европейская | 35–65 | 35–75 | Temperate Europe |
| Негрская | 50–85 | 35–85 | Broad sub-Saharan African environments |
| Пигмейская | 65–95 | 65–100 | Equatorial Central African rainforest |
| Бушменская | 55–90 | 10–45 | Kalahari and adjacent semi-arid southern Africa |
| Эфиопская | 30–70 | 20–65 | Ethiopian/East African highlands and nearby drylands |
| Американоидная | 25–85 | 20–90 | Broad range of the Americas |
| Австралоидная | 45–90 | 10–65 | Australian interior and tropical north |
| Веддоидная | 55–85 | 45–90 | South Asian tropical and monsoon environments |

The broad ranges intentionally overlap. The Americas and Africa are climatically diverse, and the game's two climate axes cannot represent elevation, seasonal extremes, wind, housing, clothing, diet, or individual acclimatization. The intervals are consequently design approximations, not claims of one optimal climate per population.

## Sources

- WorldClim 2.1 global climate normals, used as a regional reference for broad temperature and precipitation/humidity envelopes: https://worldclim.org/data/worldclim21.html
- Köppen–Geiger global climate classification, used as a cross-check for broad tropical, arid, temperate, and highland habitat groupings: https://www.nature.com/articles/sdata201724
- UNESCO tentative-list description of the Central Kalahari, used for the semi-arid southern African reference: https://whc.unesco.org/en/tentativelists/5555/
- Review of human thermal comfort research, used only as context for the general distinction between environmental comfort and the simplified game score: https://link.springer.com/article/10.1186/s40101-022-00302-3

These sources inform the geographic framing; the exact 0–100 endpoints are rounded game parameters selected to fit the current map-generation curves.
