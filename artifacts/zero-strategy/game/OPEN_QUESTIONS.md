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

## Flag ordinaries (§9)

- O07 does not specify CHECKY cell dimensions or phase. Cell size is configurable (default H/8); cells alternate from the frame's hoist/top edges, and the configured line style shapes the inner edge.
- O03, O04, and O05 specify thickness but not a numeric interval. Their bounds are configurable and currently use H/12..H/4 with a default of H/8.
- O01/O09 and other ordinary layers have no stated cost values or maximum-cost budget. Costs and a conservative cap are configurable defaults; tune them with the later generator/profile work.
- O05 does not specify the Y-junction angles or which arm points toward the hoist. The geometry accepts explicit arm angles and defaults to a symmetric upward-opening Y.
- O09 PINWHEEL does not define the half-plane split axis. The configurable implementation uses the vertical midpoint of the canton frame.

## Flag emblem library (§10)

- The specification does not define an emblem cost formula or starter values. The catalog currently uses a neutral configurable cost of `1` per module and composer (`0` for `SINGLE`); confirm the intended cost model before costs affect selection.
- Several named sub-shapes lack exact dimensions or construction details (including sun ray variants, lily petal joins, ship hull curvature, and anchor details). The implementation uses simple polygonal approximations; provide exact geometry if silhouettes must match references.
- `GLYPH` does not state whether an edge can span non-adjacent grid nodes or define quarter-arc control points. The initial builder uses adjacent grid edges and circular quarter arcs; confirm whether longer edges or other arc construction are needed.
- The minimum physical glyph stroke depends on final placement size, which is outside this task. The emblem builder exposes the required scale and checks the configured final scale; placement must pass its actual scale to validation.
- `INSCRIBE` and `CONCENTRIC` do not fully define child ordering, frame outlines, or ring count. The implementation treats INSCRIBE's child as contents and CONCENTRIC's first child as inner emblem and second as outer base; defaults are configurable.
- `PAIR_MIRROR`, `RING`, `ARC_REPEAT`, `CHARGE_ON_CHARGE`, and `CONCENTRIC` omit some parameter bounds or dimensions. Configurable starter bounds/defaults are supplied for safe construction; confirm the intended ranges and proportions before those values drive generation.
