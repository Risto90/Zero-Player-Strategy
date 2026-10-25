import assert from 'node:assert/strict';
import { FLAG_REFERENCE_CORPUS } from '../game/flagReferences.ts';
import { renderFlagSpec } from '../game/flagRenderer.ts';
import { parseFlagSpec, serializeFlagSpec } from '../game/flagSpec.ts';

const allowedTags = new Set(['svg', 'defs', 'clipPath', 'g', 'rect', 'circle', 'polygon', 'path', 'use']);
const allowedAttributes = new Set([
  'xmlns', 'viewBox', 'id', 'fill', 'fill-rule', 'clip-path', 'd', 'points',
  'cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'href', 'transform',
]);
const inspectSvg = (svg) => {
  assert.ok(svg.startsWith('<svg '), 'SVG root is present');
  assert.ok(svg.includes('<defs>') && svg.includes('clip-outline'), 'outline clip is defined before the painted root');
  assert.ok(!/<(?:metadata|text|image|linearGradient|radialGradient|filter)\b/i.test(svg), 'default output has no metadata or forbidden SVG elements');
  assert.ok(!/\b(?:stroke|style|filter|onload)\s*=/.test(svg), 'no stroke, style, filter, or event attributes');
  assert.ok((svg.match(/\bfill="#[^"]+"/g) ?? []).every((fill) => fill === fill.toLowerCase()), 'all emitted hex fills are lowercase');
  for (const [, tag, attributes] of svg.matchAll(/<([A-Za-z][\w]*)\b([^>]*)>/g)) {
    assert.ok(allowedTags.has(tag), `allowed SVG tag: ${tag}`);
    for (const [, attr] of attributes.matchAll(/([\w:-]+)\s*=/g)) {
      assert.ok(allowedAttributes.has(attr), `allowed SVG attribute: ${attr}`);
    }
  }
  for (const number of svg.match(/(?<![A-Za-z])[-+]?(?:\d*\.)?\d+/g) ?? []) {
    assert.ok(!/\.\d{2,}/.test(number), `at most one decimal place: ${number}`);
  }
  assert.ok(new TextEncoder().encode(svg).length <= 30 * 1024, 'SVG stays within the §15 30 KB limit');
};

const reverseObjectKeyOrder = (value) => {
  if (Array.isArray(value)) return value.map(reverseObjectKeyOrder);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseObjectKeyOrder(item)]));
  }
  return value;
};

for (const { id, spec } of FLAG_REFERENCE_CORPUS) {
  const svg = renderFlagSpec(spec);
  assert.equal(svg, renderFlagSpec(parseFlagSpec(serializeFlagSpec(spec))), `${id} render survives canonical round-trip`);
  assert.equal(svg, renderFlagSpec(reverseObjectKeyOrder(spec)), `${id} output ignores object key insertion order`);
  inspectSvg(svg);
}

const source = FLAG_REFERENCE_CORPUS.find(({ id }) => id === 'japan').spec;
const clone = () => structuredClone(source);

const notch = clone();
notch.outline = { ...notch.outline, type: 'SWALLOW', aspect: 1.5, params: { depth: 180, notchCount: 1, notchShape: 'V' } };
const notchSvg = renderFlagSpec(notch);
assert.ok(notchSvg.includes('fill-rule="evenodd"'), 'outline notch is represented as an even-odd cutout');
inspectSvg(notchSvg);

const canton = clone();
canton.root.layers = [{
  kind: 'layer',
  layer: {
    id: 'canton-box',
    role: 'canton',
    shape: { type: 'rectangle', x: 0, y: 0, w: 0.5, h: 0.5 },
    transform: {},
    fill: 's2',
    clip: ['flag-outline'],
    tags: ['canton'],
    cost: 1,
  },
  frame: {
    x0: 0, y0: 0, w: 0.5, h: 0.5, clip: [],
    ground: { kind: 'split', op: 'G02', params: { axis: 'H', n: 2, weights: { kind: 'equal' }, slots: ['s1', 's2'] },
      children: [{ kind: 'fill', fill: 's1' }, { kind: 'fill', fill: 's2' }] },
    layers: [],
  },
}];
const cantonSvg = renderFlagSpec(canton);
assert.ok(cantonSvg.includes('canton'), 'canton layer is present');
assert.ok(cantonSvg.includes('clipPath'), 'nested frame has an explicit clip');
inspectSvg(cantonSvg);

