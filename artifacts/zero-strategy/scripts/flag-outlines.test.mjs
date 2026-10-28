import assert from 'node:assert/strict';
import {
  buildFlagOutline,
  getOutlineAspectOptions,
  getConfiguredOutlineWeights,
  insetPolygon,
  outlinePath,
} from '../game/flagOutlines.js';
import { FLAG_OUTLINE_CONFIG } from '../game/flagOutlineConfig.js';

const contains = (polygon, point) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

const rect = buildFlagOutline({ type: 'RECT', aspect: 1.5 });
assert.equal(rect.width, 1800);
assert.equal(rect.height, 1200);
assert.deepEqual(rect.boundary, [{ x: 0, y: 0 }, { x: 1800, y: 0 }, { x: 1800, y: 1200 }, { x: 0, y: 1200 }]);
assert.ok(rect.safe_area.every(({ x, y }) => x >= 40 && x <= 1760 && y >= 40 && y <= 1160));
assert.throws(() => buildFlagOutline({ type: 'RECT', aspect: 1.21 }), /configured values/);
for (const aspect of getOutlineAspectOptions('RECT')) {
  const candidate = buildFlagOutline({ type: 'RECT', aspect });
  assert.equal(candidate.width, Math.round(1200 * aspect));
  assert.ok(candidate.boundary.every(({ x, y }) => x >= 0 && x <= candidate.width && y >= 0 && y <= 1200));
  assert.ok(candidate.safe_area.every((p) => contains(candidate.boundary, p)));
}

const vNotch = buildFlagOutline({ type: 'SWALLOW', aspect: 1.4, params: { depth: 168 } });
assert.deepEqual(vNotch.cutouts[0], [{ x: 1680, y: 0 }, { x: 1512, y: 600 }, { x: 1680, y: 1200 }]);
assert.ok(!contains(vNotch.boundary, { x: 1670, y: 600 }));
assert.ok(contains(vNotch.safe_area, { x: 1440, y: 600 }));
assert.ok(!contains(vNotch.safe_area, { x: 1640, y: 600 }));
assert.ok(vNotch.safe_area.every((p) => contains(vNotch.boundary, p)));
const doubleNotch = buildFlagOutline({
  type: 'SWALLOW', aspect: 2.4, params: { depth: 0.1 * 2880, notchCount: 2, notchShape: 'U' },
});
assert.equal(doubleNotch.cutouts.length, 2);
assert.ok(doubleNotch.cutouts.every((cutout) => cutout.length > 3));
assert.ok(doubleNotch.cutouts[0].some((p) => p.x < 2880 && Math.abs(p.y - 400) < 20));
assert.ok(doubleNotch.safe_area.every((p) => contains(doubleNotch.boundary, p)));
const swallowMaximumDepth = buildFlagOutline({
  type: 'SWALLOW', aspect: 1.4, params: { depth: 0.33 * 1680, notchCount: 2, notchShape: 'V' },
});
assert.equal(swallowMaximumDepth.cutouts[1][1].x, 1680 - 0.33 * 1680);
assert.throws(() => buildFlagOutline({ type: 'SWALLOW', aspect: 1.4, params: { depth: 0.34 * 1680 } }), /SWALLOW depth/);

const pennant = buildFlagOutline({ type: 'PENNANT', aspect: 5, params: { thickness: 0 } });
assert.deepEqual(pennant.boundary, [{ x: 0, y: 0 }, { x: 6000, y: 600 }, { x: 0, y: 1200 }]);
assert.ok(pennant.safe_area.every((p) => contains(pennant.boundary, p)));
const thickPennant = buildFlagOutline({ type: 'PENNANT', aspect: 1.5, params: { thickness: 120 } });
assert.equal(thickPennant.boundary[1].y, 540);
assert.equal(thickPennant.boundary[2].y, 660);
assert.ok(thickPennant.safe_area.every((p) => contains(thickPennant.boundary, p)));
const doublePennant = buildFlagOutline({
  type: 'DOUBLE_PENNANT', aspect: 0.7, params: { waistY: 0.42, outerPointX: 0.55, innerPointX: 0.5 },
});
assert.equal(doublePennant.boundary[1].x, 0.55 * doublePennant.width);
assert.ok(doublePennant.boundary[2].x < doublePennant.boundary[1].x, 'the configured point ranges preserve xn < w1');
assert.ok(doublePennant.safe_area.every((p) => contains(doublePennant.boundary, p)));
const doublePennantMaxAspect = buildFlagOutline({ type: 'DOUBLE_PENNANT', aspect: 1.3, params: { waistY: 0.58, outerPointX: 0.9, innerPointX: 0.25 } });
assert.equal(doublePennantMaxAspect.aspect, 1.3);
assert.ok(doublePennantMaxAspect.boundary[2].x < doublePennantMaxAspect.boundary[1].x);

