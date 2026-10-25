import assert from 'node:assert/strict';
import {
  applyFlagSymmetry,
  buildCounterchangeNode,
  chooseFlagSymmetry,
  createRepeatNode,
  expandFlagRepeat,
  expandSymmetricPlacements,
  isValidChargePlacement,
  resolveChargePlacement,
  resolveFlagRepeatPlacements,
  snapChargeParameter,
  supportsFlagSymmetry,
} from '../game/flagPlacement.js';
import { FLAG_PLACEMENT_CONFIG } from '../game/flagPlacementConfig.js';

const seeded = (value) => () => value;
const safe = { minU: 0.05, minV: 0.05, maxU: 0.95, maxV: 0.95 };
const frame = { w: 1, h: 1 };
const fill = { kind: 'fill', fill: 's2' };
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-12, message);

assert.equal(Object.keys(FLAG_PLACEMENT_CONFIG.repeaters.constellations).length, 8, 'all requested constellation presets are configured');
for (const [preset, count] of Object.entries({
  STAR_TRIANGLE: 3, SOUTHERN_CROSS: 4, FIVE_STAR: 5, SEVEN_STAR_DIPPER: 7,
  CIRCLE_12: 12, THREE_BELT: 3, FIVE_CROSS: 5, HEXAGONAL_7: 7,
})) {
  assert.equal(expandFlagRepeat('CONSTELLATION', { constellation: preset }).length, count, `${preset} has the requested number of charges`);
}
near(snapChargeParameter(0.2, frame, seeded(0.1)), 0.20833333333333334, 'preferred SNAP grid is H/24');
near(snapChargeParameter(0.2, frame, seeded(0.9)), 0.2, 'fine SNAP grid is H/60');

const center = resolveChargePlacement({ anchor: 'A1', frame, safeArea: safe, size: 0.2, rng: seeded(0.1) });
assert.equal(center.u, 0.5);
assert.equal(center.v, 0.5);
assert.ok(isValidChargePlacement(center, frame, safe), 'center charge fits safe area');
const outlineFrame = { w: 2, h: 1 };
const outlineSafeArea = [
  { x: 40, y: 40 }, { x: 2360, y: 40 }, { x: 2360, y: 1160 }, { x: 40, y: 1160 },
];
assert.ok(isValidChargePlacement(
  { ...center, u: 0.5, v: 0.5 },
  outlineFrame,
  outlineSafeArea,
), 'placement accepts safe-area coordinates from the outline geometry');
assert.equal(resolveChargePlacement({ anchor: 'A2', frame, safeArea: safe, size: 0.2, rng: seeded(0.1) }).u, 0.325);
const ordinaryAnchor = resolveChargePlacement({ anchor: 'A3', frame, safeArea: safe, size: 0.2, references: { ordinaryCenter: { u: 0.3, v: 0.4 } }, rng: seeded(0.1) });
assert.deepEqual([ordinaryAnchor.u, ordinaryAnchor.v, ordinaryAnchor.rotation, ordinaryAnchor.mirror], [0.3, 0.4, 0, false]);
near(ordinaryAnchor.size, 0.20833333333333334, 'A3 size is snapped');
const cantonAnchor = resolveChargePlacement({ anchor: 'A4', frame, safeArea: safe, size: 0.2, references: { cantonCenter: { u: 0.7, v: 0.2 } }, rng: seeded(0.1) });
assert.deepEqual([cantonAnchor.u, cantonAnchor.v, cantonAnchor.rotation, cantonAnchor.mirror], [0.7, 0.2, 0, false]);
near(cantonAnchor.size, 0.20833333333333334, 'A4 size is snapped');
assert.deepEqual(
  resolveChargePlacement({ anchor: 'A5', frame, safeArea: safe, size: 0.2, references: { quarter: 3 }, rng: seeded(0.1) }).u,
  0.75,
);
assert.equal(
  resolveChargePlacement({ anchor: 'A6', frame, safeArea: safe, size: 0.2, references: { bandCenter: { u: 0.5, v: 0.25 } }, rng: seeded(0.1) }).v,
  0.25,
);
assert.equal(
  resolveChargePlacement({
    anchor: 'A7', frame, safeArea: safe, size: 0.2,
    references: { isCounterchange: true, boundaryCenter: { u: 0.5, v: 0.5 } }, rng: seeded(0.1),
  }).u,
  0.5,
);
assert.throws(
  () => resolveChargePlacement({ anchor: 'A7', frame, safeArea: safe, size: 0.2, references: { boundaryCenter: { u: 0.5, v: 0.5 } }, rng: seeded(0.1) }),
  /only valid at a counterchanged/,
);
const edge = resolveChargePlacement({
  anchor: 'A8', frame, safeArea: { minU: 0, minV: 0, maxU: 1, maxV: 1 }, size: 0.12,
  references: { edge: 'HOIST' }, rng: seeded(0.1),
});
assert.ok(edge.u > 0.09, 'A8 includes both the 40-unit margin and charge radius');
const pile = [{ u: 0.2, v: 0.2 }, { u: 0.8, v: 0.2 }, { u: 0.8, v: 0.8 }, { u: 0.2, v: 0.8 }];
assert.deepEqual(
  resolveChargePlacement({ anchor: 'A9', frame, safeArea: safe, size: 0.2, references: { pileInterior: pile }, rng: seeded(0.1) }).u,
  0.5,
);
const free = resolveChargePlacement({
  anchor: 'A10', frame, safeArea: safe, size: 0.12,
  references: { candidates: [{ u: 0.05, v: 0.5 }, { u: 0.25, v: 0.25 }] },
  existing: [{ u: 0.75, v: 0.75, size: 0.2, rotation: 0, mirror: false }],
  rng: seeded(0.1),
});
assert.deepEqual([free.u, free.v], [0.25, 0.25], 'A10 skips a candidate too close to the safe-area edge');
assert.throws(
  () => resolveChargePlacement({ anchor: 'A1', frame, safeArea: safe, size: 0.2, existing: [center], rng: seeded(0.1) }),
  /minimum gaps/,
);
assert.throws(() => resolveChargePlacement({ anchor: 'A1', frame, safeArea: safe, size: 0.2 }), /injected seeded random source/);

