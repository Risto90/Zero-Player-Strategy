import { MAP_HEIGHT, MAP_WIDTH } from './config';
import { linkRings, type Ring } from './zones';

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

interface ValueSpan extends ContourSpan {
  value: number;
}

/** Точная площадь контура: непересекающиеся горизонтальные интервалы, конец исключён. */
export class ContourArea {
  readonly spans: readonly ContourSpan[];
  readonly size: number;

  constructor(spans: readonly ContourSpan[] = [], alreadyOrdered = false) {
    const ordered = spans.filter((span) => span.end > span.start);
    if (!alreadyOrdered) ordered.sort((a, b) => a.y - b.y || a.start - b.start);
    const merged: ContourSpan[] = [];
    for (const span of ordered) {
      const previous = merged[merged.length - 1];
      if (previous && previous.y === span.y && previous.end >= span.start) {
        previous.end = Math.max(previous.end, span.end);
      } else merged.push({ ...span });
    }
    this.spans = merged;
    this.size = merged.reduce((sum, span) => sum + span.end - span.start, 0);
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

  /** Координаты кисти непрерывные; проверяется центр каждой точки, как у ручного мазка. */
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
    const result: ContourSpan[] = [];
    let a = 0, b = 0;
    while (a < this.spans.length && b < other.spans.length) {
      const left = this.spans[a], right = other.spans[b];
      if (left.y < right.y || (left.y === right.y && left.end <= right.start)) { a += 1; continue; }
      if (right.y < left.y || right.end <= left.start) { b += 1; continue; }
      result.push({ y: left.y, start: Math.max(left.start, right.start), end: Math.min(left.end, right.end) });
      if (left.end <= right.end) a += 1;
      else b += 1;
    }
    return new ContourArea(result);
  }

  union(other: ContourArea): ContourArea {
    return new ContourArea([...this.spans, ...other.spans]);
  }

  subtract(other: ContourArea): ContourArea {
    const result: ContourSpan[] = [];
    let index = 0;
    for (const span of this.spans) {
      while (index < other.spans.length && (other.spans[index].y < span.y ||
        (other.spans[index].y === span.y && other.spans[index].end <= span.start))) index += 1;
      let start = span.start;
      for (let j = index; j < other.spans.length; j += 1) {
        const cut = other.spans[j];
        if (cut.y !== span.y || cut.start >= span.end) break;
        if (cut.start > start) result.push({ y: span.y, start, end: Math.min(cut.start, span.end) });
        start = Math.max(start, cut.end);
        if (start >= span.end) break;
      }
      if (start < span.end) result.push({ y: span.y, start, end: span.end });
    }
    return new ContourArea(result);
  }

  forEachPixel(visit: (pixel: number) => void): void {
    for (const span of this.spans) {
      const row = span.y * MAP_WIDTH;
      for (let x = span.start; x < span.end; x += 1) visit(row + x);
    }
  }

