import { MAP_HEIGHT, MAP_WIDTH } from './config';
import { linkRings, type Ring } from './zones';
import {
  borderContourSpans,
  freezeContourSpans,
  intersectContourSpans,
  KernelContourDistanceBands,
  normalizeContourSpans,
  offsetContourSpans,
  subtractContourSpans,
  unionContourSpans,
} from '../kernel/contour-spans';

export interface ContourBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ContourSpan {
  y: number;
  start: number;
  end: number;
}

export interface ContourChange {
  revision: number;
  bounds: ContourBounds;
  layers: readonly ContourLayerName[] | null;
}

interface ValueSpan extends ContourSpan {
  value: number;
}

interface CachedSelection {
  area: ContourArea;
  bounds: ContourBounds;
  dirtyRows: Map<number, { x0: number; x1: number }>;
}

/** Непрерывная кисть использует точное IEEE-754 сравнение без искусственного допуска. */
export const CONTINUOUS_CONTOUR_EPSILON = 0;

/**
 * Площадь карты хранится интервалами контурных строк, а не списком ячеек.
 * Геометрические операции должны работать со spans, не разворачивая области в пиксели.
 */
export class ContourArea {
  readonly spans: readonly ContourSpan[];
  readonly size: number;

  constructor(spans: readonly ContourSpan[] = [], alreadyOrdered = false) {
    this.spans = freezeContourSpans(normalizeContourSpans(spans, MAP_WIDTH, MAP_HEIGHT, alreadyOrdered));
    this.size = this.spans.reduce((sum, span) => sum + span.end - span.start, 0);
  }

  static rectangle(bounds: ContourBounds): ContourArea {
    const spans: ContourSpan[] = [];
    for (let y = Math.max(0, bounds.y0); y <= Math.min(MAP_HEIGHT - 1, bounds.y1); y += 1) {
      spans.push({ y, start: Math.max(0, bounds.x0), end: Math.min(MAP_WIDTH, bounds.x1 + 1) });
    }
    return new ContourArea(spans);
  }

  static pixels(pixels: Iterable<number>): ContourArea {
    const spans: ContourSpan[] = [];
    for (const pixel of pixels) {
      const x = pixel % MAP_WIDTH;
      spans.push({ y: Math.floor(pixel / MAP_WIDTH), start: x, end: x + 1 });
    }
    return new ContourArea(spans);
  }

  static fromBinaryMask(
    mask: Uint8Array,
    bounds: ContourBounds = { x0: 0, y0: 0, x1: MAP_WIDTH - 1, y1: MAP_HEIGHT - 1 },
  ): ContourArea {
    const spans: ContourSpan[] = [];
    const x0 = Math.max(0, bounds.x0);
    const x1 = Math.min(MAP_WIDTH - 1, bounds.x1);
    for (let y = Math.max(0, bounds.y0); y <= Math.min(MAP_HEIGHT - 1, bounds.y1); y += 1) {
      const row = y * MAP_WIDTH;
      const rowEnd = row + x1 + 1;
      let cursor = row + x0;
      while (cursor < rowEnd) {
        const start = mask.indexOf(1, cursor);
        if (start < 0 || start >= rowEnd) break;
        const end = mask.indexOf(0, start);
        const stop = end < 0 || end > rowEnd ? rowEnd : end;
        spans.push({ y, start: start - row, end: stop - row });
        cursor = stop;
      }
    }
    return new ContourArea(spans);
  }

  static fromMask(
    mask: ArrayLike<number>,
    bounds: ContourBounds = { x0: 0, y0: 0, x1: MAP_WIDTH - 1, y1: MAP_HEIGHT - 1 },
    accepts: (value: number, pixel: number) => boolean = () => true,
  ): ContourArea {
    // Это адаптер растровой маски на границе API, а не способ поиска областей:
    // после преобразования выбор, пересечения и заливка должны работать только с интервалами контура.
    const spans: ContourSpan[] = [];
    const x0 = Math.max(0, bounds.x0);
    const x1 = Math.min(MAP_WIDTH - 1, bounds.x1);
    for (let y = Math.max(0, bounds.y0); y <= Math.min(MAP_HEIGHT - 1, bounds.y1); y += 1) {
      const row = y * MAP_WIDTH;
      let start = -1;
      for (let x = x0; x <= x1 + 1; x += 1) {
        const pixel = row + x;
        const value = mask[pixel] ?? 0;
        const included = x <= x1 && value > 0 && accepts(value, pixel);
        if (included && start < 0) start = x;
        else if (!included && start >= 0) {
          spans.push({ y, start, end: x });
          start = -1;
        }
      }
    }
    return new ContourArea(spans);
  }

