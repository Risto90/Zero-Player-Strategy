---
name: Flag novelty benchmarks
description: Keep manual flag references separate from empirical generation metrics.
---

Never count a hand-authored FlagSpec reference corpus as a seeded-generator benchmark. If generation statistics are absent, report attempts and fallback as unknown; do not substitute zero or one. The 100,000-seed §16.6 measurement requires the actual generator stages and validation results.

**Why:** Reference flags measure representation and historical pattern coverage, not the behavior of a generator across seeds. Treating them as generated samples would silently change the acceptance criteria.

**How to apply:** Use real generated flags with their per-flag attempt and fallback metadata when evaluating novelty targets. If the concrete generator is not available, document the target as unmeasured.
