/**
 * Зоны с замкнутыми контурами — сохраняемое представление каждого слоя карты.
 *
 * Слой состоит из зон; зона — область с одним значением слоя
 * (государство, «влажность 10%», «культура X — 60%»), ограниченная кольцами.
 * Кольца проходят по границам пикселей, поэтому восстановление растра точное.
 * В кольцах хранятся только угловые вершины: [x0, y0, x1, y1, ...].
 */
import { MAP_HEIGHT, MAP_PIXELS, MAP_WIDTH } from './config';
import type { Composition } from './composition';

/** Доступ только для чтения к таблице смесей, снимок которой не меняется во время трассировки. */
export interface TableView {
  entries: Composition[];
  shareOf(comp: number, entity: number): number;
}

/** Длинные операции уступают управление через равные промежутки строк для выполнения между кадрами. */
export type Steps<T> = Generator<void, T, void>;
const ROWS_PER_STEP = 24;

/** Выполняет пошаговую операцию до конца синхронно. */
export function runSteps<T>(steps: Steps<T>): T {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

export type Ring = Int32Array;
export interface Zone {
  value: number;
  rings: Ring[];
}

const VW = MAP_WIDTH + 1;
const STEP = [1, VW, -1, -VW];

class EdgeBuckets {
  readonly byKey = new Map<number, number[]>();

  /** Добавляет сторону пикселя (x, y) как ориентированное ребро; пиксель остаётся справа. */
  add(key: number, x: number, y: number, side: number): void {
    let v: number;
    if (side === 0) v = y * VW + x;
    else if (side === 1) v = y * VW + x + 1;
    else if (side === 2) v = (y + 1) * VW + x + 1;
    else v = (y + 1) * VW + x;
    let list = this.byKey.get(key);
    if (!list) {
      list = [];
      this.byKey.set(key, list);
    }
    list.push(v * 4 + side);
  }
}

/** Соединяет ориентированные единичные рёбра в замкнутые кольца, оставляя только углы. */
export function linkRings(codes: number[]): Ring[] {
  const outgoing = new Map<number, number[]>();
  codes.forEach((code, index) => {
    const v = Math.floor(code / 4);
    const list = outgoing.get(v);
    if (list) list.push(index);
    else outgoing.set(v, [index]);
  });
  const used = new Uint8Array(codes.length);
  const rings: Ring[] = [];
  for (let first = 0; first < codes.length; first += 1) {
    if (used[first]) continue;
    const startV = Math.floor(codes[first] / 4);
    const verts: number[] = [];
    const dirs: number[] = [];
    let current = first;
    let prevDir = -1;
    for (let guard = 0; guard <= codes.length; guard += 1) {
      used[current] = 1;
      const code = codes[current];
      const v = Math.floor(code / 4);
      const dir = code & 3;
      if (dir !== prevDir) {
        verts.push(v);
        dirs.push(dir);
      }
      prevDir = dir;
      const end = v + STEP[dir];
      if (end === startV) break;
      const options = outgoing.get(end);
      if (!options) break;
      let next = -1;
      for (const preferred of [(dir + 1) & 3, dir, (dir + 3) & 3]) {
        for (const option of options) {
          if (!used[option] && (codes[option] & 3) === preferred) {
            next = option;
            break;
          }
        }
        if (next >= 0) break;
      }
      if (next < 0) break;
      current = next;
    }
    // Начальная вершина не является углом, если кольцо входит и выходит из неё в одном направлении.
    if (verts.length > 1 && dirs[0] === prevDir) {
      verts.shift();
    }
    const ring = new Int32Array(verts.length * 2);
    verts.forEach((v, i) => {
      ring[i * 2] = v % VW;
      ring[i * 2 + 1] = Math.floor(v / VW);
    });
    rings.push(ring);
  }
  return rings;
}

function* bucketsToZones(buckets: EdgeBuckets): Steps<Zone[]> {
  const zones: Zone[] = [];
  for (const [value, codes] of buckets.byKey) {
    zones.push({ value, rings: linkRings(codes) });
    yield;
  }
  return zones.sort((a, b) => a.value - b.value);
}

/**
 * Преобразует скалярный растр в зоны одинаковых значений. Пиксели, у которых
 * `include` равен 0 или значение равно `skip`, не входят ни в одну зону.
 */
export function traceScalar(values: ArrayLike<number>, include: Uint8Array | null, skip: number | null): Zone[] {
  return runSteps(traceScalarSteps(values, include, skip));
}

export function* traceScalarSteps(values: ArrayLike<number>, include: Uint8Array | null, skip: number | null): Steps<Zone[]> {
  const buckets = new EdgeBuckets();
  const inside = (p: number) => (include === null || include[p] === 1) && values[p] !== skip;
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      const p = y * MAP_WIDTH + x;
      if (!inside(p)) continue;
      const value = values[p];
      if (y === 0 || !inside(p - MAP_WIDTH) || values[p - MAP_WIDTH] !== value) buckets.add(value, x, y, 0);
      if (x === MAP_WIDTH - 1 || !inside(p + 1) || values[p + 1] !== value) buckets.add(value, x, y, 1);
      if (y === MAP_HEIGHT - 1 || !inside(p + MAP_WIDTH) || values[p + MAP_WIDTH] !== value) buckets.add(value, x, y, 2);
      if (x === 0 || !inside(p - 1) || values[p - 1] !== value) buckets.add(value, x, y, 3);
    }
    if (y % ROWS_PER_STEP === 0) yield;
  }
  return yield* bucketsToZones(buckets);
}

