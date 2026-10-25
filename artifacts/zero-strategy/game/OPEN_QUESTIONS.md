# Open questions

## Flag outlines (§6)

- For a `U` swallow notch, the specification gives a minimum arc radius but not a separate radius choice or notch opening width. The current builder derives one circular arc from the configured notch depth and section span; confirm whether profiles should be able to choose the radius independently.
- The `EDGE` modifier is allowed on `SWALLOW` and `BANNER`, including when their base outline already has notches or a non-straight lower edge. The current builder distributes the edge pattern over that free-edge polyline; confirm whether it should decorate only the uninterrupted outermost segments instead.
- “Contour compressed by M_SAFE” does not specify join behavior at concave corners. Safe areas start with inward parallel offsets and mitered intersections; concave spikes are conservatively pulled inward until the resulting boundary is contained and at least M_SAFE from the contour.