  /**
   * Импортирует сохранённые ортогональные кольца в интервальный контур.
   * Сканируются только вертикальные рёбра и строки, которые они пересекают;
   * внутренняя область не разворачивается в список пикселей.
   */
  static fromRings(rings: readonly Ring[]): ContourArea {
    const crossings = new Map<number, number[]>();
    for (const ring of rings) {
      if (ring.length < 6 || ring.length % 2 !== 0) continue;
      const count = ring.length / 2;
      for (let index = 0; index < count; index += 1) {
        const next = (index + 1) % count;
        const x0 = ring[index * 2], y0 = ring[index * 2 + 1];
        const x1 = ring[next * 2], y1 = ring[next * 2 + 1];
        if (x0 !== x1 || y0 === y1) continue;
        const fromY = Math.max(0, Math.min(y0, y1));
        const toY = Math.min(MAP_HEIGHT, Math.max(y0, y1));
        for (let y = fromY; y < toY; y += 1) {
          const row = crossings.get(y) ?? [];
          row.push(x0);
          crossings.set(y, row);
        }
      }
    }
    const spans: ContourSpan[] = [];
    for (const [y, row] of crossings) {
      row.sort((a, b) => a - b);
      for (let index = 1; index < row.length; index += 2) {
        const start = Math.max(0, row[index - 1]);
        const end = Math.min(MAP_WIDTH, row[index]);
        if (end > start) spans.push({ y, start, end });
      }
    }
    return new ContourArea(spans);
  }

  static integerCircle(
    cx: number,
    cy: number,
    radius: number,
    bounds: ContourBounds = { x0: 0, y0: 0, x1: MAP_WIDTH - 1, y1: MAP_HEIGHT - 1 },
  ): ContourArea {
    if (radius < 0) return new ContourArea();
    const spans: ContourSpan[] = [];
    const y0 = Math.max(0, bounds.y0, Math.ceil(cy - radius));
    const y1 = Math.min(MAP_HEIGHT - 1, bounds.y1, Math.floor(cy + radius));
    const x0 = Math.max(0, bounds.x0);
    const x1 = Math.min(MAP_WIDTH - 1, bounds.x1);
    for (let y = y0; y <= y1; y += 1) {
      const dy = y - cy;
      const halfWidthSquared = radius * radius - dy * dy;
      if (halfWidthSquared < 0) continue;
      const halfWidth = Math.sqrt(halfWidthSquared);
      let start = Math.max(x0, Math.ceil(cx - halfWidth));
      let end = Math.min(x1 + 1, Math.floor(cx + halfWidth) + 1);
      while (start < end && Math.hypot(start - cx, dy) > radius) start += 1;
      while (end > start && Math.hypot(end - 1 - cx, dy) > radius) end -= 1;
      if (end > start) spans.push({ y, start, end });
    }
    return new ContourArea(spans, true);
  }

