---
name: Nomad cohort conservation
description: Preserve population and religious composition exactly when a dissolved country is partitioned into nomadic groups.
---
When converting a country's population into nomad groups, each culture/religion/atheist cohort must retain its original absolute population. If a religious subgroup is isolated while atheists are attached to it, compute religion shares relative to that resulting nomad cell and avoid the general 5-point share quantization, which can change cohort totals.

**Why:** the documented dissolution rules preserve population and faith composition; subgroup sizes and atheist attachment can create percentages that are not multiples of the normal share step.

**How to apply:** when partitioning cohorts before storing nomad cells, derive exact religious shares from cohort populations and add regression assertions for total population, every religion, and atheists.
