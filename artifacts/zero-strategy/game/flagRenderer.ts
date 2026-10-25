import { buildFlagField, type FlagFieldNode, type FlagFieldFrame, type FlagPolygon, type FlagPolygonSet, type FlagPoint } from './flagField';
import { validateFlagEmblem, type EmblemPrimitive } from './flagEmblems';
import { buildFlagOrdinaryLayers } from './flagOrdinaries';
import { buildFlagOutline, type OutlinePoint } from './flagOutlines';
import { assertValidFlagSpec, type FlagFrame, type FlagLayer, type FlagNode, type FlagSpec } from './flagSpec';

const HEIGHT = 1200;
const NUMBER_PRECISION = 1;
const EPSILON = 1e-9;

interface FrameBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RenderContext {
  frame: FrameBox;
  clips: string[];
  slots: Record<string, string>;
  slotMap: Record<string, string>;
}

interface RenderState {
  width: number;
  defs: string[];
  layers: string[];
  clipIds: Map<string, string>;
  nextClip: number;
  nextLayer: number;
  seed: string;
}

interface RepeatPlacement {
  u: number;
  v: number;
  rotation: number;
  scale: number;
  mirror: boolean;
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function finite(value: unknown, fallback: number, label: string): number {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(result)) throw new TypeError(`${label} must be finite`);
  return result;
}