  /**
   * Координаты кисти непрерывные; область — замкнутый круг, проверяется центр
   * каждой ячейки, а граничное равенство включено без допуска epsilon.
   */
  static circle(cx: number, cy: number, radius: number): ContourArea {
    const spans: ContourSpan[] = [];
    for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(MAP_HEIGHT - 1, Math.ceil(cy + radius)); y += 1) {
      const dy = y + 0.5 - cy;
      const halfWidthSquared = radius * radius - dy * dy;
      if (halfWidthSquared < 0) continue;
      const halfWidth = Math.sqrt(halfWidthSquared);
      let start = Math.max(0, Math.ceil(cx - halfWidth - 0.5) - 1);
      let end = Math.min(MAP_WIDTH, Math.floor(cx + halfWidth - 0.5) + 2);
      // На границе круга сохраняется исходное сравнение без округлительной погрешности корня.
      while (start < end && (start + 0.5 - cx) ** 2 + dy * dy > radius * radius) start += 1;
      while (end > start && (end - 0.5 - cx) ** 2 + dy * dy > radius * radius) end -= 1;
      if (end > start) spans.push({ y, start, end });
    }
    return new ContourArea(spans);
  }

  get bounds(): ContourBounds {
    if (!this.spans.length) return { x0: 0, y0: 0, x1: -1, y1: -1 };
    let x0 = MAP_WIDTH, x1 = -1;
    for (const span of this.spans) {
      x0 = Math.min(x0, span.start);
      x1 = Math.max(x1, span.end - 1);
    }
    return { x0, x1, y0: this.spans[0].y, y1: this.spans[this.spans.length - 1].y };
  }

  contains(pixel: number): boolean {
    if (!Number.isInteger(pixel) || pixel < 0 || pixel >= MAP_WIDTH * MAP_HEIGHT) return false;
    const y = Math.floor(pixel / MAP_WIDTH), x = pixel % MAP_WIDTH;
    let low = 0, high = this.spans.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const span = this.spans[middle];
      if (span.y < y || (span.y === y && span.end <= x)) low = middle + 1;
      else if (span.y > y || span.start > x) high = middle - 1;
      else return true;
    }
    return false;
  }

  intersect(other: ContourArea): ContourArea {
    return new ContourArea(intersectContourSpans(this.spans, other.spans, MAP_WIDTH, MAP_HEIGHT), true);
  }

  /** XOR дискретных областей с той же полуоткрытой семантикой интервалов. */
  symmetricDifference(other: ContourArea): ContourArea {
    return this.subtract(other).union(other.subtract(this));
  }

  xor(other: ContourArea): ContourArea {
    return this.symmetricDifference(other);
  }

  union(other: ContourArea): ContourArea {
    return new ContourArea(unionContourSpans(this.spans, other.spans, MAP_WIDTH, MAP_HEIGHT), true);
  }

  subtract(other: ContourArea): ContourArea {
    return new ContourArea(subtractContourSpans(this.spans, other.spans, MAP_WIDTH, MAP_HEIGHT), true);
  }

  /** Заменяет только заданное окно, сохраняя геометрию вне него. */
  replaceRegion(bounds: ContourBounds, replacement: readonly ContourSpan[]): ContourArea {
    const x0 = Math.max(0, bounds.x0);
    const xEnd = Math.min(MAP_WIDTH, bounds.x1 + 1);
    const y0 = Math.max(0, bounds.y0);
    const y1 = Math.min(MAP_HEIGHT - 1, bounds.y1);
    if (xEnd <= x0 || y1 < y0) return this;
    const spans: ContourSpan[] = [];
    for (const span of this.spans) {
      if (span.y < y0 || span.y > y1 || span.end <= x0 || span.start >= xEnd) {
        spans.push(span);
        continue;
      }
      if (span.start < x0) spans.push({ y: span.y, start: span.start, end: x0 });
      if (span.end > xEnd) spans.push({ y: span.y, start: xEnd, end: span.end });
    }
    for (const span of replacement) {
      if (span.y < y0 || span.y > y1) continue;
      const start = Math.max(x0, span.start);
      const end = Math.min(xEnd, span.end);
      if (end > start) spans.push({ y: span.y, start, end });
    }
    return new ContourArea(spans);
  }

  /** Отсекает область заданным прямоугольником карты. */
  clip(bounds: ContourBounds): ContourArea {
    return this.intersect(ContourArea.rectangle(bounds));
  }

  /** Разбивает область на часть внутри и часть вне другой области. */
  split(other: ContourArea): { inside: ContourArea; outside: ContourArea } {
    return { inside: this.intersect(other), outside: this.subtract(other) };
  }

  /** Возвращает площадь в дискретных ячейках карты. */
  area(): number {
    return this.size;
  }

  /** Проверяет пересечение без построения промежуточного результата. */
  intersects(other: ContourArea): boolean {
    let a = 0, b = 0;
    while (a < this.spans.length && b < other.spans.length) {
      const left = this.spans[a], right = other.spans[b];
      if (left.y < right.y || (left.y === right.y && left.end <= right.start)) a += 1;
      else if (right.y < left.y || right.end <= left.start) b += 1;
      else return true;
    }
    return false;
  }

  /** Смежность по стороне; простое перекрытие не считается смежностью. */
  isAdjacentTo(other: ContourArea): boolean {
    return this.border().intersects(other) || other.border().intersects(this);
  }

  /** Записывает заливку прямо в массив слоя; интервалы не разворачиваются заранее. */
  fill<T extends Uint8Array | Uint16Array | Uint32Array | Int32Array | Float32Array>(
    target: T,
    value: number,
  ): void {
    for (const span of this.spans) target.fill(value, span.y * MAP_WIDTH + span.start, span.y * MAP_WIDTH + span.end);
  }

  forEachPixel(visit: (pixel: number) => void): void {
    for (const span of this.spans) {
      const row = span.y * MAP_WIDTH;
      for (let x = span.start; x < span.end; x += 1) visit(row + x);
    }
  }

  /** Перебирает пиксели в порядке контурных строк без промежуточного массива. */
  *[Symbol.iterator](): Generator<number> {
    for (const span of this.spans) {
      const row = span.y * MAP_WIDTH;
      for (let x = span.start; x < span.end; x += 1) yield row + x;
    }
  }

  /** Соседство по стороне: диагональное касание не соединяет территории. */
  border(): ContourArea {
    return new ContourArea(borderContourSpans(this.spans, MAP_WIDTH, MAP_HEIGHT), true);
  }

  /** Возвращает область вместе с восемью соседними направлениями каждого пикселя. */
  neighbourhood8(): ContourArea {
    const spans: ContourSpan[] = [];
    for (const span of this.spans) {
      const start = Math.max(0, span.start - 1);
      const end = Math.min(MAP_WIDTH, span.end + 1);
      if (span.y > 0) spans.push({ y: span.y - 1, start, end });
      spans.push({ y: span.y, start, end });
      if (span.y + 1 < MAP_HEIGHT) spans.push({ y: span.y + 1, start, end });
    }
    return new ContourArea(spans);
  }

  /** Геометрическое смещение контура диском заданного радиуса в пикселях. */
  offset(distance: number): ContourArea {
    if (!(distance > 0) || !Number.isFinite(distance)) return this;
    return new ContourArea(offsetContourSpans(this.spans, MAP_WIDTH, MAP_HEIGHT, distance), true);
  }

  components(): ContourArea[] {
    const parent = this.spans.map((_, index) => index);
    const root = (index: number): number => {
      while (parent[index] !== index) {
        parent[index] = parent[parent[index]];
        index = parent[index];
      }
      return index;
    };
    let previous: number[] = [];
    let current: number[] = [];
    let y = -2;
    for (let index = 0; index < this.spans.length; index += 1) {
      const span = this.spans[index];
      if (span.y !== y) {
        previous = span.y === y + 1 ? current : [];
        current = [];
        y = span.y;
      }
      for (const otherIndex of previous) {
        const other = this.spans[otherIndex];
        if (other.start >= span.end) break;
        if (other.end > span.start) parent[root(index)] = root(otherIndex);
      }
      current.push(index);
    }
    const groups = new Map<number, ContourSpan[]>();
    this.spans.forEach((span, index) => {
      const id = root(index);
      const group = groups.get(id) ?? [];
      group.push(span);
      groups.set(id, group);
    });
    return [...groups.values()].map((spans) => new ContourArea(spans));
  }

  /** Замкнутые кольца строятся только по периметру, без обхода внутренних точек. */
  rings(): Ring[] {
    const rows = new Map<number, ContourSpan[]>();
    for (const span of this.spans) {
      const row = rows.get(span.y) ?? [];
      row.push(span);
      rows.set(span.y, row);
    }
    const codes: number[] = [];
    const vertexWidth = MAP_WIDTH + 1;
    for (const [y, spans] of rows) {
      const row = new ContourArea(spans);
      const above = new ContourArea((rows.get(y - 1) ?? []).map((span) => ({ ...span, y })));
      const below = new ContourArea((rows.get(y + 1) ?? []).map((span) => ({ ...span, y })));
      for (const span of row.subtract(above).spans) {
        for (let x = span.start; x < span.end; x += 1) codes.push((y * vertexWidth + x) * 4);
      }
      for (const span of row.subtract(below).spans) {
        for (let x = span.start; x < span.end; x += 1) codes.push(((y + 1) * vertexWidth + x + 1) * 4 + 2);
      }
      for (const span of spans) {
        codes.push((y * vertexWidth + span.end) * 4 + 1);
        codes.push(((y + 1) * vertexWidth + span.start) * 4 + 3);
      }
    }
    return linkRings(codes);
  }
}

