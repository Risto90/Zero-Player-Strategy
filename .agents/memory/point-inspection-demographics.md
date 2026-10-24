---
name: Point inspection demographics
description: Keep map point inspection separate from city and country profile demographics.
---
Map point inspection uses the selected tile's population layer and its culture and religion raster mixes, including the non-believer remainder. A city or country at the point remains a name link; do not substitute that object's total population or composition.

**Why:** city groups are modeled separately from the local raster mix, and showing them in point inspection would misrepresent the selected map cell.

**How to apply:** when changing `InspectCard` or `Game.inspect`, preserve the point-level values and hide demographics for sea, unclaimed land, and points without population.