function number(value: number): string {
  if (!Number.isFinite(value)) throw new TypeError('SVG coordinates must be finite');
  const rounded = Number(value.toFixed(NUMBER_PRECISION));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function pointPath(points: readonly { x: number; y: number }[]): string {
  if (points.length < 3) throw new RangeError('SVG polygon needs at least three points');
  return `M${number(points[0].x)} ${number(points[0].y)}${points.slice(1).map((p) => ` L${number(p.x)} ${number(p.y)}`).join('')} Z`;
}

function colorFor(fill: unknown, context: RenderContext): string {
  if (typeof fill !== 'string') {
    if (fill && typeof fill === 'object' && 'pattern' in fill) {
      throw new TypeError('Pattern fills are not yet representable by the supported solid-fill renderer');
    }
    throw new TypeError('Flag fill must be a color slot or a six-digit HEX color');
  }
  const slot = context.slotMap[fill] ?? fill;
  const color = context.slots[slot] ?? slot;
  if (!/^#[\da-f]{6}$/i.test(color)) throw new TypeError(`Unknown flag color slot or invalid HEX color "${slot}"`);
  return color.toLowerCase();
}

function normalizeFieldParams(op: string, input: Record<string, any>, children: FlagNode[], context: RenderContext): Record<string, unknown> {
  const params: Record<string, unknown> = { ...input };
  if (params.pattern === undefined && params.slot_pattern !== undefined) params.pattern = params.slot_pattern;
  if (params.sp !== undefined && params.pattern === undefined) params.pattern = params.sp;
  if (Array.isArray(params.weights)) {
    params.n ??= params.weights.length;
    params.weights = { kind: 'custom', weights: params.weights };
  }
  if (op === 'G04' && params.p === undefined && params.position !== undefined) params.p = params.position;
  if (op === 'G05' && params.point && typeof params.point === 'object') {
    const splitPoint = record(params.point);
    params.px ??= splitPoint.u;
    params.py ??= splitPoint.v;
  }
  if (op === 'G05' && params.slotsMode === undefined && ['CHECKER', 'AB/CD', 'AB/BB'].includes(String(params.pattern))) {
    params.slotsMode = params.pattern;
  }
  const childSlots = children.map((child) => child.kind === 'fill' && typeof child.fill === 'string'
    ? context.slotMap[child.fill] ?? child.fill
    : undefined);
  const slots = Array.isArray(params.slots) ? params.slots : childSlots.every(Boolean) ? childSlots : Object.keys(context.slots);
  params.slots = slots;
  if (params.pattern === 'DISTINCT' && !Array.isArray(input.slots) && childSlots.every(Boolean)) params.slots = childSlots;
  return params;
}

function addClip(state: RenderState, polygons: FlagPolygonSet): string {
  const clean = clipPolygonsToSvgRange(
    polygons.map((polygon) => polygon.filter(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))),
    state.width,
  );
  if (clean.some((polygon) => polygon.length < 3)) throw new RangeError('Clip polygons need at least three finite vertices');
  const key = clean.map((polygon) => polygon.map(({ x, y }) => `${number(x)},${number(y)}`).join(';')).join('|');
  const cached = state.clipIds.get(key);
  if (cached) return cached;
  const id = `clip-${state.nextClip++}`;
  state.clipIds.set(key, id);
  state.defs.push(`<clipPath id="${id}">${clean.map((polygon) => `<polygon points="${polygon.map(({ x, y }) => `${number(x)},${number(y)}`).join(' ')}"/>`).join('')}</clipPath>`);
  return id;
}

function clippedMarkup(content: string, clipIds: readonly string[]): string {
  return [...clipIds].reverse().reduce((markup, id) => `<g clip-path="url(#${id})">${markup}</g>`, content);
}

function layerId(state: RenderState, role: string, type: string): string {
  const safeRole = role.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'ordinary';
  const safeType = type.toLowerCase().replace(/[^a-z0-9-]+/g, '-') || 'shape';
  return `L${state.nextLayer++}-${safeRole}-${safeType}`;
}

function emitPolygons(
  state: RenderState,
  polygons: FlagPolygonSet,
  fill: unknown,
  role: string,
  type: string,
  context: RenderContext,
): string {
  const color = colorFor(fill, context);
  const shapes = clipPolygonsToSvgRange(polygons, state.width).map((polygon) =>
    `<polygon points="${polygon.map(({ x, y }) => `${number(x)},${number(y)}`).join(' ')}" fill="${color}"/>`).join('');
  if (!shapes) return '';
  const id = layerId(state, role, type);
  return `<g id="${id}">${clippedMarkup(shapes, context.clips)}</g>`;
}

function circlePoints(cx: number, cy: number, radius: number, samples = 96): FlagPolygon {
  return Array.from({ length: samples }, (_, index) => {
    const angle = index * 2 * Math.PI / samples;
    return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });
}

function frameRect(frame: FrameBox): FlagPolygon {
  const { x, y, width, height } = frame;
  return [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
}

function clipPolygonToBounds(polygon: FlagPolygon, width: number): FlagPolygon {
  const bounds = [
    { inside: (p: FlagPoint) => p.x >= -HEIGHT * 0.1, intersect: (a: FlagPoint, b: FlagPoint) => {
      const x = -HEIGHT * 0.1, t = (x - a.x) / (b.x - a.x);
      return { x, y: a.y + (b.y - a.y) * t };
    } },
    { inside: (p: FlagPoint) => p.x <= width + HEIGHT * 0.1, intersect: (a: FlagPoint, b: FlagPoint) => {
      const x = width + HEIGHT * 0.1, t = (x - a.x) / (b.x - a.x);
      return { x, y: a.y + (b.y - a.y) * t };
    } },
    { inside: (p: FlagPoint) => p.y >= -HEIGHT * 0.1, intersect: (a: FlagPoint, b: FlagPoint) => {
      const y = -HEIGHT * 0.1, t = (y - a.y) / (b.y - a.y);
      return { x: a.x + (b.x - a.x) * t, y };
    } },
    { inside: (p: FlagPoint) => p.y <= HEIGHT * 1.1, intersect: (a: FlagPoint, b: FlagPoint) => {
      const y = HEIGHT * 1.1, t = (y - a.y) / (b.y - a.y);
      return { x: a.x + (b.x - a.x) * t, y };
    } },
  ];
  let result = polygon;
  for (const boundary of bounds) {
    if (result.length === 0) break;
    const output: FlagPolygon = [];
    let previous = result[result.length - 1];
    let previousInside = boundary.inside(previous);
    for (const current of result) {
      const currentInside = boundary.inside(current);
      if (currentInside !== previousInside) output.push(boundary.intersect(previous, current));
      if (currentInside) output.push(current);
      previous = current;
      previousInside = currentInside;
    }
    result = output;
  }
  return result;
}

function clipPolygonsToSvgRange(polygons: FlagPolygonSet, width: number): FlagPolygonSet {
  return polygons.map((polygon) => clipPolygonToBounds(polygon, width)).filter((polygon) => polygon.length >= 3);
}

function normalizedPoint(raw: unknown, frame: FrameBox): FlagPoint {
  if (Array.isArray(raw) && raw.length >= 2) {
    const x = Number(raw[0]), y = Number(raw[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('Clip point must be finite');
    return Math.abs(x) <= 1 && Math.abs(y) <= 1
      ? { x: frame.x + x * frame.width, y: frame.y + y * frame.height }
      : { x, y };
  }
  const value = record(raw);
  if (Number.isFinite(value.u) && Number.isFinite(value.v)) {
    return { x: frame.x + value.u * frame.width, y: frame.y + value.v * frame.height };
  }
  if (Number.isFinite(value.x) && Number.isFinite(value.y)) {
    return Math.abs(value.x) <= 1 && Math.abs(value.y) <= 1
      ? { x: frame.x + value.x * frame.width, y: frame.y + value.y * frame.height }
      : { x: value.x, y: value.y };
  }
  throw new TypeError('Clip point must use normalized u/v, normalized x/y, or absolute x/y');
}

function polygonsFromClip(raw: unknown, frame: FrameBox): FlagPolygonSet | undefined {
  if (Array.isArray(raw)) {
    if (raw.length && Array.isArray(raw[0]) && raw[0].length >= 2 && typeof raw[0][0] === 'number') {
      return [raw.map((point) => normalizedPoint(point, frame))];
    }
    if (raw.length && Array.isArray(raw[0])) {
      return raw.map((polygon: unknown[]) => polygon.map((point: unknown) => normalizedPoint(point, frame)));
    }
    return [raw.map((point) => normalizedPoint(point, frame))];
  }
  const value = record(raw);
  if (Array.isArray(value.polygon)) return polygonsFromClip(value.polygon, frame);
  if (Array.isArray(value.points)) return [value.points.map((point) => normalizedPoint(point, frame))];
  if (value.type === 'rect' || value.type === 'rectangle') {
    const x = finite(value.x, 0, 'clip.x'), y = finite(value.y, 0, 'clip.y');
    const width = finite(value.w ?? value.width, 0, 'clip.width');
    const height = finite(value.h ?? value.height, 0, 'clip.height');
    const x0 = frame.x + x * frame.width, y0 = frame.y + y * frame.height;
    return [[{ x: x0, y: y0 }, { x: x0 + width * frame.width, y: y0 },
      { x: x0 + width * frame.width, y: y0 + height * frame.height }, { x: x0, y: y0 + height * frame.height }]];
  }
  return undefined;
}

function counterchangeClip(
  copyClip: unknown,
  copyId: string,
  boundary: unknown,
  frame: FrameBox,
): FlagPolygonSet {
  const explicit = polygonsFromClip(copyClip, frame);
  if (explicit) return explicit;
  const region = String(record(copyClip).region ?? copyId).toLowerCase();
  const params = record(boundary);
  const kind = String(params.type ?? params.op ?? '').toUpperCase();
  if (kind === 'LINE' || kind === 'PALE' || kind === 'FESS') {
    const u = finite(params.u ?? params.p ?? record(params.point).u, 0.5, 'counterchange boundary.u');
    const v = finite(params.v ?? params.p ?? record(params.point).v, 0.5, 'counterchange boundary.v');
    if (region.includes('left') || region.includes('hoist')) return [[
      { x: frame.x, y: frame.y }, { x: frame.x + frame.width * u, y: frame.y },
      { x: frame.x + frame.width * u, y: frame.y + frame.height }, { x: frame.x, y: frame.y + frame.height },
    ]];
    if (region.includes('right') || region.includes('fly')) return [[
      { x: frame.x + frame.width * u, y: frame.y }, { x: frame.x + frame.width, y: frame.y },
      { x: frame.x + frame.width, y: frame.y + frame.height }, { x: frame.x + frame.width * u, y: frame.y + frame.height },
    ]];
    if (region.includes('top') || region.includes('upper')) return [[
      { x: frame.x, y: frame.y }, { x: frame.x + frame.width, y: frame.y },
      { x: frame.x + frame.width, y: frame.y + frame.height * v }, { x: frame.x, y: frame.y + frame.height * v },
    ]];
    if (region.includes('bottom') || region.includes('lower')) return [[
      { x: frame.x, y: frame.y + frame.height * v }, { x: frame.x + frame.width, y: frame.y + frame.height * v },
      { x: frame.x + frame.width, y: frame.y + frame.height }, { x: frame.x, y: frame.y + frame.height },
    ]];
  }
  throw new TypeError(`Counterchange clip "${copyId}" must contain a polygon or identify a supported boundary region`);
}

function shapePoints(shapeInput: unknown, frame: FrameBox): { polygons: FlagPolygonSet; fillRule?: 'evenodd' } {
  const shape = record(shapeInput);
  const type = String(shape.type ?? shape.kind ?? '').toLowerCase();
  const transform = record(shape.transform);
  const translate = record(transform.translate);
  const tx = finite(translate.u ?? transform.x, 0, 'transform.translate.u');
  const ty = finite(translate.v ?? transform.y, 0, 'transform.translate.v');
  const scale = finite(transform.scale, 1, 'transform.scale');
  const angle = finite(transform.rotate ?? transform.rotation, 0, 'transform.rotate') * Math.PI / 180;
  if (scale <= 0) throw new RangeError('Shape scale must be positive');
  const centerX = frame.x + frame.width / 2 + tx * frame.width;
  const centerY = frame.y + frame.height / 2 + ty * frame.height;
  const apply = (u: number, v: number): FlagPoint => {
    const dx = (u - 0.5) * frame.width * scale;
    const dy = (v - 0.5) * frame.height * scale;
    return {
      x: centerX + dx * Math.cos(angle) - dy * Math.sin(angle),
      y: centerY + dx * Math.sin(angle) + dy * Math.cos(angle),
    };
  };
  const points = (values: unknown): FlagPolygon => {
    if (!Array.isArray(values)) throw new TypeError('Polygon shape requires a points array');
    return values.map((item) => {
      const p = record(item);
      if (Number.isFinite(p.u) && Number.isFinite(p.v)) return apply(Number(p.u), Number(p.v));
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) return apply(Number(p.x), Number(p.y));
      if (Array.isArray(item) && item.length >= 2) return apply(Number(item[0]), Number(item[1]));
      throw new TypeError('Polygon points must use normalized x/y or u/v coordinates');
    });
  };
  if (type === 'rect' || type === 'rectangle') {
    const x = finite(shape.x, 0, 'shape.x'), y = finite(shape.y, 0, 'shape.y');
    const w = finite(shape.w ?? shape.width, 1, 'shape.width'), h = finite(shape.h ?? shape.height, 1, 'shape.height');
    if (w <= 0 || h <= 0) throw new RangeError('Rectangle width and height must be positive');
    return { polygons: [[apply(x, y), apply(x + w, y), apply(x + w, y + h), apply(x, y + h)]] };
  }
  if (type === 'polygon') {
    const polygon = points(shape.points);
    const cutouts = Array.isArray(shape.cutouts) ? shape.cutouts.map(points) : [];
    return { polygons: [polygon, ...cutouts], ...(cutouts.length ? { fillRule: 'evenodd' as const } : {}) };
  }
  if (type === 'circle' || type === 'disc' || type === 'ring') {
    const cx = finite(shape.cx ?? shape.center?.u, 0.5, 'shape.cx');
    const cy = finite(shape.cy ?? shape.center?.v, 0.5, 'shape.cy');
    const outerRadius = finite(shape.radius ?? shape.r ?? shape.outerRadius, type === 'ring' ? 0.3 : 0.2, 'shape.radius');
    const radius = outerRadius * Math.min(frame.width, frame.height) * scale;
    if (radius <= 0) throw new RangeError('Circle radius must be positive');
    const center = apply(cx, cy);
    if (type !== 'ring') return { polygons: [circlePoints(center.x, center.y, radius)] };
    const innerRadius = finite(shape.innerRadius, outerRadius * finite(shape.innerRatio, 0.65, 'shape.innerRatio'), 'shape.innerRadius');
    if (!(innerRadius > 0 && innerRadius < outerRadius)) throw new RangeError('Ring inner radius must be smaller than its outer radius');
    return {
      polygons: [circlePoints(center.x, center.y, radius), circlePoints(center.x, center.y, innerRadius * Math.min(frame.width, frame.height) * scale)],
      fillRule: 'evenodd',
    };
  }
  if (type === 'path') {
    const d = String(shape.d ?? '');
    if (!d || /[^MLHVZ0-9.,+\-\s]/i.test(d)) {
      throw new TypeError('Path layer shapes must use closed M, L, H, V, and Z segments');
    }
    const tokens = d.match(/[A-Za-z]|[-+]?(?:\d*\.?\d+)/g) ?? [];
    const output: FlagPoint[] = [];
    let command = '';
    let index = 0;
    let cursor = { x: 0, y: 0 };
    while (index < tokens.length) {
      if (/^[A-Za-z]$/.test(tokens[index])) command = tokens[index++].toUpperCase();
      if (command === 'Z') { command = ''; continue; }
      if (command === 'M' || command === 'L') {
        cursor = { x: Number(tokens[index++]), y: Number(tokens[index++]) };
        output.push(apply(cursor.x, cursor.y));
        if (command === 'M') command = 'L';
      } else if (command === 'H') {
        cursor = { ...cursor, x: Number(tokens[index++]) };
        output.push(apply(cursor.x, cursor.y));
      } else if (command === 'V') {
        cursor = { ...cursor, y: Number(tokens[index++]) };
        output.push(apply(cursor.x, cursor.y));
      } else {
        throw new TypeError('Path layer shapes must use M, L, H, V, and Z segments');
      }
      if (!Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) throw new TypeError('Path coordinates must be finite');
    }
    if (output.length < 3) throw new RangeError('Path shape must contain at least three points');
    return { polygons: [output] };
  }
  throw new TypeError(`Unsupported FlagSpec shape type "${type || '(empty)'}"`);
}

function emitShape(
  state: RenderState,
  layer: FlagLayer,
  context: RenderContext,
): string {
  const shape = record(layer.shape);
  const type = String(shape.type ?? shape.kind ?? '');
  const params = record(shape.params);
  const normalizedContext = { ...context, clips: [...context.clips] };
  for (const clip of layer.clip) {
    if (typeof clip === 'string') {
      if (clip !== 'flag-outline') throw new TypeError(`Unknown named clip region "${clip}"`);
      continue;
    }
    const polygons = polygonsFromClip(clip, context.frame);
    if (!polygons) throw new TypeError(`Unsupported clip geometry on layer "${layer.id}"`);
    normalizedContext.clips.push(addClip(state, polygons));
  }
  if (shape.type === 'frame' || layer.role === 'canton' && shape.type === 'canton') {
    const x = finite(shape.x, 0, 'canton.x'), y = finite(shape.y, 0, 'canton.y');
    const width = finite(shape.w ?? shape.width, 0.5, 'canton.width');
    const height = finite(shape.h ?? shape.height, 0.5, 'canton.height');
    const frame = { x: context.frame.x + x * context.frame.width, y: context.frame.y + y * context.frame.height,
      width: width * context.frame.width, height: height * context.frame.height };
    const cantonClip = addClip(state, [frameRect(frame)]);
    const cantonContext = { ...context, frame, clips: [...normalizedContext.clips, cantonClip] };
    let inner = layer.frame ? renderFrame(state, layer.frame as unknown as FlagFrame, cantonContext) : '';
    if (!inner && Array.isArray(shape.children)) {
      inner = shape.children.map((node: FlagNode) => renderNode(state, node, cantonContext)).join('');
    }
    return inner ? `<g id="${layerId(state, layer.role, 'canton')}">${inner}</g>` : '';
  }
  const module = String(shape.module ?? (shape.type.startsWith('M') ? shape.type : '')).toUpperCase();
  const moduleMap: Record<string, string> = {
    DISC: 'M01', RING: 'M02', STAR: 'M03', POLYGON: 'M04', RHOMBUS: 'M05', CRESCENT: 'M06',
    SUN: 'M07', WHEEL: 'M08', CROSS_EMB: 'M09', CHEVRON_ARROW: 'M10', LENS: 'M11', LILY: 'M12',
    TOWER: 'M13', CROWN: 'M14', KEY: 'M15', SWORD: 'M16', SPEAR: 'M17', TRIDENT: 'M17',
    ANCHOR: 'M18', TREE: 'M19', MOUNTAIN: 'M20', WAVES: 'M21', SHIP: 'M22', WINGED: 'M23',
    GLYPH: 'M24', SWIRL: 'M25', FOIL: 'M26', FLAME: 'M27', SHIELD: 'M28', BOW_ARROW: 'M29',
    BAR_STACK: 'M30',
  };
  const moduleId = moduleMap[module] ?? module;
  if (/^M(?:0[1-9]|[12]\d|30)$/.test(moduleId)) {
    const scale = finite(shape.diameter ?? shape.size, finite(shape.radius, 0.2, 'shape.radius') * 2, 'shape.diameter');
    const cx = finite(shape.cx ?? shape.center?.u, 0.5, 'shape.cx');
    const cy = finite(shape.cy ?? shape.center?.v, 0.5, 'shape.cy');
    const built = validateFlagEmblem({ module: moduleId as any, params }, {
      scale,
      canvasHeight: Math.min(context.frame.width, context.frame.height),
      rng: deterministicRandom(`${state.seed}:${layer.id}:${stableStringify(params)}`),
    });
    const center = { x: context.frame.x + cx * context.frame.width, y: context.frame.y + cy * context.frame.height };
    const emblemScale = scale * Math.min(context.frame.width, context.frame.height);
    const angle = finite(shape.rotate ?? shape.rotation, 0, 'shape.rotate') * Math.PI / 180;
    const primitives: string[] = [];
    for (const primitive of built.primitives) {
      const primitiveColor = primitive.fill === 'inner'
        ? colorFor(shape.inner_fill ?? layer.fill, context)
        : primitive.fill === 'detail'
          ? colorFor(shape.detail_fill ?? layer.fill, context)
          : colorFor(shape.outer_fill ?? layer.fill, context);
      primitives.push(renderEmblemPrimitive(primitive, center, emblemScale, angle, primitiveColor, state.width));
    }
    const id = layerId(state, layer.role, module.toLowerCase());
    return `<g id="${id}">${clippedMarkup(primitives.join(''), normalizedContext.clips)}</g>`;
  }
  if (/^O0[1-7]$/.test(type.toUpperCase())) {
    const built = buildFlagOrdinaryLayers([{ type: type.toUpperCase() as any, params, fill: layer.fill }], {
      x0: context.frame.x, y0: context.frame.y, w: context.frame.width, h: context.frame.height,
    }, { canvasHeight: HEIGHT });
    return built.paintLayers.map((paint) =>
      emitPolygons(state, paint.polygons, layer.fill, layer.role, type, normalizedContext)).join('');
  }
  const geometry = shapePoints(layer.shape, context.frame);
  const fill = colorFor(layer.fill, context);
  const id = layerId(state, layer.role, type || 'shape');
  const bounded = clipPolygonsToSvgRange(geometry.polygons, state.width);
  const paths = geometry.fillRule
    ? `<path d="${bounded.map(pointPath).join(' ')}" fill="${fill}" fill-rule="${geometry.fillRule}"/>`
    : bounded.map((polygon) =>
      `<polygon points="${polygon.map(({ x, y }) => `${number(x)},${number(y)}`).join(' ')}" fill="${fill}"/>`).join('');
  return `<g id="${id}">${clippedMarkup(paths, normalizedContext.clips)}</g>`;
}

function renderEmblemPrimitive(
  primitive: EmblemPrimitive,
  center: FlagPoint,
  scale: number,
  angle: number,
  fill: string,
  maxWidth: number,
): string {
  const apply = ({ x, y }: { x: number; y: number }) => ({
    x: center.x + scale * (x * Math.cos(angle) - y * Math.sin(angle)),
    y: center.y + scale * (x * Math.sin(angle) + y * Math.cos(angle)),
  });
  if (primitive.kind === 'circle') {
    const p = apply(primitive.center);
    const radius = primitive.radius * scale;
    if (p.x - radius >= -HEIGHT * 0.1 && p.x + radius <= maxWidth + HEIGHT * 0.1 &&
      p.y - radius >= -HEIGHT * 0.1 && p.y + radius <= HEIGHT * 1.1) {
      return `<circle cx="${number(p.x)}" cy="${number(p.y)}" r="${number(radius)}" fill="${fill}"/>`;
    }
    const clipped = clipPolygonsToSvgRange([circlePoints(p.x, p.y, radius)], maxWidth);
    return clipped.map((polygon) =>
      `<polygon points="${polygon.map((point) => `${number(point.x)},${number(point.y)}`).join(' ')}" fill="${fill}"/>`).join('');
  }
  if (primitive.kind === 'ring') {
    const p = apply(primitive.center);
    const outer = primitive.outerRadius * scale, inner = primitive.innerRadius * scale;
    if (p.x - outer < -HEIGHT * 0.1 || p.x + outer > maxWidth + HEIGHT * 0.1 ||
      p.y - outer < -HEIGHT * 0.1 || p.y + outer > HEIGHT * 1.1) {
      const rings = clipPolygonsToSvgRange([circlePoints(p.x, p.y, outer), circlePoints(p.x, p.y, inner)], maxWidth);
      return `<path d="${rings.map(pointPath).join(' ')}" fill="${fill}" fill-rule="evenodd"/>`;
    }
    const d = `M${number(p.x - outer)} ${number(p.y)} A${number(outer)} ${number(outer)} 0 1 0 ${number(p.x + outer)} ${number(p.y)} A${number(outer)} ${number(outer)} 0 1 0 ${number(p.x - outer)} ${number(p.y)} Z M${number(p.x - inner)} ${number(p.y)} A${number(inner)} ${number(inner)} 0 1 1 ${number(p.x + inner)} ${number(p.y)} A${number(inner)} ${number(inner)} 0 1 1 ${number(p.x - inner)} ${number(p.y)} Z`;
    return `<path d="${d}" fill="${fill}" fill-rule="evenodd"/>`;
  }
  const polygon = clipPolygonsToSvgRange([primitive.points.map(apply)], maxWidth);
  return polygon.map((points) =>
    `<polygon points="${points.map((point) => `${number(point.x)},${number(point.y)}`).join(' ')}" fill="${fill}"/>`).join('');
}

function deterministicRandom(seed: string): () => number {
  let state = 0x9e3779b9;
  for (let index = 0; index < seed.length; index += 1) state = Math.imul(state ^ seed.charCodeAt(index), 0x85ebca6b);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function placements(patternInput: unknown): RepeatPlacement[] {
  const pattern = record(patternInput);
  const rawPlacements = Array.isArray(pattern.placements) ? pattern.placements : undefined;
  if (rawPlacements) return rawPlacements.map((raw) => {
    const item = record(raw);
    return { u: finite(item.u ?? item.x, 0.5, 'repeat.u'), v: finite(item.v ?? item.y, 0.5, 'repeat.v'),
      rotation: finite(item.rotation, 0, 'repeat.rotation'), scale: finite(item.scale, 1, 'repeat.scale'), mirror: item.mirror === true };
  });
  const type = String(pattern.kind ?? pattern.type ?? pattern.id ?? '').toUpperCase();
  const count = Math.round(finite(pattern.count ?? pattern.n, 1, 'repeat.count'));
  if (count < 1 || count > 64) throw new RangeError('Repeat count must be between 1 and 64');
  if (type === 'RING' || type === 'RADIAL' || pattern.rotation === 'radial') {
    const radius = finite(pattern.radius, 0.25, 'repeat.radius');
    const start = finite(pattern.startAngle, -90, 'repeat.startAngle');
    return Array.from({ length: count }, (_, index) => {
      const angle = (start + index * 360 / count) * Math.PI / 180;
      return { u: 0.5 + radius * Math.cos(angle), v: 0.5 + radius * Math.sin(angle),
        rotation: pattern.rotation === 'radial' ? start + index * 360 / count : finite(pattern.itemRotation, 0, 'repeat.itemRotation'),
        scale: finite(pattern.scale, 1, 'repeat.scale'), mirror: false };
    });
  }
  if (type === 'GRID') {
    const rows = Math.round(finite(pattern.rows, Math.ceil(Math.sqrt(count)), 'repeat.rows'));
    const cols = Math.round(finite(pattern.cols, Math.ceil(count / rows), 'repeat.cols'));
    return Array.from({ length: Math.min(count, rows * cols) }, (_, index) => {
      const row = Math.floor(index / cols), col = index % cols;
      return { u: finite(pattern.startU, 0.5, 'repeat.startU') + (col - (cols - 1) / 2) * finite(pattern.stepX, 0.2, 'repeat.stepX'),
        v: finite(pattern.startV, 0.5, 'repeat.startV') + (row - (rows - 1) / 2) * finite(pattern.stepY, 0.2, 'repeat.stepY'),
        rotation: finite(pattern.rotation, 0, 'repeat.rotation'), scale: finite(pattern.scale, 1, 'repeat.scale'), mirror: false };
    });
  }
  if (type === 'LINE' || !type && count > 1) {
    const vertical = String(pattern.axis ?? 'HORIZONTAL').toUpperCase() === 'VERTICAL';
    return Array.from({ length: count }, (_, index) => ({
      u: vertical ? 0.5 : (index + 1) / (count + 1),
      v: vertical ? (index + 1) / (count + 1) : 0.5,
      rotation: finite(pattern.rotation, 0, 'repeat.rotation'),
      scale: finite(pattern.scale, 1, 'repeat.scale'),
      mirror: false,
    }));
  }
  throw new TypeError(`Unsupported repeat pattern "${type || '(empty)'}"`);
}

function renderNode(state: RenderState, node: FlagNode, context: RenderContext): string {
  switch (node.kind) {
    case 'fill': {
      const fill = colorFor(node.fill, context);
      const id = layerId(state, 'ground', 'fill');
      const { x, y, width, height } = context.frame;
      return `<g id="${id}">${clippedMarkup(`<rect x="${number(x)}" y="${number(y)}" width="${number(width)}" height="${number(height)}" fill="${fill}"/>`, context.clips)}</g>`;
    }
    case 'split': {
      const params = normalizeFieldParams(node.op, record(node.params), node.children, context);
      const fieldNode: FlagFieldNode = { op: node.op as FlagFieldNode['op'], params };
      const frame: FlagFieldFrame = { x0: context.frame.x, y0: context.frame.y, w: context.frame.width, h: context.frame.height };
      const result = buildFlagField(fieldNode, frame, { canvasHeight: HEIGHT });
      const out: string[] = [];
      result.regions.forEach((region, index) => {
        const child = node.children[index];
        if (!child) {
          out.push(emitPolygons(state, region.polygons, region.slot, 'ground', node.op, context));
          return;
        }
        const base = emitPolygons(state, region.polygons, region.slot, 'ground', `${node.op}-region`, context);
        if (child.kind === 'fill' && child.fill === region.slot) {
          out.push(base);
          return;
        }
        if (child.kind === 'fill') {
          out.push(emitPolygons(state, region.polygons, child.fill, 'ground', `${node.op}-region`, context));
          return;
        }
        const polygonSet = region.polygons;
        const bounds = polygonSet.flat().reduce((box, point) => ({
          minX: Math.min(box.minX, point.x), minY: Math.min(box.minY, point.y),
          maxX: Math.max(box.maxX, point.x), maxY: Math.max(box.maxY, point.y),
        }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
        const clip = addClip(state, polygonSet);
        const childContext: RenderContext = {
          ...context,
          frame: { x: bounds.minX, y: bounds.minY, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY },
          clips: [...context.clips, clip],
        };
        out.push(base, renderNode(state, child, childContext));
      });
      return out.join('');
    }
    case 'layer': {
      let content = emitShape(state, node.layer, context);
      if (node.frame) {
        const frameBox = {
          x: context.frame.x + node.frame.x0 * context.frame.width,
          y: context.frame.y + node.frame.y0 * context.frame.height,
          width: node.frame.w * context.frame.width, height: node.frame.h * context.frame.height,
        };
        const frameClip = addClip(state, [frameRect(frameBox)]);
        content += renderFrame(state, node.frame, { ...context, clips: [...context.clips, frameClip] });
      }
      const transform = layerTransform(node.layer.transform, context.frame);
      return transform
        ? `<g id="${layerId(state, node.layer.role, 'transform')}" transform="${transform}">${content}</g>`
        : content;
    }
    case 'group':
      return node.children.map((child) => renderNode(state, child, context)).join('');
    case 'mirror': {
      const axis = String(node.axis).toLowerCase();
      const horizontal = ['x', 'vertical', 'mir_v', 'mirror_vertical'].includes(axis);
      const { x, y, width, height } = context.frame;
      const cx = x + width / 2, cy = y + height / 2;
      const transform = horizontal
        ? `translate(${number(cx * 2)} 0) scale(-1 1)`
        : `translate(0 ${number(cy * 2)}) scale(1 -1)`;
      const id = layerId(state, 'charge', 'mirror');
      const template = renderNode(state, node.child, context);
      if (!template) return '';
      const sourceId = `${id}-source`;
      state.defs.push(`<g id="${sourceId}">${template}</g>`);
      return `<use href="#${sourceId}"/><use href="#${sourceId}" transform="${transform}"/>`;
    }
    case 'repeat': {
      const id = layerId(state, 'charge', 'repeat');
      const template = renderNode(state, node.child, context);
      if (!template) return '';
      const sourceId = `${id}-source`;
      state.defs.push(`<g id="${sourceId}">${template}</g>`);
      const { x, y, width, height } = context.frame;
      return placements(node.pattern).map((placement) => {
        const px = x + placement.u * width, py = y + placement.v * height;
        const transforms = [`translate(${number(px)} ${number(py)})`];
        if (placement.rotation) transforms.push(`rotate(${number(placement.rotation)})`);
        if (placement.scale !== 1 || placement.mirror) {
          transforms.push(`scale(${number(placement.mirror ? -placement.scale : placement.scale)} ${number(placement.scale)})`);
        }
        transforms.push(`translate(${number(-px)} ${number(-py)})`);
        return `<use href="#${sourceId}" transform="${transforms.join(' ')}"/>`;
      }).join('');
    }
    case 'counterchange':
      return node.copies.map((copy) => {
        const polygons = counterchangeClip(copy.clip, copy.region_id, node.boundary, context.frame);
        const clip = addClip(state, polygons);
        return renderNode(state, copy.child, {
          ...context,
          clips: [...context.clips, clip],
          slotMap: { ...context.slotMap, ...copy.slot_map },
        });
      }).join('');
  }
}

function layerTransform(transformInput: unknown, frame: FrameBox): string {
  const transform = record(transformInput);
  const translate = record(transform.translate);
  const dx = finite(translate.u ?? transform.x, 0, 'layer.transform.translate.u') * frame.width;
  const dy = finite(translate.v ?? transform.y, 0, 'layer.transform.translate.v') * frame.height;
  const scale = finite(transform.scale, 1, 'layer.transform.scale');
  const rotation = finite(transform.rotate ?? transform.rotation, 0, 'layer.transform.rotate');
  if (scale <= 0) throw new RangeError('Layer scale must be positive');
  if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON && Math.abs(rotation) < EPSILON &&
    Math.abs(scale - 1) < EPSILON) return '';
  const cx = frame.x + frame.width / 2, cy = frame.y + frame.height / 2;
  const transforms = [`translate(${number(dx)} ${number(dy)})`];
  if (Math.abs(rotation) >= EPSILON) transforms.push(`rotate(${number(rotation)} ${number(cx)} ${number(cy)})`);
  if (Math.abs(scale - 1) >= EPSILON) {
    transforms.push(`translate(${number(cx)} ${number(cy)})`, `scale(${number(scale)})`, `translate(${number(-cx)} ${number(-cy)})`);
  }
  return transforms.join(' ');
}

function renderFrame(state: RenderState, frame: FlagFrame, parent: RenderContext): string {
  const box: FrameBox = {
    x: parent.frame.x + frame.x0 * parent.frame.width,
    y: parent.frame.y + frame.y0 * parent.frame.height,
    width: frame.w * parent.frame.width,
    height: frame.h * parent.frame.height,
  };
  let clips = [...parent.clips];
  if (frame !== undefined && (box.x !== parent.frame.x || box.y !== parent.frame.y ||
    box.width !== parent.frame.width || box.height !== parent.frame.height)) {
    clips.push(addClip(state, [frameRect(box)]));
  }
  for (const clip of frame.clip) {
    if (typeof clip === 'string') {
      if (clip !== 'flag-outline') throw new TypeError(`Unknown named frame clip "${clip}"`);
      continue;
    }
    const polygons = polygonsFromClip(clip, box);
    if (!polygons) throw new TypeError('Unsupported frame clip geometry');
    clips.push(addClip(state, polygons));
  }
  const context = { ...parent, frame: box, clips };
  const content = [renderNode(state, frame.ground, context), ...frame.layers.map((node) => renderNode(state, node, context))].join('');
  return content;
}

function outlinePath(points: readonly OutlinePoint[]): string {
  return pointPath(points);
}

/**
 * Converts a saved FlagSpec to deterministic, compact SVG using only the
 * geometry modules and SVG elements permitted by §17.
 */
export function renderFlagSpec(spec: FlagSpec, options: { embed_metadata?: boolean } = {}): string {
  assertValidFlagSpec(spec);
  const outline = spec.outline.type === 'RECT'
    ? {
      width: Math.round(HEIGHT * spec.outline.aspect),
      height: HEIGHT,
      boundary: [{ x: 0, y: 0 }, { x: Math.round(HEIGHT * spec.outline.aspect), y: 0 },
        { x: Math.round(HEIGHT * spec.outline.aspect), y: HEIGHT }, { x: 0, y: HEIGHT }],
      cutouts: [] as OutlinePoint[][],
    }
    : buildFlagOutline({
      type: spec.outline.type as any,
      aspect: spec.outline.aspect,
      params: record(spec.outline.params),
    });
  if (outline.width < 1) throw new RangeError('Flag aspect ratio rounds to a zero-width SVG canvas');
  const state: RenderState = {
    width: outline.width,
    defs: [],
    layers: [],
    clipIds: new Map(),
    nextClip: 1,
    nextLayer: 1,
    seed: String(spec.seed),
  };
  const outlineD = [outline.boundary, ...outline.cutouts].map(outlinePath).join(' ');
  state.defs.push(`<clipPath id="clip-outline"><path d="${outlineD}" fill-rule="evenodd"/></clipPath>`);
  const rootFrame: FrameBox = { x: 0, y: 0, width: outline.width, height: HEIGHT };
  const context: RenderContext = {
    frame: rootFrame,
    clips: ['clip-outline'],
    slots: Object.fromEntries(spec.slots.items.map((slot) => [slot, spec.palette[slot].hex.toLowerCase()])),
    slotMap: {},
  };
  const frame: FlagFrame = spec.root;
  const body = renderFrame(state, frame, context);
  const metadata = options.embed_metadata
    ? `<metadata>${escapeXml(JSON.stringify({ generator_version: spec.generator_version, seed: spec.seed, profile_id: spec.profile_id, tags: spec.tags }))}</metadata>`
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${number(outline.width)} ${HEIGHT}"><defs>${state.defs.join('')}</defs>${metadata}<g clip-path="url(#clip-outline)">${body}</g></svg>`;
  const bytes = new TextEncoder().encode(svg).length;
  if (bytes > 30 * 1024) throw new RangeError(`Rendered SVG exceeds the 30 KB limit (${bytes} bytes)`);
  return svg;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Short alias matching the logical renderer interface in the specification. */
export const render = renderFlagSpec;