export interface EntityZones {
  entity: number;
  zones: Zone[];
}

/**
 * Преобразует растр смесей в отдельный слой для каждой сущности: для каждой
 * культуры или религии строятся зоны долей 5%, 10%, …, 100%. Вне этих зон доля равна 0.
 */
export function traceComposition(comp: Uint16Array, table: TableView): EntityZones[] {
  return runSteps(traceCompositionSteps(comp, table));
}

export function* traceCompositionSteps(comp: Uint16Array, table: TableView): Steps<EntityZones[]> {
  const perEntity = new Map<number, EdgeBuckets>();
  const diffCache = new Map<number, number[]>();
  const diff = (a: number, b: number): number[] => {
    const key = a * 65536 + b;
    let cached = diffCache.get(key);
    if (!cached) {
      cached = [];
      const entry = table.entries[a];
      for (let k = 0; k < entry.ids.length; k += 1) {
        if (table.shareOf(b, entry.ids[k]) !== entry.shares[k]) cached.push(entry.ids[k], entry.shares[k]);
      }
      diffCache.set(key, cached);
    }
    return cached;
  };
  const emit = (list: number[], x: number, y: number, side: number) => {
    for (let k = 0; k < list.length; k += 2) {
      let buckets = perEntity.get(list[k]);
      if (!buckets) {
        buckets = new EdgeBuckets();
        perEntity.set(list[k], buckets);
      }
      buckets.add(list[k + 1], x, y, side);
    }
  };
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      const p = y * MAP_WIDTH + x;
      const a = comp[p];
      if (a === 0) continue;
      const up = y === 0 ? 0 : comp[p - MAP_WIDTH];
      const right = x === MAP_WIDTH - 1 ? 0 : comp[p + 1];
      const down = y === MAP_HEIGHT - 1 ? 0 : comp[p + MAP_WIDTH];
      const left = x === 0 ? 0 : comp[p - 1];
      if (up !== a) emit(diff(a, up), x, y, 0);
      if (right !== a) emit(diff(a, right), x, y, 1);
      if (down !== a) emit(diff(a, down), x, y, 2);
      if (left !== a) emit(diff(a, left), x, y, 3);
    }
    if (y % ROWS_PER_STEP === 0) yield;
  }
  const layers: EntityZones[] = [];
  for (const [entity, buckets] of perEntity) layers.push({ entity, zones: yield* bucketsToZones(buckets) });
  return layers.sort((a, b) => a.entity - b.entity);
}

/** Вызывает `visit` для пикселей внутри колец по правилу чётности и центрам пикселей. */
export function fillRings(rings: Ring[], visit: (p: number) => void): void {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 2) {
      minX = Math.min(minX, ring[i]);
      maxX = Math.max(maxX, ring[i]);
      minY = Math.min(minY, ring[i + 1]);
      maxY = Math.max(maxY, ring[i + 1]);
    }
  }
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return;
  const bw = maxX - minX + 1;
  const parity = new Uint8Array(bw * (maxY - minY));
  for (const ring of rings) {
    const n = ring.length / 2;
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      const x = ring[i * 2];
      if (x !== ring[j * 2]) continue;
      const y0 = Math.min(ring[i * 2 + 1], ring[j * 2 + 1]);
      const y1 = Math.max(ring[i * 2 + 1], ring[j * 2 + 1]);
      for (let y = y0; y < y1; y += 1) parity[(y - minY) * bw + (x - minX)] ^= 1;
    }
  }
  for (let y = minY; y < maxY; y += 1) {
    let inside = 0;
    const row = (y - minY) * bw;
    for (let x = minX; x < maxX; x += 1) {
      inside ^= parity[row + x - minX];
      if (inside) visit(y * MAP_WIDTH + x);
    }
  }
}

/** Записывает скалярные зоны обратно в растр. */
export function rasterizeScalar(zones: Zone[], target: Uint8Array | Uint16Array | Float32Array): void {
  for (const zone of zones) fillRings(zone.rings, (p) => (target[p] = zone.value));
}

export function vertexCount(zones: Zone[]): number {
  return zones.reduce((sum, zone) => sum + zone.rings.reduce((s, ring) => s + ring.length / 2, 0), 0);
}

export function ringCount(zones: Zone[]): number {
  return zones.reduce((sum, zone) => sum + zone.rings.length, 0);
}