/** Постоянный индекс контуров скалярного слоя с локальным обновлением строк. */
export interface ContourDistanceSource {
  area: ContourArea;
  additionalDistance?: number;
}

/**
 * Пакетное разбиение областей на точные евклидовы дистанционные контуры.
 * Расстояния вычисляются от пикселей исходных множеств; игровые множители
 * и правила выбора слоёв остаются за пределами геометрического ядра.
 */
export class ContourDistanceBands {
  private readonly kernel: KernelContourDistanceBands;

  constructor(sources: readonly ContourDistanceSource[]) {
    this.kernel = new KernelContourDistanceBands(
      sources.map((source) => ({
        spans: source.area.spans,
        additionalDistance: source.additionalDistance,
      })),
      MAP_WIDTH,
      MAP_HEIGHT,
    );
  }

  /** Адаптирует доступный контур ядра к игровому типу площади. */
  reachableArea(distance: number): ContourArea {
    return new ContourArea(this.kernel.reachableArea(distance), true);
  }

  /** Строит область до пороговой дистанции сразу внутри переданного контура. */
  reachableAreaWithin(area: ContourArea, distance: number): ContourArea {
    return new ContourArea(this.kernel.reachableAreaWithin(area.spans, distance), true);
  }

  /** Возвращает игровые площади для равноудалённых полос ядра. */
  bands(area: ContourArea, step: number, maximumDistance: number): ContourArea[] {
    return this.kernel.bands(area.spans, step, maximumDistance)
      .map((spans) => new ContourArea(spans, true));
  }
}

export class ScalarContourLayer {
  private readonly rows = new Map<number, readonly ValueSpan[]>();
  private readonly selections = new Map<string, CachedSelection>();
  private readonly predicateIds = new WeakMap<(value: number) => boolean, number>();
  private nextPredicateId = 1;

  constructor(private readonly source: () => ArrayLike<number>) {}

  invalidate(y0 = 0, y1 = MAP_HEIGHT - 1, x0 = 0, x1 = MAP_WIDTH - 1): void {
    for (let y = y0; y <= y1; y += 1) this.rows.delete(y);
    for (const cached of this.selections.values()) {
      if (cached.bounds.y0 > y1 || cached.bounds.y1 < y0 ||
        cached.bounds.x0 > x1 || cached.bounds.x1 < x0) continue;
      const affectedX0 = Math.max(cached.bounds.x0, x0);
      const affectedX1 = Math.min(cached.bounds.x1, x1);
      for (let y = Math.max(cached.bounds.y0, y0); y <= Math.min(cached.bounds.y1, y1); y += 1) {
        const previous = cached.dirtyRows.get(y);
        cached.dirtyRows.set(y, previous
          ? { x0: Math.min(previous.x0, affectedX0), x1: Math.max(previous.x1, affectedX1) }
          : { x0: affectedX0, x1: affectedX1 });
      }
    }
  }

  row(y: number): readonly ValueSpan[] {
    let spans = this.rows.get(y);
    if (spans) return spans;
    const values = this.source();
    const result: ValueSpan[] = [];
    const row = y * MAP_WIDTH;
    let start = 0, value = values[row];
    for (let x = 1; x <= MAP_WIDTH; x += 1) {
      const next = x < MAP_WIDTH ? values[row + x] : NaN;
      if (next === value) continue;
      result.push({ y, start, end: x, value });
      start = x;
      value = next;
    }
    spans = result;
    this.rows.set(y, spans);
    return spans;
  }

