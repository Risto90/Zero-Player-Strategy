import assert from 'node:assert/strict';
import {
  parseFlagSpec,
  serializeFlagSpec,
  validateFlagSpec,
} from '../game/flagSpec.js';

const frame = (ground, layers = []) => ({
  x0: 0,
  y0: 0,
  w: 1,
  h: 1,
  clip: [],
  ground,
  layers,
});

const layer = (id, role = 'ordinary') => ({
  id,
  role,
  shape: { type: 'polygon', points: [{ u: 0.1, v: 0.2 }, { u: 0.8, v: 0.9 }] },
  transform: { translate: { u: 0.5, v: 0.5 }, rotate: 0, scale: 1 },
  fill: 's2',
  clip: ['flag-outline'],
  tags: ['hand-authored'],
  cost: 1,
});

function makeSpec() {
  return {
    generator_version: '0.1.0',
    seed: 'handmade-42',
    profile_id: 'test-profile',
    second_profile_id: null,
    era: 3,
    tags: ['reference', 'manual'],
    outline: {
      type: 'RECT',
      params: { custom: { notch: false } },
      aspect: 1.5,
      safe_area: { margin: 0.0333333333, custom: ['keep', 7] },
    },
    slots: { items: ['s1', 's2', 's3'], equalities: [['s1', 's3']] },
    palette: {
      s1: { color_id: 'deep-blue', hex: '#102A43' },
      s2: { color_id: 'warm-white', hex: '#F5F0E8' },
    },
    root: frame(
      {
        kind: 'split',
        op: 'PALE',
        params: { p: 0.4, origin: { u: 0.25, v: 0.5 }, custom_parameter: 'retained' },
        children: [
          { kind: 'fill', fill: 's1' },
          {
            kind: 'group',
            layout: { arrangement: 'manual', gap: 0.02 },
            children: [
              { kind: 'fill', fill: { pattern: { id: 'dots', spacing: 0.12, slot: 's3' } } },
              { kind: 'repeat', pattern: { count: 3, rotation: 'radial' }, child: { kind: 'fill', fill: 's2' } },
              { kind: 'mirror', axis: 'x', child: { kind: 'fill', fill: 's1' } },
              { kind: 'counterchange', boundary: { op: 'BEND', point: { u: 0.5, v: 0.5 } }, child: { kind: 'fill', fill: 's2' } },
              {
                kind: 'layer',
                layer: layer('central-charge', 'charge'),
                frame: frame(
                  {
                    kind: 'layer',
                    layer: { ...layer('inner-detail'), fill: { pattern: { id: 'stripes', colors: ['s1', 's2'] } } },
                  },
                  [],
                ),
              },
            ],
          },
        ],
      },
      [ { kind: 'layer', layer: layer('border', 'border') } ],
    ),
    meta: {
      complexity: 4,
      symmetry: { type: 'mirror', axis: 'vertical' },
      color_count: 2,
      structure_hash: 'structure-abc',
      visual_hash: 'visual-def',
    },
    future_metadata: { schema_extension: ['not', 'discarded'], enabled: true },
  };
}

const spec = makeSpec();
assert.deepEqual(validateFlagSpec(spec), [], 'a full hand-authored spec should validate');
const canonical = serializeFlagSpec(spec);
const parsed = parseFlagSpec(canonical);
assert.deepEqual(parsed, spec, 'parse/serialize must preserve every modeled and extension field');
assert.equal(serializeFlagSpec(parsed), canonical, 'canonical text must be stable after a round-trip');

const keyOrderVariant = JSON.parse(JSON.stringify(spec));
const reverseKeys = (value) => {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).reverse().map((key) => [key, reverseKeys(value[key])]));
};
assert.equal(
  serializeFlagSpec(reverseKeys(keyOrderVariant)),
  canonical,
  'object key insertion order must not affect canonical serialization',
);

const tooDeep = makeSpec();
tooDeep.root.layers = [{
  kind: 'layer',
  layer: layer('frame-2'),
  frame: frame({
    kind: 'layer',
    layer: layer('frame-3'),
    frame: frame({
      kind: 'layer',
      layer: layer('frame-4'),
        frame: frame({ kind: 'fill', fill: 's1' }),
    }),
  }),
}];
assert.ok(validateFlagSpec(tooDeep).some((issue) => issue.message.includes('depth 3')));

const outOfRangeCoordinate = makeSpec();
outOfRangeCoordinate.root.ground.params.origin.u = 1.01;
assert.ok(validateFlagSpec(outOfRangeCoordinate).some((issue) => issue.path.endsWith('.origin.u')));

const outOfRangeBoundary = makeSpec();
outOfRangeBoundary.root.ground.children[1].children[3].boundary.point.v = -0.01;
assert.ok(validateFlagSpec(outOfRangeBoundary).some((issue) => issue.path.endsWith('.boundary.point.v')));

const invalidEquality = makeSpec();
invalidEquality.slots.equalities = [['s1', 's9']];
assert.ok(validateFlagSpec(invalidEquality).some((issue) => issue.message.includes('unknown color slot "s9"')));

const invalidExtent = makeSpec();
invalidExtent.root.x0 = 0.2;
invalidExtent.root.w = 0.9;
assert.ok(validateFlagSpec(invalidExtent).some((issue) => issue.message.includes('horizontal bounds')));

assert.throws(() => parseFlagSpec('{"generator_version":'), SyntaxError);
assert.throws(() => serializeFlagSpec({ ...spec, era: 7 }), /era/);

console.log('FlagSpec validation and canonical serialization checks passed.');