const counterchanged = clone();
counterchanged.root.ground = {
  kind: 'counterchange',
  boundary: { type: 'line', u: 0.5 },
  child: { kind: 'fill', fill: 's2' },
  copies: [
    { region_id: 'left', clip: { region: 'left' }, slot_map: { s2: 's2' },
      child: { kind: 'layer', layer: { id: 'left-charge', role: 'charge',
        shape: { type: 'circle', cx: 0.5, cy: 0.5, radius: 0.18 }, transform: {}, fill: 's2', clip: [], tags: [], cost: 1 } } },
    { region_id: 'right', clip: { region: 'right' }, slot_map: { s2: 's1' },
      child: { kind: 'layer', layer: { id: 'right-charge', role: 'charge',
        shape: { type: 'circle', cx: 0.5, cy: 0.5, radius: 0.18 }, transform: {}, fill: 's2', clip: [], tags: [], cost: 1 } } },
  ],
};
const counterchangeSvg = renderFlagSpec(counterchanged);
assert.ok((counterchangeSvg.match(/clipPath id=/g) ?? []).length >= 3, 'counterchange copies have independent region clips');
assert.ok(counterchangeSvg.includes('fill="#ffffff"') && counterchangeSvg.includes('fill="#ce1126"'), 'counterchange slot remapping changes the copy fill');
inspectSvg(counterchangeSvg);

const repeated = clone();
repeated.root.layers = [{
  kind: 'repeat',
  pattern: { kind: 'RING', count: 8, radius: 0.32, rotation: 'radial' },
  child: { kind: 'layer', layer: {
    id: 'repeated-star',
    role: 'charge',
    shape: { type: 'star', module: 'STAR', cx: 0.5, cy: 0.5, radius: 0.06, points_count: 5, inner_ratio: 0.45 },
    transform: {},
    fill: 's2',
    clip: ['flag-outline'],
    tags: ['repeat'],
    cost: 1,
  } },
}];
const repeatSvg = renderFlagSpec(repeated);
assert.equal((repeatSvg.match(/<use href=/g) ?? []).length, 8, 'repeat emits one local use for each placement');
assert.ok(repeatSvg.includes('repeat-source'), 'repeated emblem geometry is shared in defs');
inspectSvg(repeatSvg);

const transformed = clone();
transformed.root.layers = [{
  kind: 'layer',
  layer: {
    id: 'diagonal-band',
    role: 'ordinary',
    shape: { type: 'O03', params: { axis: 'DIAGONAL', thickness: 140 } },
    transform: { translate: { u: 0.05, v: 0 }, rotate: 15, scale: 0.9 },
    fill: 's2',
    clip: ['flag-outline'],
    tags: ['ordinary'],
    cost: 1,
  },
}];
const transformedSvg = renderFlagSpec(transformed);
assert.ok(transformedSvg.includes('rotate(15'), 'layer transform is retained by the renderer');
for (const [, points] of transformedSvg.matchAll(/\bpoints="([^"]+)"/g)) {
  for (const coordinate of points.trim().split(/[ ,]+/).map(Number)) {
    assert.ok(coordinate >= -120 && coordinate <= 1920, `polygon coordinate stays within the allowed flag bounds: ${coordinate}`);
  }
}
inspectSvg(transformedSvg);

const ring = clone();
ring.root.layers = [{
  kind: 'layer',
  layer: {
    id: 'ring',
    role: 'charge',
    shape: { type: 'ring', cx: 0.5, cy: 0.5, outerRadius: 0.24 },
    transform: {},
    fill: 's2',
    clip: ['flag-outline'],
    tags: ['ring'],
    cost: 1,
  },
}];
const ringSvg = renderFlagSpec(ring);
assert.ok(ringSvg.includes('fill-rule="evenodd"'), 'ring cutout uses even-odd fill');
inspectSvg(ringSvg);

console.log(`Flag SVG renderer checks passed for ${FLAG_REFERENCE_CORPUS.length} references and complex compositions.`);