  select(accept: (value: number) => boolean, bounds: ContourBounds, cacheKey?: string): ContourArea {
    let queryId: string;
    if (cacheKey === undefined) {
      let predicateId = this.predicateIds.get(accept);
      if (predicateId === undefined) {
        predicateId = this.nextPredicateId++;
        this.predicateIds.set(accept, predicateId);
      }
      queryId = `predicate:${predicateId}`;
    } else {
      queryId = `key:${cacheKey}`;
    }
    const key = `${queryId}:${bounds.x0}:${bounds.y0}:${bounds.x1}:${bounds.y1}`;
    const cached = this.selections.get(key);
    if (cached) {
      for (const [y, dirty] of cached.dirtyRows) {
        const updated = this.selectRow(accept, y, dirty.x0, dirty.x1);
        cached.area = cached.area.replaceRegion({ x0: dirty.x0, x1: dirty.x1, y0: y, y1: y }, updated);
      }
      cached.dirtyRows.clear();
      this.selections.delete(key);
      this.selections.set(key, cached);
      return cached.area;
    }
    const spans: ContourSpan[] = [];
    for (let y = Math.max(0, bounds.y0); y <= Math.min(MAP_HEIGHT - 1, bounds.y1); y += 1) {
      spans.push(...this.selectRow(accept, y, bounds.x0, bounds.x1));
    }
    const area = new ContourArea(spans);
    if (this.selections.size >= 64) this.selections.delete(this.selections.keys().next().value!);
    this.selections.set(key, { area, bounds: { ...bounds }, dirtyRows: new Map() });
    return area;
  }

  private selectRow(
    accept: (value: number) => boolean,
    y: number,
    x0: number,
    x1: number,
  ): ContourSpan[] {
    const startX = Math.max(0, x0);
    const endX = Math.min(MAP_WIDTH, x1 + 1);
    if (endX <= startX) return [];
    const spans: ContourSpan[] = [];
    for (const span of this.row(y)) {
      if (span.start >= endX) break;
      if (span.end <= startX || !accept(span.value)) continue;
      spans.push({ y, start: Math.max(startX, span.start), end: Math.min(endX, span.end) });
    }
    return spans;
  }
}

export type ContourLayerName = 'land' | 'owner' | 'elevation' | 'depth' | 'humidity' | 'temperature' | 'drainage' |
  'density' | 'culture' | 'religion' | 'humanOrigins' | 'rivers' | 'water';

export interface ClimateContour {
  humidity: number;
  temperature: number;
  drainage: number;
  area: ContourArea;
}

interface ClimateRowGroup {
  humidity: number;
  temperature: number;
  drainage: number;
  spans: ContourSpan[];
}

interface ClimateQueryCache {
  area: ContourArea;
  queryRows: Map<number, readonly ContourSpan[]>;
  rowGroups: Map<number, Map<string, ContourSpan[]>>;
  regions: Map<string, ClimateContour>;
  dirtyRows: Map<number, { x0: number; x1: number }>;
  output: ClimateContour[];
}

function climateGroupKey(humidity: number, temperature: number, drainage: number): string {
  return `${humidity}:${temperature}:${drainage}`;
}

function sameContourArea(left: ContourArea, right: ContourArea): boolean {
  if (left.size !== right.size || left.spans.length !== right.spans.length) return false;
  return left.spans.every((span, index) => {
    const other = right.spans[index];
    return span.y === other.y && span.start === other.start && span.end === other.end;
  });
}

function contourAreaFingerprint(area: ContourArea): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const span of area.spans) {
    first = Math.imul(first ^ span.y, 0x01000193);
    first = Math.imul(first ^ span.start, 0x01000193);
    first = Math.imul(first ^ span.end, 0x01000193);
    second = Math.imul(second ^ (span.y + 0x7ed55d16), 0x85ebca6b);
    second = Math.imul(second ^ (span.start + 0xc2b2ae35), 0x85ebca6b);
    second = Math.imul(second ^ (span.end + 0x27d4eb2f), 0x85ebca6b);
  }
  return `${area.size}:${area.spans.length}:${first >>> 0}:${second >>> 0}`;
}

function queryRows(area: ContourArea): Map<number, readonly ContourSpan[]> {
  const rows = new Map<number, ContourSpan[]>();
  for (const span of area.spans) {
    const row = rows.get(span.y) ?? [];
    row.push(span);
    rows.set(span.y, row);
  }
  return rows;
}

function intersectContourRows(
  left: readonly ContourSpan[],
  right: readonly ContourSpan[],
): ContourSpan[] {
  const result: ContourSpan[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const a = left[leftIndex];
    const b = right[rightIndex];
    const start = Math.max(a.start, b.start);
    const end = Math.min(a.end, b.end);
    if (end > start) result.push({ y: a.y, start, end });
    if (a.end <= b.end) leftIndex += 1;
    else rightIndex += 1;
  }
  return result;
}

function mergeDirtyRange(
  dirtyRows: Map<number, { x0: number; x1: number }>,
  y: number,
  x0: number,
  x1: number,
): void {
  if (x1 < x0) return;
  const previous = dirtyRows.get(y);
  dirtyRows.set(y, previous
    ? { x0: Math.min(previous.x0, x0), x1: Math.max(previous.x1, x1) }
    : { x0, x1 });
}

