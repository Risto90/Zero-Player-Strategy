# Open questions

## Flag outlines (§6)

- For a `U` swallow notch, the specification gives a minimum arc radius but not a separate radius choice or notch opening width. The current builder derives one circular arc from the configured notch depth and section span; confirm whether profiles should be able to choose the radius independently.
- The `EDGE` modifier is allowed on `SWALLOW` and `BANNER`, including when their base outline already has notches or a non-straight lower edge. The current builder distributes the edge pattern over that free-edge polyline; confirm whether it should decorate only the uninterrupted outermost segments instead.
- “Contour compressed by M_SAFE” does not specify join behavior at concave corners. Safe areas start with inward parallel offsets and mitered intersections; concave spikes are conservatively pulled inward until the resulting boundary is contained and at least M_SAFE from the contour.

## Flag field operators (§7)

- The brief names G04 CHEVRON's vertex and slope but does not define which frame edges its two arms meet. The field builder uses configurable arms that reach the left/right edges.
- G07 gives two sets of three angles without an orientation. The default uses a configurable start angle of −90° and proceeds clockwise in screen coordinates.
- G10's “lozenge angle” does not clarify whether it means cell rotation or interior angle. The builder treats it as a configurable rotation for a square grid; its starting rotation is 60°.
- G11 says “nested chevrons from a vertex” and equal thickness but omits the path construction. The builder uses configurable, parallel V-shaped bands and amplitude; its default amplitude is 0.12 of the frame height.
- WG-comp does not specify the random distribution over valid compositions. A deterministic caller-provided random source selects among valid totals/parts; no global random source is used.
- WG-accent gives a range for the separator but no selection rule. It defaults to the midpoint of H/12..H/6 and splits the remaining width equally between the two broad bands.
- G08/G09 allow more geometric cells than the global 16-region limit. The builder treats repeated same-slot cells as one logical region made of multiple polygons; confirm whether the limit should count cells instead.
- G09 says the center origin but not whether the grid line or a cell center should sit at frame center. The current grid uses intersecting grid lines through the frame center.
