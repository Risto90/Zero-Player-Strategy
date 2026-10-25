---
name: Color metric tolerances
description: Test precision for palette color conversions and contrast metrics.
---
Use numeric tolerances when asserting CIELAB coordinates or ΔE76 computed from the standard rounded sRGB-to-D65 matrix. Pure white can have tiny nonzero a*/b* and L* slightly above 100 due to those constants.

**Why:** exact equality assertions failed for a mathematically neutral endpoint because floating-point matrix constants are rounded.

**How to apply:** use a small tolerance for CIELAB, ΔE76, and WCAG metric tests; keep exact assertions for discrete rules, identifiers, and pass/fail outcomes.
