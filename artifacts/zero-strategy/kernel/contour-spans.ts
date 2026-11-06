import { getBinaryMathKernel } from './runtime';
import type {
  KernelContourRingData,
  KernelContourCompositionChunk,
  KernelContourScalarChunk,
} from './bindings/contracts';

export interface KernelContourSpan {
  y: number;
  start: number;
  end: number;
}

export interface KernelContourDistanceSource {
  spans: readonly KernelContourSpan[];
  additionalDistance?: number;
}

export interface KernelContourBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

type SpanList = readonly KernelContourSpan[];
type CachedSpanList = readonly Readonly<KernelContourSpan>[];
type BinarySpanCache = WeakMap<SpanList, Map<string, WeakMap<SpanList, CachedSpanList>>>;
type UnarySpanCache = WeakMap<SpanList, Map<string, CachedSpanList>>;

const normalizedCache: UnarySpanCache = new WeakMap();
const intersectionCache: BinarySpanCache = new WeakMap();
const unionCache: BinarySpanCache = new WeakMap();
const subtractionCache: BinarySpanCache = new WeakMap();
const borderCache: UnarySpanCache = new WeakMap();
const offsetCache: UnarySpanCache = new WeakMap();
const immutableSpanLists = new WeakSet<object>();

/** Создаёт неизменяемые строки для повторного использования бинарным ядром. */
export function freezeContourSpans(spans: readonly KernelContourSpan[]): SpanList {
  const frozen = Object.freeze(spans.map((span) => Object.freeze({
    y: span.y,
    start: span.start,
    end: span.end,
  })));
  immutableSpanLists.add(frozen);
  return frozen;
}

/** Группирует интервалы растра по климатическим значениям в бинарном ядре. */
export function classifyClimateSpans(
  spans: readonly KernelContourSpan[],
  humidity: Uint8Array,
  temperature: Float32Array,
  drainage: Uint8Array,
  width: number,
  height: number,
): Float64Array {
  return getBinaryMathKernel().contourClassifySpans(
    humidity,
    temperature,
    drainage,
    spans,
    width,
    height,
  );
}

/** Заменяет только ограниченное окно интервалов в бинарном ядре. */
export function replaceContourRegion(
  source: readonly KernelContourSpan[],
  replacement: readonly KernelContourSpan[],
  bounds: KernelContourBounds,
  width: number,
  height: number,
): KernelContourSpan[] {
  return getBinaryMathKernel().contourReplaceRegion(
    source,
    replacement,
    bounds,
    width,
    height,
  );
}

function cloneSpans(spans: CachedSpanList): KernelContourSpan[] {
  return spans.map((span) => ({ y: span.y, start: span.start, end: span.end }));
}

function rememberSpans(spans: readonly KernelContourSpan[]): CachedSpanList {
  return Object.freeze(spans.map((span) => Object.freeze({
    y: span.y,
    start: span.start,
    end: span.end,
  })));
}

function cachedUnary(
  cache: UnarySpanCache,
  spans: SpanList,
  key: string,
  compute: () => KernelContourSpan[],
): KernelContourSpan[] {
  if (!immutableSpanLists.has(spans as object)) return compute();
  let byQuery = cache.get(spans);
  if (!byQuery) {
    byQuery = new Map();
    cache.set(spans, byQuery);
  }
  const cached = byQuery.get(key);
  if (cached) return cloneSpans(cached);
  const result = compute();
  byQuery.set(key, rememberSpans(result));
  return result;
}

function cachedBinary(
  cache: BinarySpanCache,
  left: SpanList,
  right: SpanList,
  key: string,
  compute: () => KernelContourSpan[],
): KernelContourSpan[] {
  if (!immutableSpanLists.has(left as object) ||
      !immutableSpanLists.has(right as object)) return compute();
  let byQuery = cache.get(left);
  if (!byQuery) {
    byQuery = new Map();
    cache.set(left, byQuery);
  }
  let byRight = byQuery.get(key);
  if (!byRight) {
    byRight = new WeakMap();
    byQuery.set(key, byRight);
  }
  const cached = byRight.get(right);
  if (cached) return cloneSpans(cached);
  const result = compute();
  byRight.set(right, rememberSpans(result));
  return result;
}

export function linkContourRings(
  codes: Uint32Array,
  width: number,
  height: number,
): KernelContourRingData {
  return getBinaryMathKernel().contourLinkRings(codes, width, height);
}

/** Находит скалярные границы для части строк бинарным ядром. */
export function traceScalarContourChunk(
  values: Float64Array,
  include: Uint8Array | null,
  sourceRowStart: number,
  processRowStart: number,
  processRowEnd: number,
  width: number,
  height: number,
  skip: number | null,
): KernelContourScalarChunk {
  return getBinaryMathKernel().contourTraceScalarChunk(
    values,
    include,
    sourceRowStart,
    processRowStart,
    processRowEnd,
    width,
    height,
    skip,
  );
}