assert.equal(expandFlagRepeat('GRID', { rows: 2, cols: 3 }).length, 6);
assert.equal(expandFlagRepeat('GRID', { rows: 2, cols: 3, stagger: 'HALF_OFFSET' }).length, 6);
assert.equal(expandFlagRepeat('GRID', { rows: 2, cols: 3, stagger: 'ALTERNATING_6_5' }).length, 11);
assert.equal(expandFlagRepeat('RING', { count: 12 }).length, 12);
assert.equal(expandFlagRepeat('ARC', { count: 5, sweep: 180 }).length, 5);
assert.equal(expandFlagRepeat('LINE', { count: 4, axis: 'VERTICAL' }).length, 4);
assert.equal(expandFlagRepeat('CONSTELLATION', { constellation: 'SEVEN_STAR_DIPPER' }).length, 7);
assert.throws(() => expandFlagRepeat('CONSTELLATION', { constellation: 'not-a-preset' }), /configured preset/);
assert.equal(createRepeatNode(fill, 'LINE', { count: 3 }).kind, 'repeat');
assert.equal(resolveFlagRepeatPlacements({
  kind: 'GRID', rows: 2, cols: 2, stepX: 0.3, stepY: 0.3,
  baseSize: 0.12, frame, safeArea: safe, symmetry: 'MIR_H', rng: seeded(0.1),
}).length, 8, 'repeat placement checks the reflected copies and keeps asymmetric charges paired');
assert.throws(() => resolveFlagRepeatPlacements({
  kind: 'GRID', rows: 1, cols: 3, stepX: 0.12, baseSize: 0.2,
  frame, safeArea: safe, rng: seeded(0.1),
}), /minimum gaps/);
assert.throws(() => resolveFlagRepeatPlacements({
  kind: 'RING', count: 3, radius: 0.5, baseSize: 0.12,
  frame, safeArea: safe, rng: seeded(0.1),
}), /outside safe_area/);

const sample = [{ u: 0.2, v: 0.3, size: 0.15, rotation: 10, mirror: false }];
const horizontal = expandSymmetricPlacements(sample, 'MIR_H');
assert.deepEqual(horizontal.map(({ u, v }) => [u, v]), [[0.2, 0.3], [0.8, 0.3]]);
assert.equal(expandSymmetricPlacements([{ ...sample[0], u: 0.5 }], 'MIR_H').length, 2, 'axis-centered asymmetric charges retain their reflected partner');
assert.equal(expandSymmetricPlacements(sample, 'BOTH').length, 4);
assert.equal(expandSymmetricPlacements(sample, 'ROT180').length, 2);
assert.equal(chooseFlagSymmetry({ MIR_V: 2 }, seeded(0.5)), 'MIR_V');
const mirroredTree = applyFlagSymmetry(fill, 'BOTH');
assert.equal(mirroredTree.kind, 'group');
assert.equal(mirroredTree.children.length, 4);
assert.ok(supportsFlagSymmetry(mirroredTree, 'BOTH'));
assert.ok(FLAG_PLACEMENT_CONFIG.symmetry.operatorSupport.repeat.includes('ROT180'), 'repeater support is explicitly declared in configuration');

const counterchange = buildCounterchangeNode(fill, {
  boundary: { type: 'line', u: 0.5 },
  first: { id: 'left', clip: { polygon: [[0, 0], [0.5, 0], [0.5, 1], [0, 1]] }, backgroundSlot: 's1' },
  second: { id: 'right', clip: { polygon: [[0.5, 0], [1, 0], [1, 1], [0.5, 1]] }, backgroundSlot: 's3' },
  chargeSlot: 's2',
});
assert.equal(counterchange.copies.length, 2);
assert.deepEqual(counterchange.copies.map(({ region_id, slot_map, child }) => [region_id, slot_map, child.fill]), [
  ['left', { s2: 's3' }, 's3'],
  ['right', { s2: 's1' }, 's1'],
]);
assert.notEqual(counterchange.copies[0].clip, counterchange.copies[1].clip, 'each copy retains its own regional clip');

console.log('Flag placement, repeaters, symmetry, and counterchange checks passed.');
