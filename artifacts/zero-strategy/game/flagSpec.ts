/**
 * Versioned, renderer-independent flag description.
 *
 * Operator-specific geometry is deliberately JSON-shaped: the flag brief
 * defines the node tree but leaves several operator and pattern payloads open.
 * Keeping those payloads intact lets hand-authored specs round-trip while
 * later generator stages add their own validated conventions.
 */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type FlagLayerRole = 'ground' | 'ordinary' | 'canton' | 'charge' | 'border' | 'ornament';
export type SlotFill = string | { pattern: JsonValue; [key: string]: JsonValue };

export interface RelativeFrameRect {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

export interface FlagLayer extends JsonObject {
  id: string;
  role: FlagLayerRole;
  shape: JsonValue;
  transform: JsonValue;
  fill: SlotFill;
  clip: JsonValue[];
  tags: string[];
  cost: number;
}

export interface FillNode {
  kind: 'fill';
  fill: SlotFill;
}

export interface SplitNode {
  kind: 'split';
  op: string;
  params: JsonObject;
  children: FlagNode[];
}

export interface LayerNode {
  kind: 'layer';
  layer: FlagLayer;
  /** A canton or similar layer may own a nested coordinate frame. */
  frame?: FlagFrame;
}

export interface GroupNode {
  kind: 'group';
  layout: JsonValue;
  children: FlagNode[];
}

export interface RepeatNode {
  kind: 'repeat';
  pattern: JsonValue;
  child: FlagNode;
}

export interface MirrorNode {
  kind: 'mirror';
  axis: string;
  child: FlagNode;
}

export interface CounterchangeNode {
  kind: 'counterchange';
  boundary: JsonValue;
  child: FlagNode;
  /** Explicit clipped copies keep the two region-specific color assignments unambiguous. */
  copies: CounterchangeCopy[];
}

export interface CounterchangeCopy {
  region_id: string;
  clip: JsonValue;
  slot_map: Record<string, string>;
  child: FlagNode;
}

export type FlagNode =
  | FillNode
  | SplitNode
  | LayerNode
  | GroupNode
  | RepeatNode
  | MirrorNode
  | CounterchangeNode;

export interface FlagFrame extends RelativeFrameRect {
  clip: JsonValue[];
  ground: FlagNode;
  layers: FlagNode[];
}

export interface FlagOutline extends JsonObject {
  type: string;
  params: JsonObject;
  aspect: number;
  safe_area: JsonValue;
}

export interface FlagSlotTable extends JsonObject {
  items: string[];
  equalities: [string, string][];
}

export interface FlagPaletteEntry extends JsonObject {
  color_id: string;
  hex: string;
}

export interface FlagMeta extends JsonObject {
  complexity: number;
  symmetry: JsonValue;
  color_count: number;
  structure_hash: string;
  visual_hash: string;
}

export interface FlagSpec {
  generator_version: string;
  seed: string | number;
  profile_id: string;
  second_profile_id?: string | null;
  era: number;
  tags: string[];
  outline: FlagOutline;
  slots: FlagSlotTable;
  palette: Record<string, FlagPaletteEntry>;
  root: FlagFrame;
  meta: FlagMeta;
}

export interface FlagSpecIssue {
  path: string;
  message: string;
}

const LAYER_ROLES = new Set<FlagLayerRole>([
  'ground',
  'ordinary',
  'canton',
  'charge',
  'border',
  'ornament',
]);
const NODE_KINDS = new Set(['fill', 'split', 'layer', 'group', 'repeat', 'mirror', 'counterchange']);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function add(issues: FlagSpecIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function validateJson(value: unknown, path: string, issues: FlagSpecIssue[], seen = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) add(issues, path, 'must be a finite JSON number other than negative zero');
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      add(issues, path, 'must not contain cyclic references');
      return;
    }
    seen.add(value);
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) add(issues, `${path}[${index}]`, 'must not be a sparse array');
      else validateJson(value[index], `${path}[${index}]`, issues, seen);
    }
    seen.delete(value);
    return;
  }
  if (!isObject(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    add(issues, path, 'must contain only JSON values and plain objects');
    return;
  }
  if (seen.has(value)) {
    add(issues, path, 'must not contain cyclic references');
    return;
  }
  seen.add(value);
  for (const [key, child] of Object.entries(value)) validateJson(child, `${path}.${key}`, issues, seen);
  seen.delete(value);
}