/** Находит границы долей смесей для части строк бинарным ядром. */
export function traceCompositionContourChunk(
  compositions: Uint16Array,
  compositionOffsets: Uint32Array,
  entityIds: Uint32Array,
  shares: Float64Array,
  sourceRowStart: number,
  processRowStart: number,
  processRowEnd: number,
  width: number,
  height: number,
): KernelContourCompositionChunk {
  return getBinaryMathKernel().contourTraceCompositionChunk(
    compositions,
    compositionOffsets,
    entityIds,
    shares,
    sourceRowStart,
    processRowStart,
    processRowEnd,
    width,
    height,
  );
}

export type KernelPolygonContour = readonly (readonly { x: number; y: number }[])[];

/** Растрирует кольца полигонов в бинарном ядре, проверяя центры ячеек. */
export function rasterizePolygonContours(
  polygons: readonly KernelPolygonContour[],
  width: number,
  height: number,
): KernelContourSpan[] {
  const coordinates: number[] = [];
  const ringOffsets = [0];
  const polygonOffsets = [0];
  for (const polygon of polygons) {
    for (const ring of polygon) {
      if (ring.length < 3) continue;
      for (const point of ring) {
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
          throw new TypeError('Координаты контура должны быть конечными числами');
        }
        coordinates.push(point.x, point.y);
      }
      ringOffsets.push(coordinates.length / 2);
    }
    polygonOffsets.push(ringOffsets.length - 1);
  }
  const spans = getBinaryMathKernel().contourRasterizePolygons({
    coordinates: new Float64Array(coordinates),
    ringOffsets: new Uint32Array(ringOffsets),
    polygonOffsets: new Uint32Array(polygonOffsets),
  }, width, height);
  return normalizeContourSpans(spans, width, height, true);
}

/** Нормализует и обрезает интервалы вызовом бинарного ядра. */
export function normalizeContourSpans(
  spans: readonly KernelContourSpan[],
  width: number,
  height: number,
  alreadyOrdered = false,
): KernelContourSpan[] {
  return cachedUnary(
    normalizedCache,
    spans,
    `${width}:${height}:${alreadyOrdered}`,
    () => getBinaryMathKernel().contourSpansExecute(
      'normalize', spans, [], width, height,
    ),
  );
}

/** Возвращает пересечение двух наборов контурных строк. */
export function intersectContourSpans(
  left: readonly KernelContourSpan[],
  right: readonly KernelContourSpan[],
  width: number,
  height: number,
): KernelContourSpan[] {
  return cachedBinary(
    intersectionCache, left, right, `${width}:${height}`,
    () => getBinaryMathKernel().contourSpansExecute(
      'intersection', left, right, width, height,
    ),
  );
}

/** Объединяет контурные строки без повторных областей. */
export function unionContourSpans(
  left: readonly KernelContourSpan[],
  right: readonly KernelContourSpan[],
  width: number,
  height: number,
): KernelContourSpan[] {
  return cachedBinary(
    unionCache, left, right, `${width}:${height}`,
    () => getBinaryMathKernel().contourSpansExecute(
      'union', left, right, width, height,
    ),
  );
}

/** Вычитает правую область из левой с полуоткрытыми границами. */
export function subtractContourSpans(
  left: readonly KernelContourSpan[],
  right: readonly KernelContourSpan[],
  width: number,
  height: number,
): KernelContourSpan[] {
  return cachedBinary(
    subtractionCache, left, right, `${width}:${height}`,
    () => getBinaryMathKernel().contourSpansExecute(
      'difference', left, right, width, height,
    ),
  );
}

/** Вычисляет граничную окрестность в бинарном ядре. */
export function borderContourSpans(
  spans: readonly KernelContourSpan[],
  width: number,
  height: number,
): KernelContourSpan[] {
  return cachedUnary(
    borderCache, spans, `${width}:${height}`,
    () => getBinaryMathKernel().contourSpansExecute(
      'border', spans, [], width, height,
    ),
  );
}

/** Расширяет контур диском заданного радиуса в бинарном ядре. */
export function offsetContourSpans(
  spans: readonly KernelContourSpan[],
  width: number,
  height: number,
  distance: number,
): KernelContourSpan[] {
  if (!Number.isFinite(distance) || distance < 0) {
    throw new RangeError('Расстояние геометрического смещения должно быть конечным и неотрицательным.');
  }
  return cachedUnary(
    offsetCache, spans, `${width}:${height}:${distance}`,
    () => getBinaryMathKernel().contourSpansExecute(
      'offset', spans, [], width, height, distance,
    ),
  );
}

