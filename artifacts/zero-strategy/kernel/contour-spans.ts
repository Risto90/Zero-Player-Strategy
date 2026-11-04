export interface KernelContourSpan {
  y: number;
  start: number;
  end: number;
}

export interface KernelContourDistanceSource {
  spans: readonly KernelContourSpan[];
  additionalDistance?: number;
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

/** Создаёт неизменяемые строки, пригодные для повторного использования запросами ядра. */
export function freezeContourSpans(spans: readonly KernelContourSpan[]): SpanList {
  const frozen = Object.freeze(spans.map((span) => Object.freeze({
    y: span.y,
    start: span.start,
    end: span.end,
  })));
  immutableSpanLists.add(frozen);
  return frozen;
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
  if (!immutableSpanLists.has(left as object) || !immutableSpanLists.has(right as object)) return compute();
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

export type KernelPolygonContour = readonly (readonly { x: number; y: number }[])[];

/** Преобразует векторные кольца в строки растра, проверяя центры ячеек. */
export function rasterizePolygonContours(
  polygons: readonly KernelPolygonContour[],
  width: number,
  height: number,
): KernelContourSpan[] {
  const result: KernelContourSpan[] = [];
  for (const polygon of polygons) {
    const edges = polygon.flatMap((ring) => ring.length < 3 ? [] : ring.map((point, index) => ({
      first: point,
      second: ring[(index + 1) % ring.length],
    })));
    if (!edges.length) continue;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const { first, second } of edges) {
      minY = Math.min(minY, first.y, second.y);
      maxY = Math.max(maxY, first.y, second.y);
    }
    for (let y = Math.max(0, Math.floor(minY - 0.5)); y < Math.min(height, Math.ceil(maxY - 0.5)); y += 1) {
      const scanY = y + 0.5;
      const crossings: number[] = [];
      for (const { first, second } of edges) {
        if ((first.y > scanY) === (second.y > scanY)) continue;
        crossings.push(first.x + (scanY - first.y) * (second.x - first.x) / (second.y - first.y));
      }
      crossings.sort((a, b) => a - b);
      for (let index = 1; index < crossings.length; index += 2) {
        const start = Math.max(0, Math.ceil(crossings[index - 1] - 0.5));
        const end = Math.min(width, Math.ceil(crossings[index] - 0.5));
        if (end > start) result.push({ y, start, end });
      }
    }
  }
  return normalizeContourSpans(result, width, height);
}

/** Нормализует строки контуров в упорядоченные неперекрывающиеся интервалы. */
export function normalizeContourSpans(
  spans: readonly KernelContourSpan[],
  width: number,
  height: number,
  alreadyOrdered = false,
): KernelContourSpan[] {
  return cachedUnary(normalizedCache, spans, `${width}:${height}:${alreadyOrdered}`, () => {
    const ordered = spans.flatMap((span) => {
      if (!Number.isInteger(span.y) || span.y < 0 || span.y >= height ||
          !Number.isInteger(span.start) || !Number.isInteger(span.end)) return [];
      const start = Math.max(0, span.start);
      const end = Math.min(width, span.end);
      return end > start ? [{ y: span.y, start, end }] : [];
    });
    if (!alreadyOrdered) ordered.sort((a, b) => a.y - b.y || a.start - b.start);
    const merged: KernelContourSpan[] = [];
    for (const span of ordered) {
      const previous = merged[merged.length - 1];
      if (previous && previous.y === span.y && previous.end >= span.start) {
        previous.end = Math.max(previous.end, span.end);
      } else {
        merged.push({ ...span });
      }
    }
    return merged;
  });
}

/** Возвращает пересечение двух упорядоченных наборов контурных строк. */
export function intersectContourSpans(
  left: readonly KernelContourSpan[],
  right: readonly KernelContourSpan[],
  width: number,
  height: number,
): KernelContourSpan[] {
  return cachedBinary(intersectionCache, left, right, `${width}:${height}`, () => {
    const result: KernelContourSpan[] = [];
    let a = 0, b = 0;
    while (a < left.length && b < right.length) {
      const first = left[a], second = right[b];
      if (first.y < second.y || (first.y === second.y && first.end <= second.start)) {
        a += 1;
        continue;
      }
      if (second.y < first.y || second.end <= first.start) {
        b += 1;
        continue;
      }
      result.push({
        y: first.y,
        start: Math.max(first.start, second.start),
        end: Math.min(first.end, second.end),
      });
      if (first.end <= second.end) a += 1;
      else b += 1;
    }
    return normalizeContourSpans(result, width, height, true);
  });
}

/** Объединяет контурные строки с устранением повторных областей. */
export function unionContourSpans(
  left: readonly KernelContourSpan[],
  right: readonly KernelContourSpan[],
  width: number,
  height: number,
): KernelContourSpan[] {
  return cachedBinary(unionCache, left, right, `${width}:${height}`, () =>
    normalizeContourSpans([...left, ...right], width, height));
}

/** Вычитает правую область из левой, сохраняя полуоткрытые границы интервалов. */
export function subtractContourSpans(
  left: readonly KernelContourSpan[],
  right: readonly KernelContourSpan[],
  width: number,
  height: number,
): KernelContourSpan[] {
  return cachedBinary(subtractionCache, left, right, `${width}:${height}`, () => {
    const result: KernelContourSpan[] = [];
    let index = 0;
    for (const span of left) {
      while (index < right.length && (right[index].y < span.y ||
        (right[index].y === span.y && right[index].end <= span.start))) index += 1;
      let start = span.start;
      for (let cursor = index; cursor < right.length; cursor += 1) {
        const cut = right[cursor];
        if (cut.y !== span.y || cut.start >= span.end) break;
        if (cut.start > start) result.push({ y: span.y, start, end: Math.min(cut.start, span.end) });
        start = Math.max(start, cut.end);
        if (start >= span.end) break;
      }
      if (start < span.end) result.push({ y: span.y, start, end: span.end });
    }
    return normalizeContourSpans(result, width, height, true);
  });
}

/** Вычисляет окрестность по сторонам без включения самой области. */
export function borderContourSpans(
  spans: readonly KernelContourSpan[],
  width: number,
  height: number,
): KernelContourSpan[] {
  return cachedUnary(borderCache, spans, `${width}:${height}`, () => {
    const expanded: KernelContourSpan[] = [];
    for (const span of spans) {
      expanded.push({
        y: span.y,
        start: Math.max(0, span.start - 1),
        end: Math.min(width, span.end + 1),
      });
      if (span.y > 0) expanded.push({ ...span, y: span.y - 1 });
      if (span.y + 1 < height) expanded.push({ ...span, y: span.y + 1 });
    }
    return subtractContourSpans(
      normalizeContourSpans(expanded, width, height),
      spans,
      width,
      height,
    );
  });
}

/** Расширяет контур диском заданного радиуса в пикселях. */
export function offsetContourSpans(
  spans: readonly KernelContourSpan[],
  width: number,
  height: number,
  distance: number,
): KernelContourSpan[] {
  if (!Number.isFinite(distance) || distance < 0) {
    throw new RangeError('Расстояние геометрического смещения должно быть конечным и неотрицательным.');
  }
  return cachedUnary(offsetCache, spans, `${width}:${height}:${distance}`, () => {
    if (distance === 0) return normalizeContourSpans(spans, width, height);
    const result: KernelContourSpan[] = [];
    const rows = Math.floor(distance);
    const squared = distance * distance;
    for (let dy = -rows; dy <= rows; dy += 1) {
      const dx = Math.floor(Math.sqrt(Math.max(0, squared - dy * dy)));
      for (const span of spans) {
        const y = span.y + dy;
        if (y < 0 || y >= height) continue;
        const start = Math.max(0, span.start - dx);
        const end = Math.min(width, span.end + dx);
        if (end > start) result.push({ y, start, end });
      }
    }
    return normalizeContourSpans(result, width, height);
  });
}

type ClippedSpanIndex = {
  spans: readonly KernelContourSpan[];
  rows: Map<number, KernelContourSpan[]>;
  firstRow: number;
  lastRow: number;
};

function indexClippedSpans(spans: readonly KernelContourSpan[], height: number): ClippedSpanIndex {
  const rows = new Map<number, KernelContourSpan[]>();
  let firstRow = height;
  let lastRow = -1;
  for (const span of spans) {
    const row = rows.get(span.y) ?? [];
    row.push(span);
    rows.set(span.y, row);
    firstRow = Math.min(firstRow, span.y);
    lastRow = Math.max(lastRow, span.y);
  }
  for (const row of rows.values()) row.sort((a, b) => a.start - b.start);
  return { spans, rows, firstRow, lastRow };
}

/** Поддерживает нормализованное объединение контуров добавлением отрезков по строкам. */
class ContourSpanUnion {
  private readonly rows = new Map<number, KernelContourSpan[]>();
  private currentSize = 0;