/**
 * Растры — точное совместимое зеркало слоёв; геометрия и пересечения запрашиваются через контуры.
 * При изменении карты инвалидируются только изменённые строки — полный обход растра в каждом ходе
 * уничтожает смысл индекса контуров и недопустим как замена этим запросам.
 */
export class MapContours {
  private readonly layers = new Map<ContourLayerName, ScalarContourLayer>();
  private readonly changeListeners = new Set<(change: ContourChange) => void>();
  private readonly climateQueryBuckets = new Map<string, ClimateQueryCache[]>();
  private readonly climateQueryOrder: ClimateQueryCache[] = [];
  private knownVersion = -1;
  private changeRevision = 0;
  private climateRegionArea: ContourArea | null = null;
  private climateRegionIds: Int32Array | null = null;
  private climateMapArea: ContourArea | null = null;
  private globalClimateCache: ClimateQueryCache | null = null;
  private readonly emptyArea = new ContourArea();

  constructor(
    private readonly source: (name: ContourLayerName) => ArrayLike<number>,
    private readonly version: () => number,
  ) {}

  layer(name: ContourLayerName): ScalarContourLayer {
    this.synchronize();
    let layer = this.layers.get(name);
    if (!layer) {
      layer = new ScalarContourLayer(() => this.source(name));
      this.layers.set(name, layer);
    }
    return layer;
  }

  synchronize(): void {
    if (this.knownVersion !== this.version()) {
      for (const layer of this.layers.values()) layer.invalidate();
      this.climateQueryBuckets.clear();
      this.climateQueryOrder.length = 0;
      this.climateRegionArea = null;
      this.climateRegionIds = null;
      this.globalClimateCache = null;
      this.knownVersion = this.version();
    }
  }

  changed(bounds: ContourBounds, names?: readonly ContourLayerName[]): void {
    const changedBounds = {
      x0: Math.max(0, Math.min(MAP_WIDTH - 1, bounds.x0)),
      y0: Math.max(0, Math.min(MAP_HEIGHT - 1, bounds.y0)),
      x1: Math.max(-1, Math.min(MAP_WIDTH - 1, bounds.x1)),
      y1: Math.max(-1, Math.min(MAP_HEIGHT - 1, bounds.y1)),
    };
    for (const [name, layer] of this.layers) {
      if (!names || names.includes(name)) {
        layer.invalidate(changedBounds.y0, changedBounds.y1, changedBounds.x0, changedBounds.x1);
      }
    }
    const climateChanged = !names || names.some((name) =>
      ['humidity', 'temperature', 'drainage'].includes(name));
    const landChanged = !names || names.includes('land');
    if (climateChanged) this.markClimateQueriesDirty(changedBounds);
    if (climateChanged || landChanged) {
      this.climateRegionIds = null;
    }
    this.knownVersion = this.version();
    const event: ContourChange = {
      revision: ++this.changeRevision,
      bounds: changedBounds,
      layers: names ? [...new Set(names)] : null,
    };
    for (const listener of this.changeListeners) listener(event);
  }

