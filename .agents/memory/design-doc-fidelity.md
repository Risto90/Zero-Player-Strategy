---
name: Design-doc fidelity
description: The user's standing requirement for implementing Zero Strategy mechanics from its design doc.
---
Implement game mechanics only when they are specified in the design doc or explicitly clarified by the user. If a needed quantity or behavior is missing, ask rather than inventing a rule. Never add an interpretation to the design doc as if the user specified it.

Population growth is card-driven through expansion; do not add automatic annual population growth or invent a demographic formula.

For AI action scoring, use direct outcomes from the card's existing rules and its real ink cost. Climate scoring uses canonical population-origin mixes, including city groups. If a card effect has no modeled direct benefit for the civilization (such as drainage comfort), do not invent a global utility weight just to make the AI spend its ink.

**Why:** the user explicitly corrected invented colonization behavior and asked that mechanics follow the design doc strictly.

**How to apply:** before changing game rules or AI priorities, compare the requested behavior with the current design text; flag any missing amount, threshold, or exception and ask a focused question before coding.