function sameSpans(
  first: readonly KernelContourSpan[],
  second: readonly KernelContourSpan[],
): boolean {
  return first.length === second.length &&
    first.every((span, index) =>
      span.y === second[index].y &&
      span.start === second[index].start &&
      span.end === second[index].end);
}

/** Строит и кэширует доступные области и равноудалённые полосы контуров. */
export class KernelContourDistanceBands {
  private readonly reachableAreaCache = new Map<number, CachedSpanList>();
  private readonly clippedReachableAreaCache =
    new WeakMap<SpanList, Map<number, CachedSpanList>>();
  private readonly bandsCache =
    new WeakMap<SpanList, Map<string, readonly SpanList[]>>();
  private readonly sources: readonly KernelContourDistanceSource[];

  constructor(
    sources: readonly KernelContourDistanceSource[],
    private readonly width: number,
    private readonly height: number,
  ) {
    for (const source of sources) {
      const additionalDistance = source.additionalDistance ?? 0;
      if (!Number.isFinite(additionalDistance) || additionalDistance < 0) {
        throw new RangeError('Дополнительное расстояние контура должно быть конечным и неотрицательным.');
      }
    }
    this.sources = [...sources].sort(
      (a, b) => (a.additionalDistance ?? 0) - (b.additionalDistance ?? 0),
    );
  }

  reachableArea(distance: number): KernelContourSpan[] {
    if (!Number.isFinite(distance) || distance < 0) return [];
    const cached = this.reachableAreaCache.get(distance);
    if (cached) return cloneSpans(cached);
    let result: KernelContourSpan[] = [];
    for (const source of this.sources) {
      const radius = distance - (source.additionalDistance ?? 0);
      if (radius < 0 || !source.spans.length) continue;
      result = unionContourSpans(
        result,
        offsetContourSpans(source.spans, this.width, this.height, radius),
        this.width,
        this.height,
      );
    }
    const frozen = freezeContourSpans(result);
    this.reachableAreaCache.set(distance, frozen);
    return cloneSpans(frozen);
  }

  /** Возвращает часть доступной области внутри целевого контура. */
  reachableAreaWithin(
    area: readonly KernelContourSpan[],
    distance: number,
  ): KernelContourSpan[] {
    if (!Number.isFinite(distance) || distance < 0) return [];
    const cacheable = immutableSpanLists.has(area as object);
    const cached = cacheable
      ? this.clippedReachableAreaCache.get(area as SpanList)?.get(distance)
      : undefined;
    if (cached) return cloneSpans(cached);
    const result = intersectContourSpans(
      this.reachableArea(distance), area, this.width, this.height,
    );
    if (cacheable) {
      const frozen = rememberSpans(result);
      const byDistance = this.clippedReachableAreaCache.get(area as SpanList) ??
        new Map<number, CachedSpanList>();
      byDistance.set(distance, frozen);
      this.clippedReachableAreaCache.set(area as SpanList, byDistance);
    }
    return result;
  }

  bands(
    area: readonly KernelContourSpan[],
    step: number,
    maximumDistance: number,
  ): KernelContourSpan[][] {
    if (!Number.isFinite(step) || step <= 0) {
      throw new RangeError('Шаг контурных слоёв должен быть конечным и больше нуля.');
    }
    if (!Number.isFinite(maximumDistance) || maximumDistance < 0) {
      throw new RangeError('Максимальное расстояние должно быть конечным и неотрицательным.');
    }
    const cacheKey = `${step}:${maximumDistance}`;
    const cached = this.bandsCache.get(area as SpanList)?.get(cacheKey);
    if (cached) return cached.map(cloneSpans);
    const result: KernelContourSpan[][] = [];
    let previous: SpanList = [];
    for (let distance = 0; distance <= maximumDistance; distance += step) {
      const withinAvailable = this.reachableAreaWithin(area, distance);
      result.push(subtractContourSpans(withinAvailable, previous, this.width, this.height));
      previous = withinAvailable;
      if (sameSpans(withinAvailable, area)) break;
    }
    const remaining = subtractContourSpans(area, previous, this.width, this.height);
    if (remaining.length) result.push(remaining);
    if (immutableSpanLists.has(area as object)) {
      const frozen = result.map((band) => freezeContourSpans(band));
      const byQuery = this.bandsCache.get(area as SpanList) ??
        new Map<string, readonly SpanList[]>();
      byQuery.set(cacheKey, frozen);
      this.bandsCache.set(area as SpanList, byQuery);
    }
    return result.map((band) => band.map((span) => ({ ...span })));
  }
}