  /** Подписывается на локальные изменения геометрии без ведения полного журнала карты. */
  subscribeChanges(listener: (change: ContourChange) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  climateRegions(): readonly ClimateContour[] {
    const land = this.layer('land').select((value) => value === 1,
      { x0: 0, y0: 0, x1: MAP_WIDTH - 1, y1: MAP_HEIGHT - 1 }, 'land');
    if (this.climateRegionArea && !sameContourArea(this.climateRegionArea, land)) {
      this.retargetClimateQuery(this.climateRegionArea, land);
    }
    this.climateRegionArea = land;
    return this.climateIntersections(land);
  }

  climateRegionAt(pixel: number): number {
    const regions = this.climateRegions();
    if (!this.climateRegionIds) {
      this.climateRegionIds = new Int32Array(MAP_WIDTH * MAP_HEIGHT).fill(-1);
      regions.forEach((region, id) => {
        for (const span of region.area.spans) {
          const row = span.y * MAP_WIDTH;
          this.climateRegionIds!.fill(id, row + span.start, row + span.end);
        }
      });
    }
    return this.climateRegionIds[pixel];
  }

  /** Возвращает пересечение климатических контуров карты с указанной областью. */
  climateIntersections(area: ContourArea): ClimateContour[] {
    this.layer('humidity');
    this.layer('temperature');
    this.layer('drainage');
    let cached = this.findClimateQuery(area);
    if (cached) {
      this.touchClimateQuery(cached);
      this.refreshClimateQuery(cached);
      return cached.output;
    }

    const mapQuery = this.globalClimateQuery();
    if (sameContourArea(area, mapQuery.area)) return mapQuery.output;
    const rows = queryRows(area);
    const groups = new Map<string, ClimateRowGroup>();
    const rowGroups = new Map<number, Map<string, ContourSpan[]>>();
    for (const [y, spans] of rows) {
      const storedRow = new Map<string, ContourSpan[]>();
      const mapRow = mapQuery.rowGroups.get(y);
      if (!mapRow) {
        rowGroups.set(y, storedRow);
        continue;
      }
      for (const [key, mapSpans] of mapRow) {
        const rowSpans = intersectContourRows(spans, mapSpans);
        if (!rowSpans.length) continue;
        storedRow.set(key, rowSpans);
        const metadata = mapQuery.regions.get(key);
        if (!metadata) throw new Error(`Не найдены параметры климатического контура ${key}`);
        let accumulated = groups.get(key);
        if (!accumulated) {
          accumulated = {
            humidity: metadata.humidity,
            temperature: metadata.temperature,
            drainage: metadata.drainage,
            spans: [],
          };
          groups.set(key, accumulated);
        }
        accumulated.spans.push(...rowSpans);
      }
      rowGroups.set(y, storedRow);
    }
    const regions = new Map<string, ClimateContour>();
    for (const [key, group] of groups) {
      regions.set(key, {
        humidity: group.humidity,
        temperature: group.temperature,
        drainage: group.drainage,
        area: new ContourArea(group.spans, true),
      });
    }
    cached = {
      area,
      queryRows: rows,
      rowGroups,
      regions,
      dirtyRows: new Map(),
      output: [...regions.values()],
    };
    this.addClimateQuery(cached);
    return cached.output;
  }

  private globalClimateQuery(): ClimateQueryCache {
    this.climateMapArea ??= ContourArea.rectangle({
      x0: 0,
      y0: 0,
      x1: MAP_WIDTH - 1,
      y1: MAP_HEIGHT - 1,
    });
    if (this.globalClimateCache) {
      this.refreshClimateQuery(this.globalClimateCache);
      return this.globalClimateCache;
    }

    const rows = queryRows(this.climateMapArea);
    const groups = new Map<string, ClimateRowGroup>();
    const rowGroups = new Map<number, Map<string, ContourSpan[]>>();
    for (const [y, spans] of rows) {
      const computed = this.computeClimateRow(spans);
      const storedRow = new Map<string, ContourSpan[]>();
      for (const [key, group] of computed) {
        storedRow.set(key, group.spans);
        let accumulated = groups.get(key);
        if (!accumulated) {
          accumulated = { ...group, spans: [] };
          groups.set(key, accumulated);
        }
        accumulated.spans.push(...group.spans);
      }
      rowGroups.set(y, storedRow);
    }
    const regions = new Map<string, ClimateContour>();
    for (const [key, group] of groups) {
      regions.set(key, {
        humidity: group.humidity,
        temperature: group.temperature,
        drainage: group.drainage,
        area: new ContourArea(group.spans, true),
      });
    }
    this.globalClimateCache = {
      area: this.climateMapArea,
      queryRows: rows,
      rowGroups,
      regions,
      dirtyRows: new Map(),
      output: [...regions.values()],
    };
    return this.globalClimateCache;
  }

  /** Возвращает полное пересечение заданных климатических контуров внутри геометрической области. */
  climateIntersectionArea(
    humidityValue: number,
    temperatureValue: number,
    drainageValue: number,
    clip: ContourArea,
  ): ContourArea {
    if (!clip.size) return this.emptyArea;
    const key = climateGroupKey(humidityValue, temperatureValue, drainageValue);
    return this.climateIntersections(clip).find((region) =>
      climateGroupKey(region.humidity, region.temperature, region.drainage) === key)?.area ?? this.emptyArea;
  }

  private computeClimateRow(spans: readonly ContourSpan[]): Map<string, ClimateRowGroup> {
    const humidity = this.layer('humidity');
    const temperature = this.layer('temperature');
    const drainage = this.layer('drainage');
    const groups = new Map<string, ClimateRowGroup>();
    for (const span of spans) {
      const rows = [humidity.row(span.y), temperature.row(span.y), drainage.row(span.y)];
      const cursors = [0, 0, 0];
      let x = span.start;
      while (x < span.end) {
        for (let index = 0; index < rows.length; index += 1) {
          while (rows[index][cursors[index]].end <= x) cursors[index] += 1;
        }
        const h = rows[0][cursors[0]], t = rows[1][cursors[1]], d = rows[2][cursors[2]];
        const end = Math.min(span.end, h.end, t.end, d.end);
        const key = climateGroupKey(h.value, t.value, d.value);
        let group = groups.get(key);
        if (!group) {
          group = { humidity: h.value, temperature: t.value, drainage: d.value, spans: [] };
          groups.set(key, group);
        }
        group.spans.push({ y: span.y, start: x, end });
        x = end;
      }
    }
    return groups;
  }

  private findClimateQuery(area: ContourArea): ClimateQueryCache | null {
    const bucket = this.climateQueryBuckets.get(contourAreaFingerprint(area));
    return bucket?.find((cached) => sameContourArea(cached.area, area)) ?? null;
  }

  private addClimateQuery(cached: ClimateQueryCache): void {
    const fingerprint = contourAreaFingerprint(cached.area);
    const bucket = this.climateQueryBuckets.get(fingerprint) ?? [];
    bucket.push(cached);
    this.climateQueryBuckets.set(fingerprint, bucket);
    this.climateQueryOrder.push(cached);
    while (this.climateQueryOrder.length > 64) {
      const oldest = this.climateQueryOrder.shift()!;
      const oldFingerprint = contourAreaFingerprint(oldest.area);
      const oldBucket = this.climateQueryBuckets.get(oldFingerprint);
      if (!oldBucket) continue;
      const index = oldBucket.indexOf(oldest);
      if (index >= 0) oldBucket.splice(index, 1);
      if (!oldBucket.length) this.climateQueryBuckets.delete(oldFingerprint);
    }
  }

  private touchClimateQuery(cached: ClimateQueryCache): void {
    const index = this.climateQueryOrder.indexOf(cached);
    if (index >= 0) this.climateQueryOrder.splice(index, 1);
    this.climateQueryOrder.push(cached);
  }

  private markClimateQueriesDirty(bounds: ContourBounds): void {
    const caches = this.globalClimateCache
      ? [...this.climateQueryOrder, this.globalClimateCache]
      : this.climateQueryOrder;
    for (const cached of caches) {
      const areaBounds = cached.area.bounds;
      if (areaBounds.y0 > bounds.y1 || areaBounds.y1 < bounds.y0 ||
        areaBounds.x0 > bounds.x1 || areaBounds.x1 < bounds.x0) continue;
      for (let y = Math.max(areaBounds.y0, bounds.y0); y <= Math.min(areaBounds.y1, bounds.y1); y += 1) {
        const spans = cached.queryRows.get(y);
        if (!spans) continue;
        let x0 = MAP_WIDTH;
        let x1 = -1;
        for (const span of spans) {
          const start = Math.max(span.start, bounds.x0);
          const end = Math.min(span.end, bounds.x1 + 1);
          if (end <= start) continue;
          x0 = Math.min(x0, start);
          x1 = Math.max(x1, end - 1);
        }
        mergeDirtyRange(cached.dirtyRows, y, x0, x1);
      }
    }
  }

  private refreshClimateQuery(cached: ClimateQueryCache): void {
    if (!cached.dirtyRows.size) return;
    for (const [y, dirty] of cached.dirtyRows) {
      const affected: ContourSpan[] = [];
      for (const span of cached.queryRows.get(y) ?? []) {
        const start = Math.max(span.start, dirty.x0);
        const end = Math.min(span.end, dirty.x1 + 1);
        if (end > start) affected.push({ y, start, end });
      }
      const updatedGroups = this.computeClimateRow(affected);
      const oldRow = cached.rowGroups.get(y) ?? new Map<string, ContourSpan[]>();
      const nextRow = new Map<string, ContourSpan[]>();
      const keys = new Set([...oldRow.keys(), ...updatedGroups.keys()]);
      const updateBounds = { x0: dirty.x0, x1: dirty.x1, y0: y, y1: y };
      for (const key of keys) {
        const oldSpans = oldRow.get(key) ?? [];
        const previousArea = cached.regions.get(key)?.area;
        const updated = updatedGroups.get(key)?.spans ?? [];
        const oldAffected: ContourSpan[] = [];
        const preserved: ContourSpan[] = [];
        for (const span of oldSpans) {
          const start = Math.max(span.start, dirty.x0);
          const end = Math.min(span.end, dirty.x1 + 1);
          if (end <= start) {
            preserved.push(span);
            continue;
          }
          oldAffected.push({ y, start, end });
          if (span.start < dirty.x0) preserved.push({ y, start: span.start, end: dirty.x0 });
          if (span.end > dirty.x1 + 1) preserved.push({ y, start: dirty.x1 + 1, end: span.end });
        }
        const unchanged = oldAffected.length === updated.length && oldAffected.every((span, index) =>
          span.y === updated[index].y && span.start === updated[index].start && span.end === updated[index].end);
        if (unchanged) {
          nextRow.set(key, oldSpans);
          continue;
        }
        const replacement = new ContourArea(updated, true);
        const nextArea = previousArea
          ? previousArea.replaceRegion(updateBounds, replacement.spans)
          : replacement;
        if (nextArea.size) {
          const values = updatedGroups.get(key) ?? cached.regions.get(key)!;
          cached.regions.set(key, {
            humidity: values.humidity,
            temperature: values.temperature,
            drainage: values.drainage,
            area: nextArea,
          });
        } else {
          cached.regions.delete(key);
        }
        const nextSpans = new ContourArea([...preserved, ...updated]).spans;
        if (nextSpans.length) nextRow.set(key, [...nextSpans]);
      }
      cached.rowGroups.set(y, nextRow);
    }
    cached.dirtyRows.clear();
    cached.output = [...cached.regions.values()];
  }

  private retargetClimateQuery(previous: ContourArea, next: ContourArea): void {
    const cached = this.findClimateQuery(previous);
    if (!cached) return;
    const previousFingerprint = contourAreaFingerprint(cached.area);
    const previousBucket = this.climateQueryBuckets.get(previousFingerprint);
    if (previousBucket) {
      const index = previousBucket.indexOf(cached);
      if (index >= 0) previousBucket.splice(index, 1);
      if (!previousBucket.length) this.climateQueryBuckets.delete(previousFingerprint);
    }
    const changed = previous.symmetricDifference(next);
    cached.area = next;
    cached.queryRows = queryRows(next);
    for (const span of changed.spans) {
      mergeDirtyRange(cached.dirtyRows, span.y, span.start, span.end - 1);
    }
    const fingerprint = contourAreaFingerprint(next);
    const bucket = this.climateQueryBuckets.get(fingerprint) ?? [];
    bucket.push(cached);
    this.climateQueryBuckets.set(fingerprint, bucket);
  }
}