function validateFill(fill: unknown, slots: Set<string>, path: string, issues: FlagSpecIssue[]): void {
  if (typeof fill === 'string') {
    if (/^s\d+$/.test(fill) && !slots.has(fill)) add(issues, path, `references unknown color slot "${fill}"`);
    return;
  }
  if (!isObject(fill) || !Object.hasOwn(fill, 'pattern')) {
    add(issues, path, 'must be a slot name or a pattern object');
  }
}

function validateCoordinates(value: unknown, path: string, issues: FlagSpecIssue[], seen = new Set<object>()): void {
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    value.forEach((child, index) => validateCoordinates(child, `${path}[${index}]`, issues, seen));
    seen.delete(value);
    return;
  }
  if (!isObject(value)) return;
  if (seen.has(value)) return;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if ((key === 'u' || key === 'v') && (!isFiniteNumber(child) || child < 0 || child > 1)) {
      add(issues, `${path}.${key}`, 'relative coordinates must be in the inclusive range 0..1');
    } else {
      validateCoordinates(child, `${path}.${key}`, issues, seen);
    }
  }
  seen.delete(value);
}

function validateLayer(layer: unknown, slots: Set<string>, path: string, issues: FlagSpecIssue[]): void {
  if (!isObject(layer)) {
    add(issues, path, 'must be a layer object');
    return;
  }
  if (!isString(layer.id)) add(issues, `${path}.id`, 'must be a non-empty string');
  if (!LAYER_ROLES.has(layer.role as FlagLayerRole)) add(issues, `${path}.role`, 'has an unsupported layer role');
  if (!Object.hasOwn(layer, 'shape')) add(issues, `${path}.shape`, 'is required');
  if (!Object.hasOwn(layer, 'transform')) add(issues, `${path}.transform`, 'is required');
  validateFill(layer.fill, slots, `${path}.fill`, issues);
  if (!Array.isArray(layer.clip)) add(issues, `${path}.clip`, 'must be an array of clipping regions');
  if (!Array.isArray(layer.tags) || !layer.tags.every(isString)) add(issues, `${path}.tags`, 'must be an array of non-empty strings');
  if (!isFiniteNumber(layer.cost)) add(issues, `${path}.cost`, 'must be a finite number');
}

function validateNode(
  node: unknown,
  slots: Set<string>,
  path: string,
  frameDepth: number,
  issues: FlagSpecIssue[],
): void {
  if (!isObject(node) || !NODE_KINDS.has(String(node.kind))) {
    add(issues, path, 'must be a supported flag node');
    return;
  }
  switch (node.kind) {
    case 'fill':
      validateFill(node.fill, slots, `${path}.fill`, issues);
      break;
    case 'split':
      if (!isString(node.op)) add(issues, `${path}.op`, 'must be a non-empty operator name');
      if (!isObject(node.params)) add(issues, `${path}.params`, 'must be an object');
      if (!Array.isArray(node.children) || node.children.length === 0) {
        add(issues, `${path}.children`, 'must be a non-empty array');
      } else {
        node.children.forEach((child, index) => validateNode(child, slots, `${path}.children[${index}]`, frameDepth, issues));
      }
      break;
    case 'layer':
      validateLayer(node.layer, slots, `${path}.layer`, issues);
      if (node.frame !== undefined) validateFrame(node.frame, slots, `${path}.frame`, frameDepth + 1, issues);
      break;
    case 'group':
      if (!Object.hasOwn(node, 'layout')) add(issues, `${path}.layout`, 'is required');
      if (!Array.isArray(node.children) || node.children.length === 0) {
        add(issues, `${path}.children`, 'must be a non-empty array');
      } else {
        node.children.forEach((child, index) => validateNode(child, slots, `${path}.children[${index}]`, frameDepth, issues));
      }
      break;
    case 'repeat':
      if (!Object.hasOwn(node, 'pattern')) add(issues, `${path}.pattern`, 'is required');
      validateNode(node.child, slots, `${path}.child`, frameDepth, issues);
      break;
    case 'mirror':
      if (!isString(node.axis)) add(issues, `${path}.axis`, 'must be a non-empty axis name');
      validateNode(node.child, slots, `${path}.child`, frameDepth, issues);
      break;
    case 'counterchange':
      if (!Object.hasOwn(node, 'boundary')) add(issues, `${path}.boundary`, 'is required');
      validateNode(node.child, slots, `${path}.child`, frameDepth, issues);
      if (!Array.isArray(node.copies) || node.copies.length !== 2) {
        add(issues, `${path}.copies`, 'must contain exactly two clipped regional copies');
      } else {
        const regionIds = new Set<string>();
        node.copies.forEach((copy, index) => {
          const copyPath = `${path}.copies[${index}]`;
          if (!isObject(copy)) {
            add(issues, copyPath, 'must be a clipped copy object');
            return;
          }
          if (!isString(copy.region_id)) add(issues, `${copyPath}.region_id`, 'must be a non-empty region identifier');
          else if (regionIds.has(copy.region_id)) add(issues, `${copyPath}.region_id`, 'must identify a different region for each copy');
          else regionIds.add(copy.region_id);
          if (!isObject(copy.clip) && !Array.isArray(copy.clip)) {
            add(issues, `${copyPath}.clip`, 'must describe a clipping region');
          }
          if (!isObject(copy.slot_map) || Object.keys(copy.slot_map).length === 0) {
            add(issues, `${copyPath}.slot_map`, 'must map source color slots to opposite-region slots');
          }
          else for (const [source, target] of Object.entries(copy.slot_map)) {
            if (!slots.has(source)) add(issues, `${copyPath}.slot_map.${source}`, 'references an unknown source color slot');
            if (!isString(target) || !slots.has(target)) add(issues, `${copyPath}.slot_map.${source}`, 'must map to a known color slot');
          }
          validateNode(copy.child, slots, `${copyPath}.child`, frameDepth, issues);
        });
      }
      break;
  }
}