  get size(): number {
    return this.currentSize;
  }

  add(spans: readonly KernelContourSpan[]): void {
    for (const span of spans) this.addSpan(span);
  }

  toSpans(): KernelContourSpan[] {
    const result: KernelContourSpan[] = [];
    const ys = [...this.rows.keys()].sort((a, b) => a - b);
    for (const y of ys) result.push(...(this.rows.get(y) ?? []));
    return result;
  }

  private addSpan(span: KernelContourSpan): void {
    const row = this.rows.get(span.y) ?? [];
    let low = 0;
    let high = row.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (row[middle].end < span.start) low = middle + 1;
      else high = middle;
    }

    let start = span.start;
    let end = span.end;
    let last = low;
    while (last < row.length && row[last].start <= end) {
      const existing = row[last];
      start = Math.min(start, existing.start);
      end = Math.max(end, existing.end);
      this.currentSize -= existing.end - existing.start;
      last += 1;
    }
    row.splice(low, last - low, { y: span.y, start, end });
    this.currentSize += end - start;
    this.rows.set(span.y, row);
  }
}

/** Расширяет контур только внутри заданной области, не создавая внешний растр расстояний. */
function offsetContourSpansWithin(
  spans: readonly KernelContourSpan[],
  clipIndex: ClippedSpanIndex,
  width: number,
  height: number,
  distance: number,
): KernelContourSpan[] {
  if (distance === 0) return intersectContourSpans(spans, clipIndex.spans, width, height);
  const { rows: clipRows, firstRow: firstClipRow, lastRow: lastClipRow } = clipIndex;
  if (lastClipRow < firstClipRow) return [];

  const rows = Math.floor(distance);
  const squared = distance * distance;
  const result: KernelContourSpan[] = [];
  for (const span of spans) {
    const firstDy = Math.max(-rows, firstClipRow - span.y);
    const lastDy = Math.min(rows, lastClipRow - span.y);
    for (let dy = firstDy; dy <= lastDy; dy += 1) {
      const y = span.y + dy;
      const clips = clipRows.get(y);
      if (!clips) continue;
      const dx = Math.floor(Math.sqrt(Math.max(0, squared - dy * dy)));
      const expandedStart = Math.max(0, span.start - dx);
      const expandedEnd = Math.min(width, span.end + dx);
      let low = 0;
      let high = clips.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (clips[middle].end <= expandedStart) low = middle + 1;
        else high = middle;
      }
      for (let clipIndex = low; clipIndex < clips.length; clipIndex += 1) {
        const clip = clips[clipIndex];
        if (clip.start >= expandedEnd) break;
        const start = Math.max(expandedStart, clip.start);
        const end = Math.min(expandedEnd, clip.end);
        if (end > start) result.push({ y, start, end });
      }
    }
  }
  return normalizeContourSpans(result, width, height);
}

