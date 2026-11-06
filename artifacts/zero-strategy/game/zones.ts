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
import {
  linkContourRings,
  rasterizePolygonContours,
  traceCompositionContourChunk,
  traceScalarContourChunk,
} from '../kernel/contour-spans';

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

class EdgeBuckets {
  readonly byKey = new Map<number, number[]>();

  /** Объединяет уже вычисленные бинарным ядром группы граничных рёбер. */
  merge(values: Float64Array, offsets: Uint32Array, codes: Uint32Array): void {
    for (let group = 0; group < values.length; group += 1) {
      const value = values[group];
      let list = this.byKey.get(value);
      if (!list) {
        list = [];
        this.byKey.set(value, list);
      }
      for (let index = offsets[group]; index < offsets[group + 1]; index += 1) {
        list.push(codes[index]);
      }
    }
  }

  /** Объединяет одну готовую бинарным ядром группу граничных рёбер. */
  mergeGroup(value: number, codes: Uint32Array, start: number, end: number): void {
    let list = this.byKey.get(value);
    if (!list) {
      list = [];
      this.byKey.set(value, list);
    }
    for (let index = start; index < end; index += 1) list.push(codes[index]);
  }
}

/** Соединяет ориентированные единичные рёбра в замкнутые кольца, оставляя только углы. */
export function linkRings(codes: number[]): Ring[] {
  const binaryCodes = new Uint32Array(codes.length);
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index];
    if (!Number.isInteger(code) || code < 0 || code > 0xffff_ffff) {
      throw new RangeError('Коды рёбер должны быть целыми числами Uint32');
    }
    binaryCodes[index] = code;
  }
  const { coordinates, ringOffsets } = linkContourRings(
    binaryCodes,
    MAP_WIDTH,
    MAP_HEIGHT,
  );
  return Array.from({ length: ringOffsets.length - 1 }, (_, ringIndex) =>
    coordinates.slice(ringOffsets[ringIndex] * 2, ringOffsets[ringIndex + 1] * 2));
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
  if (values.length !== MAP_PIXELS || (include !== null && include.length !== MAP_PIXELS)) {
    throw new RangeError('Скалярный слой и маска должны совпадать с размером карты');
  }
  const binaryValues = values instanceof Float64Array
    ? values
    : Float64Array.from(values);
  for (let processStart = 0; processStart < MAP_HEIGHT; processStart += ROWS_PER_STEP) {
    const processEnd = Math.min(MAP_HEIGHT, processStart + ROWS_PER_STEP);
    const sourceStart = Math.max(0, processStart - 1);
    const sourceEnd = Math.min(MAP_HEIGHT, processEnd + 1);
    const startPixel = sourceStart * MAP_WIDTH;
    const endPixel = sourceEnd * MAP_WIDTH;
    const result = traceScalarContourChunk(
      binaryValues.subarray(startPixel, endPixel),
      include?.subarray(startPixel, endPixel) ?? null,
      sourceStart,
      processStart,
      processEnd,
      MAP_WIDTH,
      MAP_HEIGHT,
      skip,
    );
    buckets.merge(result.values, result.offsets, result.codes);
    yield;
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
  if (comp.length !== MAP_PIXELS) {
    throw new RangeError('Слой смесей должен совпадать с размером карты');
  }
  if (table.entries.length === 0 || table.entries.length > 65536) {
    throw new RangeError('Число смесей не помещается в идентификатор Uint16');
  }
  const perEntity = new Map<number, EdgeBuckets>();
  let entryCount = 0;
  const compositionOffsets = new Uint32Array(table.entries.length + 1);
  for (let composition = 0; composition < table.entries.length; composition += 1) {
    const entry = table.entries[composition];
    if (entry.ids.length !== entry.shares.length ||
        entryCount + entry.ids.length > 0xffff_ffff) {
      throw new RangeError('Таблица смесей имеет несовместимые размеры');
    }
    entryCount += entry.ids.length;
    compositionOffsets[composition + 1] = entryCount;
  }
  const entityIds = new Uint32Array(entryCount);
  const shares = new Float64Array(entryCount);
  let at = 0;
  for (const entry of table.entries) {
    for (let index = 0; index < entry.ids.length; index += 1) {
      const entity = entry.ids[index];
      const share = entry.shares[index];
      if (!Number.isInteger(entity) || entity < 0 || entity > 0xffff_ffff ||
          !Number.isFinite(share) || share <= 0 ||
          (index > 0 && entity <= entry.ids[index - 1])) {
        throw new RangeError('Состав смеси должен быть отсортирован и содержать конечные доли');
      }
      entityIds[at] = entity;
      shares[at] = share;
      at += 1;
    }
  }
  if (compositionOffsets[1] !== 0) {
    throw new RangeError('Нулевая смесь должна быть пустой');
  }
  for (let processStart = 0; processStart < MAP_HEIGHT; processStart += ROWS_PER_STEP) {
    const processEnd = Math.min(MAP_HEIGHT, processStart + ROWS_PER_STEP);
    const sourceStart = Math.max(0, processStart - 1);
    const sourceEnd = Math.min(MAP_HEIGHT, processEnd + 1);
    const result = traceCompositionContourChunk(
      comp.subarray(sourceStart * MAP_WIDTH, sourceEnd * MAP_WIDTH),
      compositionOffsets,
      entityIds,
      shares,
      sourceStart,
      processStart,
      processEnd,
      MAP_WIDTH,
      MAP_HEIGHT,
    );
    for (let group = 0; group < result.entities.length; group += 1) {
      const entity = result.entities[group];
      let buckets = perEntity.get(entity);
      if (!buckets) {
        buckets = new EdgeBuckets();
        perEntity.set(entity, buckets);
      }
      buckets.mergeGroup(
        result.values[group],
        result.codes,
        result.offsets[group],
        result.offsets[group + 1],
      );
    }
    yield;
  }
  const layers: EntityZones[] = [];
  for (const [entity, buckets] of perEntity) layers.push({ entity, zones: yield* bucketsToZones(buckets) });
  return layers.sort((a, b) => a.entity - b.entity);
}

/** Вызывает `visit` для пикселей внутри колец по правилу чётности и центрам пикселей. */
export function fillRings(rings: Ring[], visit: (p: number) => void): void {
  if (rings.length === 0) return;
  const polygon = rings.map((ring) => {
    const points: { x: number; y: number }[] = [];
    for (let index = 0; index < ring.length; index += 2) {
      points.push({ x: ring[index], y: ring[index + 1] });
    }
    return points;
  });
  const spans = rasterizePolygonContours([polygon], MAP_WIDTH, MAP_HEIGHT);
  for (const span of spans) {
    for (let x = span.start; x < span.end; x += 1) {
      visit(span.y * MAP_WIDTH + x);
    }
  }
}

/** Записывает скалярные зоны обратно в растр. */
export function rasterizeScalar(
  zones: Zone[],
  target: Uint8Array | Uint16Array | Uint32Array | Float32Array | Float64Array,
): void {
  for (const zone of zones) fillRings(zone.rings, (p) => (target[p] = zone.value));
}

export function vertexCount(zones: Zone[]): number {
  return zones.reduce((sum, zone) => sum + zone.rings.reduce((s, ring) => s + ring.length / 2, 0), 0);
}

export function ringCount(zones: Zone[]): number {
  return zones.reduce((sum, zone) => sum + zone.rings.length, 0);
}