function validateFrame(
  frame: unknown,
  slots: Set<string>,
  path: string,
  depth: number,
  issues: FlagSpecIssue[],
): void {
  if (!isObject(frame)) {
    add(issues, path, 'must be a frame object');
    return;
  }
  if (depth > 3) add(issues, path, 'frame nesting must not exceed depth 3');
  const rectKeys = ['x0', 'y0', 'w', 'h'] as const;
  for (const key of rectKeys) {
    if (!isFiniteNumber(frame[key])) add(issues, `${path}.${key}`, 'must be a finite normalized coordinate');
    else if ((frame[key] as number) < 0 || (frame[key] as number) > 1) {
      add(issues, `${path}.${key}`, 'must be in the inclusive range 0..1');
    }
  }
  if (
    isFiniteNumber(frame.x0) &&
    isFiniteNumber(frame.w) &&
    frame.x0 + frame.w > 1
  ) add(issues, `${path}.w`, 'frame must stay within the normalized horizontal bounds');
  if (
    isFiniteNumber(frame.y0) &&
    isFiniteNumber(frame.h) &&
    frame.y0 + frame.h > 1
  ) add(issues, `${path}.h`, 'frame must stay within the normalized vertical bounds');
  if (isFiniteNumber(frame.w) && frame.w <= 0) add(issues, `${path}.w`, 'must be greater than zero');
  if (isFiniteNumber(frame.h) && frame.h <= 0) add(issues, `${path}.h`, 'must be greater than zero');
  if (!Array.isArray(frame.clip)) add(issues, `${path}.clip`, 'must be an array of clipping regions');
  validateNode(frame.ground, slots, `${path}.ground`, depth, issues);
  if (!Array.isArray(frame.layers)) add(issues, `${path}.layers`, 'must be an array of nodes');
  else frame.layers.forEach((node, index) => validateNode(node, slots, `${path}.layers[${index}]`, depth, issues));
}

