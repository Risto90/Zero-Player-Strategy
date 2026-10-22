---
name: Zero Strategy simulation balance
description: Why split/faith card weights are low and how to sanity-check the autonomous simulation
---
Splits and new faiths are deliberately rare (low weights in the country/world card tables), and extinct cultures/religions are pruned each year.
**Why:** there is no merging or conquest yet, so any split rate only accumulates; with higher weights a 12x20 map shattered into ~60 one-cell states and ~1000 religions within 120 years.
**How to apply:** when adding unification/conquest cards, splits can be raised again. Check balance by bundling the engine with esbuild (alias `@/constants/colors`) and running 150 simulated years in Node, counting countries/cultures/religions.