const bannerAspects = FLAG_OUTLINE_CONFIG.types.BANNER.aspects;
for (const aspect of bannerAspects) {
  const banner = buildFlagOutline({ type: 'BANNER', aspect });
  assert.equal(banner.width, Math.round(1200 * aspect));
  assert.ok(banner.boundary.every(({ x, y }) => x >= 0 && x <= banner.width && y >= 0 && y <= 1200));
  assert.ok(banner.safe_area.every((p) => contains(banner.boundary, p)));
}
for (const params of [
  { lowerEdge: 'STRAIGHT' },
  { lowerEdge: 'POINT', lowerDepth: 60 },
  { lowerEdge: 'SWALLOW', lowerDepth: 60 },
  { lowerEdge: 'TEETH', lowerCount: 6, lowerDepthFactor: 0.35 },
  { lowerEdge: 'SCALLOP', lowerCount: 6 },
  { lowerEdge: 'TABS', lowerCount: 7, tabHeight: 144, tabShape: 'TRIANGLE' },
]) {
  const banner = buildFlagOutline({ type: 'BANNER', aspect: 0.2, params });
  assert.ok(banner.boundary.length >= 4, `${params.lowerEdge} should have a complete boundary`);
  assert.ok(banner.safe_area.length >= 3, `${params.lowerEdge} should retain a safe area`);
  assert.ok(banner.safe_area.every((p) => contains(banner.boundary, p)), `${params.lowerEdge} safe area stays inside the outline`);
}
const bannerMaximumTeeth = buildFlagOutline({
  type: 'BANNER',
  aspect: 0.75,
  params: { lowerEdge: 'TEETH', lowerCount: 6, lowerDepthFactor: 0.35 },
});
assert.ok(bannerMaximumTeeth.boundary.some(({ y }) => y === 1200));
assert.throws(() => buildFlagOutline({
  type: 'BANNER', aspect: 0.75, params: { lowerEdge: 'TEETH', lowerCount: 7 },
}), /BANNER teeth count/);

const edge = buildFlagOutline({
  type: 'RECT',
  aspect: 1,
  params: { edge: { count: 21, depth: 48, shape: 'TRIANGLE' } },
});
assert.equal(edge.edge.effectiveCount, 21);
assert.ok(edge.boundary.length > 4);
assert.ok(edge.boundary.every(({ x }) => x <= edge.width));
const roundEdge = buildFlagOutline({
  type: 'RECT',
  aspect: 1,
  params: { edge: { count: 7, depth: 18, shape: 'ROUND' } },
});
assert.equal(roundEdge.edge.effectiveCount, 7);
assert.ok(roundEdge.boundary.length > edge.boundary.length);
assert.throws(() => buildFlagOutline({
  type: 'RECT', aspect: 1, params: { edge: { count: 7, depth: 49, shape: 'ROUND' } },
}), /EDGE depth/);
const narrowEdge = buildFlagOutline({
  type: 'RECT',
  aspect: 1,
  params: { edge: { count: 21, depth: 20, shape: 'ROUND' } },
}, { ...FLAG_OUTLINE_CONFIG, height: 120, safeMargin: 4, minimumDetailThickness: 30, curveTolerance: 0.06 });
assert.ok(narrowEdge.edge.effectiveCount < 21, 'tooth count decreases if width would fall below T_MIN');

const fractional = [{ x: 0, y: 0 }, { x: 1.23456, y: 0 }, { x: 1.23456, y: 1 }, { x: 0, y: 1 }];
assert.equal(fractional[1].x, 1.23456, 'geometry coordinates are not rounded in storage');
assert.match(outlinePath(fractional), /1\.235/u, 'rounding happens only at SVG path output');
assert.deepEqual(insetPolygon([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], 10), [
  { x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 },
]);
assert.deepEqual(getConfiguredOutlineWeights({ RECT: 2, SWALLOW: 0, PENNANT: 1, DOUBLE_PENNANT: 3, BANNER: 4 }).map(({ type }) => type), [
  'RECT', 'SWALLOW', 'PENNANT', 'DOUBLE_PENNANT', 'BANNER',
]);
assert.throws(() => getConfiguredOutlineWeights({ RECT: 1 }), /profile weight for SWALLOW/);
const weightedConfig = {
  ...FLAG_OUTLINE_CONFIG,
  types: {
    ...FLAG_OUTLINE_CONFIG.types,
    RECT: { ...FLAG_OUTLINE_CONFIG.types.RECT, weight: 2 },
    SWALLOW: { ...FLAG_OUTLINE_CONFIG.types.SWALLOW, weight: 1 },
    PENNANT: { ...FLAG_OUTLINE_CONFIG.types.PENNANT, weight: 0 },
    DOUBLE_PENNANT: { ...FLAG_OUTLINE_CONFIG.types.DOUBLE_PENNANT, weight: 3 },
    BANNER: { ...FLAG_OUTLINE_CONFIG.types.BANNER, weight: 4 },
  },
};
assert.equal(getConfiguredOutlineWeights({}, weightedConfig)[0].weight, 2);

console.log('Flag outline geometry, safe areas, ranges, edge modifiers, and profile weights passed.');