/** Return all schema and invariant failures without modifying the specification. */
export function validateFlagSpec(value: unknown): FlagSpecIssue[] {
  const issues: FlagSpecIssue[] = [];
  validateJson(value, '$', issues);
  if (!isObject(value)) {
    add(issues, '$', 'must be a FlagSpec object');
    return issues;
  }
  validateCoordinates(value, '$', issues);

  if (!isString(value.generator_version)) add(issues, '$.generator_version', 'must be a non-empty string');
  if (!(isString(value.seed) || isFiniteNumber(value.seed))) add(issues, '$.seed', 'must be a string or finite number');
  if (!isString(value.profile_id)) add(issues, '$.profile_id', 'must be a non-empty string');
  if (value.second_profile_id !== undefined && value.second_profile_id !== null && !isString(value.second_profile_id)) {
    add(issues, '$.second_profile_id', 'must be a non-empty string or null');
  }
  if (!Number.isInteger(value.era) || (value.era as number) < 0 || (value.era as number) > 6) {
    add(issues, '$.era', 'must be an integer from 0 through 6');
  }
  if (!Array.isArray(value.tags) || !value.tags.every(isString)) add(issues, '$.tags', 'must be an array of non-empty strings');

  const outline = value.outline;
  if (!isObject(outline)) add(issues, '$.outline', 'must be an outline object');
  else {
    if (!isString(outline.type)) add(issues, '$.outline.type', 'must be a non-empty outline type');
    if (!isObject(outline.params)) add(issues, '$.outline.params', 'must be an object');
    if (!isFiniteNumber(outline.aspect) || outline.aspect <= 0) add(issues, '$.outline.aspect', 'must be a positive finite number');
    if (!Object.hasOwn(outline, 'safe_area')) add(issues, '$.outline.safe_area', 'is required');
  }

  const slotObject = value.slots;
  const slotNames = new Set<string>();
  if (!isObject(slotObject)) {
    add(issues, '$.slots', 'must contain items and equalities');
  } else {
    if (!Array.isArray(slotObject.items) || !slotObject.items.every(isString)) {
      add(issues, '$.slots.items', 'must be an array of symbolic slot names');
    } else {
      slotObject.items.forEach((slot, index) => {
        if (slot !== `s${index + 1}`) add(issues, `$.slots.items[${index}]`, 'slots must be named consecutively s1..sn');
        if (slotNames.has(slot)) add(issues, `$.slots.items[${index}]`, 'slot names must be unique');
        slotNames.add(slot);
      });
    }
    if (!Array.isArray(slotObject.equalities)) add(issues, '$.slots.equalities', 'must be an array of slot pairs');
    else slotObject.equalities.forEach((pair, index) => {
      const path = `$.slots.equalities[${index}]`;
      if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(isString)) {
        add(issues, path, 'must be a pair of slot names');
      } else {
        if (pair[0] === pair[1]) add(issues, path, 'an equality must connect two distinct slots');
        for (const slot of pair) if (!slotNames.has(slot)) add(issues, path, `references unknown color slot "${slot}"`);
      }
    });
  }

  if (!isObject(value.palette)) add(issues, '$.palette', 'must be a slot-to-color object');
  else for (const [slot, entry] of Object.entries(value.palette)) {
    const path = `$.palette.${slot}`;
    if (!slotNames.has(slot)) add(issues, path, 'references an unknown color slot');
    if (!isObject(entry)) {
      add(issues, path, 'must contain color_id and hex');
      continue;
    }
    if (!isString(entry.color_id)) add(issues, `${path}.color_id`, 'must be a non-empty string');
    if (typeof entry.hex !== 'string' || !/^#[\da-f]{6}$/i.test(entry.hex)) {
      add(issues, `${path}.hex`, 'must be a six-digit hexadecimal color');
    }
  }

  validateFrame(value.root, slotNames, '$.root', 1, issues);

  const meta = value.meta;
  if (!isObject(meta)) add(issues, '$.meta', 'must contain flag metadata');
  else {
    if (!isFiniteNumber(meta.complexity) || meta.complexity < 0) add(issues, '$.meta.complexity', 'must be a non-negative finite number');
    if (!Object.hasOwn(meta, 'symmetry')) add(issues, '$.meta.symmetry', 'is required');
    if (!Number.isInteger(meta.color_count) || (meta.color_count as number) < 0) add(issues, '$.meta.color_count', 'must be a non-negative integer');
    if (!isString(meta.structure_hash)) add(issues, '$.meta.structure_hash', 'must be a non-empty string');
    if (!isString(meta.visual_hash)) add(issues, '$.meta.visual_hash', 'must be a non-empty string');
  }

  return issues;
}

/** Assert validity and return the original typed value. */
export function assertValidFlagSpec(value: unknown): asserts value is FlagSpec {
  const issues = validateFlagSpec(value);
  if (issues.length) {
    throw new TypeError(`Invalid FlagSpec:\n${issues.map(({ path, message }) => `- ${path}: ${message}`).join('\n')}`);
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

/** Serialize as deterministic UTF-8-compatible JSON with recursively sorted object keys. */
export function serializeFlagSpec(spec: FlagSpec): string {
  assertValidFlagSpec(spec);
  return canonicalJson(spec);
}

/** Parse canonical or hand-authored JSON and validate its complete FlagSpec shape. */
export function parseFlagSpec(text: string): FlagSpec {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SyntaxError(`Invalid FlagSpec JSON: ${message}`);
  }
  assertValidFlagSpec(value);
  return value;
}