  /** Соседство по стороне: диагональное касание не соединяет территории. */
  border(): ContourArea {
    const expanded: ContourSpan[] = [];
    for (const span of this.spans) {
      expanded.push({ y: span.y, start: Math.max(0, span.start - 1), end: Math.min(MAP_WIDTH, span.end + 1) });
      if (span.y > 0) expanded.push({ ...span, y: span.y - 1 });
      if (span.y + 1 < MAP_HEIGHT) expanded.push({ ...span, y: span.y + 1 });
    }
    return new ContourArea(expanded).subtract(this);
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
export class ScalarContourLayer {
  private readonly rows = new Map<number, readonly ValueSpan[]>();
  private readonly selections = new Map<string, ContourArea>();

  constructor(private readonly source: () => ArrayLike<number>) {}

  invalidate(y0 = 0, y1 = MAP_HEIGHT - 1): void {
    let changed = false;
    for (let y = y0; y <= y1; y += 1) changed = this.rows.delete(y) || changed;
    if (changed) this.selections.clear();
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
    const key = cacheKey === undefined ? null : `${cacheKey}:${bounds.x0}:${bounds.y0}:${bounds.x1}:${bounds.y1}`;
    if (key !== null) {
      const cached = this.selections.get(key);
      if (cached) return cached;
    }
    const spans: ContourSpan[] = [];
    for (let y = Math.max(0, bounds.y0); y <= Math.min(MAP_HEIGHT - 1, bounds.y1); y += 1) {
      for (const span of this.row(y)) {
        if (span.start > bounds.x1) break;
        if (span.end <= bounds.x0 || !accept(span.value)) continue;
        spans.push({ y, start: Math.max(bounds.x0, span.start), end: Math.min(bounds.x1 + 1, span.end) });
      }
    }
    const area = new ContourArea(spans);
    if (key !== null) {
      if (this.selections.size >= 64) this.selections.delete(this.selections.keys().next().value!);
      this.selections.set(key, area);
    }
    return area;
  }
}

export type ContourLayerName = 'land' | 'owner' | 'humidity' | 'temperature' | 'drainage' |
  'density' | 'culture' | 'religion' | 'humanOrigins' | 'rivers' | 'water';

export interface ClimateContour {
  humidity: number;
  temperature: number;
  drainage: number;
  area: ContourArea;
}

/** Растры остаются точным совместимым зеркалом; геометрические запросы идут через контуры. */
export class MapContours {
  private readonly layers = new Map<ContourLayerName, ScalarContourLayer>();
  private knownVersion = -1;
  private climateRegionsCache: ClimateContour[] | null = null;
  private climateRegionIds: Int32Array | null = null;

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
      this.climateRegionsCache = null;
      this.climateRegionIds = null;
      this.knownVersion = this.version();
    }
  }

  changed(bounds: ContourBounds, names?: readonly ContourLayerName[]): void {
    for (const [name, layer] of this.layers) {
      if (!names || names.includes(name)) layer.invalidate(Math.max(0, bounds.y0), Math.min(MAP_HEIGHT - 1, bounds.y1));
    }
    if (!names || names.some((name) => ['land', 'humidity', 'temperature', 'drainage'].includes(name))) {
      this.climateRegionsCache = null;
      this.climateRegionIds = null;
    }
    this.knownVersion = this.version();
  }

  climateRegions(): readonly ClimateContour[] {
    this.layer('land');
    if (!this.climateRegionsCache) {
      const land = this.layer('land').select((value) => value === 1,
        { x0: 0, y0: 0, x1: MAP_WIDTH - 1, y1: MAP_HEIGHT - 1 }, 'land');
      this.climateRegionsCache = this.climateIntersections(land);
    }
    return this.climateRegionsCache;
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

  /** Пересечение трёх слоёв выполняется по интервалам, не по всем точкам площади. */
  climateIntersections(area: ContourArea): ClimateContour[] {
    const humidity = this.layer('humidity');
    const temperature = this.layer('temperature');
    const drainage = this.layer('drainage');
    const groups = new Map<string, { humidity: number; temperature: number; drainage: number; spans: ContourSpan[] }>();
    for (const span of area.spans) {
      const rows = [humidity.row(span.y), temperature.row(span.y), drainage.row(span.y)];
      const cursors = [0, 0, 0];
      let x = span.start;
      while (x < span.end) {
        for (let k = 0; k < rows.length; k += 1) {
          while (rows[k][cursors[k]].end <= x) cursors[k] += 1;
        }
        const h = rows[0][cursors[0]], t = rows[1][cursors[1]], d = rows[2][cursors[2]];
        const end = Math.min(span.end, h.end, t.end, d.end);
        const key = `${h.value}:${t.value}:${d.value}`;
        let group = groups.get(key);
        if (!group) {
          group = { humidity: h.value, temperature: t.value, drainage: d.value, spans: [] };
          groups.set(key, group);
        }
        group.spans.push({ y: span.y, start: x, end });
        x = end;
      }
    }
    return [...groups.values()].map(({ spans, ...values }) => ({
      ...values,
      area: new ContourArea(spans, true),
    }));
  }
}