/** Строит и кэширует доступные области и равноудалённые полосы контуров. */
export class KernelContourDistanceBands {
  private readonly reachableAreaCache = new Map<number, CachedSpanList>();
  private readonly clippedReachableAreaCache = new WeakMap<SpanList, Map<number, CachedSpanList>>();
  private readonly bandsCache = new WeakMap<SpanList, Map<string, readonly SpanList[]>>();

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

  private readonly sources: readonly KernelContourDistanceSource[];

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

  /** Строит только часть единого контура, попавшую в целевую область. */
  reachableAreaWithin(area: readonly KernelContourSpan[], distance: number): KernelContourSpan[] {
    if (!Number.isFinite(distance) || distance < 0) return [];
    const clipIndex = indexClippedSpans(area, this.height);
    return cloneSpans(this.computeReachableAreaWithin(area as SpanList, distance, clipIndex));
  }

  private computeReachableAreaWithin(
    area: SpanList,
    distance: number,
    clipIndex: ClippedSpanIndex,
  ): SpanList {
    const cacheable = immutableSpanLists.has(area as object);
    const cached = cacheable ? this.clippedReachableAreaCache.get(area)?.get(distance) : undefined;
    if (cached) return cached;
    const result = new ContourSpanUnion();
    const areaSize = contourSpanSize(area);
    for (const source of this.sources) {
      const radius = distance - (source.additionalDistance ?? 0);
      if (radius < 0 || !source.spans.length) continue;
      result.add(offsetContourSpansWithin(source.spans, clipIndex, this.width, this.height, radius));
      if (result.size === areaSize) break;
    }
    const frozen = freezeContourSpans(result.toSpans());
    if (cacheable) {
      const byDistance = this.clippedReachableAreaCache.get(area) ?? new Map<number, CachedSpanList>();
      byDistance.set(distance, frozen);
      this.clippedReachableAreaCache.set(area, byDistance);
    }
    return frozen;
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
    const areaSize = contourSpanSize(area);
    const clipIndex = indexClippedSpans(area, this.height);
    for (let distance = 0; distance <= maximumDistance; distance += step) {
      const withinAvailable = this.computeReachableAreaWithin(area, distance, clipIndex);
      result.push(subtractContourSpans(withinAvailable, previous, this.width, this.height));
      previous = withinAvailable;
      if (contourSpanSize(withinAvailable) === areaSize) break;
    }
    const remaining = subtractContourSpans(area, previous, this.width, this.height);
    if (remaining.length) result.push(remaining);
    if (immutableSpanLists.has(area as object)) {
      const frozen = result.map((band) => freezeContourSpans(band));
      const byQuery = this.bandsCache.get(area as SpanList) ?? new Map<string, readonly SpanList[]>();
      byQuery.set(cacheKey, frozen);
      this.bandsCache.set(area as SpanList, byQuery);
    }
    return result.map(cloneSpans);
  }
}

function contourSpanSize(spans: readonly KernelContourSpan[]): number {
  return spans.reduce((size, span) => size + span.end - span.start, 0);
}
