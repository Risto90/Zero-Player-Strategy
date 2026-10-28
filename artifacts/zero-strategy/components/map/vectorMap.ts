import { ContourArea, type ContourLayerName, type ContourSpan } from '@/game/contours';
import { contourLayersForMode, type VectorPaintInfo } from '@/game/render';
import { MAP_HEIGHT, MAP_WIDTH } from '@/game/config';
import type { Game } from '@/game/game';

type RGB = [number, number, number];

interface CachedVectorColor {
  colors: Map<string, string>;
  fixed: Set<string>;
}

interface ContourColorGraph {
  paints: Map<string, VectorPaintInfo>;
  neighbors: Map<string, Set<string>>;
}

interface CachedContourMarkup {
  spans: ContourSpan[];
  markup: string;
}

export interface VectorMapSvgPart {
  key: string;
  markup: string;
  order: number;
}

const colorCaches = new Map<string, CachedVectorColor>();
const colorGraphCaches = new WeakMap<object, Map<string, ContourColorGraph>>();
const seaDepthMarkupCaches = new WeakMap<object, Map<string, string>>();
const contourMarkupCaches = new WeakMap<object, Map<string, CachedContourMarkup>>();
const nomadPathCaches = new WeakMap<object, Map<number, string>>();

function rgb(color: string): RGB {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function hex([r, g, b]: RGB): string {
  return `#${[r, g, b].map((part) => Math.max(0, Math.min(255, part)).toString(16).padStart(2, '0')).join('')}`;
}

function colorsFor(game: Game): CachedVectorColor {
  const snapshot = game.getSnapshot();
  const playerKey = `${game.world.seed}:${snapshot.role}:${snapshot.focusCountry?.id ?? 'world'}`;
  const cached = colorCaches.get(playerKey);
  if (cached) return cached;

  const storageKey = `zero-strategy-map-contour-colors:${playerKey}`;
  let colors: Map<string, string> | null = null;
  if (typeof localStorage !== 'undefined') {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Record<string, string>;
      colors = new Map(Object.entries(saved));
    } catch {
      colors = new Map();
    }
  }
  const result = {
    colors: colors ?? new Map<string, string>(),
    fixed: new Set<string>([
      '#6699ae',
      '#377497',
      '#22537d',
    ]),
  };
  colorCaches.set(playerKey, result);
  return result;
}

function chooseSeparatedColor(neighborColors: readonly string[], fixedColors: ReadonlySet<string>): string {
  const known = [...neighborColors, ...fixedColors].map(rgb);
  const candidates: RGB[] = [];
  for (const r of [24, 72, 120, 168, 216, 240]) {
    for (const g of [24, 72, 120, 168, 216, 240]) {
      for (const b of [24, 72, 120, 168, 216, 240]) {
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (luminance < 34 || luminance > 224) continue;
        candidates.push([r, g, b]);
      }
    }
  }
  let bestScore = -1;
  let best: RGB[] = [];
  for (const candidate of candidates) {
    const score = known.reduce((total, other) =>
      total + Math.abs(candidate[0] - other[0]) + Math.abs(candidate[1] - other[1]) + Math.abs(candidate[2] - other[2]), 0);
    if (score > bestScore) {
      bestScore = score;
      best = [candidate];
    } else if (score === bestScore) best.push(candidate);
  }
  return hex(best[Math.floor(Math.random() * best.length)] ?? [120, 168, 216]);
}

function persistVectorColors(game: Game, cache: CachedVectorColor): void {
  if (typeof localStorage === 'undefined') return;
  const snapshot = game.getSnapshot();
  try {
    localStorage.setItem(
      `zero-strategy-map-contour-colors:${game.world.seed}:${snapshot.role}:${snapshot.focusCountry?.id ?? 'world'}`,
      JSON.stringify(Object.fromEntries(cache.colors)),
    );
  } catch {
    // Переполненное хранилище не меняет отрисовку текущего сеанса.
  }
}

export function contourPath(area: ContourArea): string {
  const commands: string[] = [];
  for (const ring of area.rings()) {
    // Кольцо хранит пары координат x/y, а не линейные индексы вершин.
    if (ring.length < 6) continue;
    let path = `M${ring[0]} ${ring[1]}`;
    for (let index = 2; index + 1 < ring.length; index += 2) {
      path += `L${ring[index]} ${ring[index + 1]}`;
    }
    commands.push(`${path}Z`);
  }
  return commands.join('');
}

function spansForRow(
  game: Game,
  layers: readonly ContourLayerName[],
  y: number,
  x0: number,
  x1: number,
): ContourSpan[] {
  const rows = layers.map((name) => game.world.contours.layer(name).row(y));
  const indices = rows.map((row) => {
    let index = 0;
    while (index < row.length && row[index].end <= x0) index += 1;
    return index;
  });
  const result: ContourSpan[] = [];
  let x = x0;
  while (x < x1) {
    let end = x1;
    for (let layerIndex = 0; layerIndex < rows.length; layerIndex += 1) {
      const row = rows[layerIndex];
      let spanIndex = indices[layerIndex];
      while (spanIndex < row.length && row[spanIndex].end <= x) spanIndex += 1;
      indices[layerIndex] = spanIndex;
      const span = row[spanIndex];
      if (span) end = Math.min(end, span.end);
    }
    if (end <= x) end = x + 1;
    result.push({ y, start: x, end });
    x = end;
  }
  return result;
}

function contourColorGraph(game: Game): ContourColorGraph {
  const mode = game.getSnapshot().mapMode;
  let cache = colorGraphCaches.get(game.world);
  if (!cache) {
    cache = new Map();
    colorGraphCaches.set(game.world, cache);
  }
  const saved = cache.get(mode);
  // Полный граф нужен только для начального назначения цветов. Границы существующих
  // контуров не меняют их цвет и не должны запускать повторный обход всей карты.
  if (saved) return saved;
  const layers = contourLayersForMode(mode);

  const graph: ContourColorGraph = {
    paints: new Map(),
    neighbors: new Map(),
  };
  const connect = (first: string, second: string) => {
    if (first === second) return;
    const firstNeighbors = graph.neighbors.get(first) ?? new Set<string>();
    const secondNeighbors = graph.neighbors.get(second) ?? new Set<string>();
    firstNeighbors.add(second);
    secondNeighbors.add(first);
    graph.neighbors.set(first, firstNeighbors);
    graph.neighbors.set(second, secondNeighbors);
  };
  let previous: { start: number; end: number; key: string }[] = [];
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    const current = spansForRow(game, layers, y, 0, MAP_WIDTH).map((span) => {
      const paint = game.renderer.vectorPaintAt(y * MAP_WIDTH + span.start);
      graph.paints.set(paint.key, paint);
      return { start: span.start, end: span.end, key: paint.key };
    });
    for (let index = 1; index < current.length; index += 1) {
      connect(current[index - 1].key, current[index].key);
    }
    let previousIndex = 0;
    let currentIndex = 0;
    while (previousIndex < previous.length && currentIndex < current.length) {
      const before = previous[previousIndex];
      const now = current[currentIndex];
      if (Math.max(before.start, now.start) < Math.min(before.end, now.end)) {
        connect(before.key, now.key);
      }
      if (before.end <= now.end) previousIndex += 1;
      else currentIndex += 1;
    }
    previous = current;
  }
  cache.set(mode, graph);
  return graph;
}

function contourAreaForPaintKey(game: Game, key: string): ContourArea | null {
  const bounds = { x0: 0, y0: 0, x1: MAP_WIDTH - 1, y1: MAP_HEIGHT - 1 };
  const countryMatch = /^country:(\d+)$/.exec(key);
  if (countryMatch) {
    const countryTag = Number(countryMatch[1]) + 1;
    return game.world.contours.layer('owner').select(
      (value) => value === countryTag, bounds, `new-paint:${key}`,
    );
  }
  const cultureMatch = /^culture:(\d+)$/.exec(key);
  const religionMatch = /^religion:(\d+)$/.exec(key);
  if (!cultureMatch && !religionMatch) return null;
  const layer = cultureMatch ? 'culture' : 'religion';
  const entityId = Number((cultureMatch ?? religionMatch)![1]);
  const owned = game.world.contours.layer('owner').select(
    (value) => value > 0, bounds, 'new-paint:occupied',
  );
  const matching = game.world.contours.layer(layer).select(
    (value) => value === entityId, bounds, `new-paint:${key}`,
  );
  return matching.intersect(owned);
}

function neighborColorsForNewPaint(
  game: Game,
  key: string,
  cache: CachedVectorColor,
): string[] {
  const area = contourAreaForPaintKey(game, key);
  if (!area) return [...cache.colors.values()];
  const mode = game.getSnapshot().mapMode;
  const layers = contourLayersForMode(mode);
  const neighborKeys = new Set<string>();
  const neighborPaints = new Map<string, VectorPaintInfo>();
  const addPixel = (pixel: number) => {
    if (pixel < 0 || pixel >= MAP_WIDTH * MAP_HEIGHT) return;
    const neighbor = game.renderer.vectorPaintAt(pixel);
    if (neighbor.key !== key) {
      neighborKeys.add(neighbor.key);
      neighborPaints.set(neighbor.key, neighbor);
    }
  };
  for (const span of area.spans) {
    if (span.start > 0) addPixel(span.y * MAP_WIDTH + span.start - 1);
    if (span.end < MAP_WIDTH) addPixel(span.y * MAP_WIDTH + span.end);
    for (const row of [span.y - 1, span.y + 1]) {
      if (row < 0 || row >= MAP_HEIGHT) continue;
      for (const neighborSpan of spansForRow(game, layers, row, span.start, span.end)) {
        addPixel(row * MAP_WIDTH + neighborSpan.start);
      }
    }
  }
  return [...neighborKeys]
    .map((neighborKey) => {
      const assigned = cache.colors.get(neighborKey);
      if (assigned) return assigned;
      const paint = neighborPaints.get(neighborKey);
      return paint && !paint.randomized ? paint.color : undefined;
    })
    .filter((color): color is string => color !== undefined);
}

function assignVisibleContourColors(game: Game, cache: CachedVectorColor): void {
  const graph = contourColorGraph(game);
  let changed = false;
  for (const [key, paint] of graph.paints) {
    if (!paint.randomized || cache.colors.has(key)) continue;
    const neighborColors = [...(graph.neighbors.get(key) ?? [])]
      .map((neighbor) => {
        const neighborPaint = graph.paints.get(neighbor);
        return cache.colors.get(neighbor) ?? (neighborPaint?.randomized ? undefined : neighborPaint?.color);
      })
      .filter((color): color is string => color !== undefined);
    cache.colors.set(key, chooseSeparatedColor(neighborColors, cache.fixed));
    changed = true;
  }
  if (changed) persistVectorColors(game, cache);
}

export function vectorColorFor(game: Game, paint: VectorPaintInfo): string {
  if (!paint.randomized) return paint.color;
  const cache = colorsFor(game);
  const found = cache.colors.get(paint.key);
  if (found) return found;
  assignVisibleContourColors(game, cache);
  const assigned = cache.colors.get(paint.key);
  if (assigned) return assigned;
  const color = chooseSeparatedColor(neighborColorsForNewPaint(game, paint.key, cache), cache.fixed);
  cache.colors.set(paint.key, color);
  persistVectorColors(game, cache);
  return color;
}

function fillPaths(
  game: Game,
  layers: readonly ContourLayerName[],
  bounds: VectorMapViewport,
  accepts: (pixel: number) => boolean,
): VectorMapSvgPart[] {
  const areas = new Map<string, { color: string; spans: ContourSpan[] }>();
  for (let y = bounds.y0; y <= bounds.y1; y += 1) {
    for (const span of spansForRow(game, layers, y, bounds.x0, bounds.x1)) {
      const pixel = y * MAP_WIDTH + span.start;
      if (!accepts(pixel)) continue;
      const paint = game.renderer.vectorPaintAt(pixel);
      const color = vectorColorFor(game, paint);
      const key = paint.key.startsWith('sea-depth:')
        ? `sea-depth-color:${color}`
        : `${paint.key}:${color}`;
      const area = areas.get(key) ?? { color, spans: [] };
      const previous = area.spans[area.spans.length - 1];
      if (previous && previous.y === span.y && previous.end === span.start) previous.end = span.end;
      else area.spans.push(span);
      areas.set(key, area);
    }
  }
  const paths: VectorMapSvgPart[] = [];
  for (const [key, area] of areas) {
    const cacheKey = `fill:${game.getSnapshot().mapMode}:${bounds.x0}:${bounds.y0}:${bounds.x1}:${bounds.y1}:${key}:${area.color}`;
    const markup = cachedContourMarkup(game, cacheKey, area.spans, (path) =>
      `<path data-contour="${key}" d="${path}" fill="${area.color}" fill-rule="evenodd"/>`);
    if (markup) paths.push({ key: `fill:${key}`, markup, order: 1 });
  }
  return paths;
}

function cachedContourMarkup(
  game: Game,
  key: string,
  spans: readonly ContourSpan[],
  build: (path: string) => string,
): string {
  let cache = contourMarkupCaches.get(game.world);
  if (!cache) {
    cache = new Map();
    contourMarkupCaches.set(game.world, cache);
  }
  const saved = cache.get(key);
  if (saved && saved.spans.length === spans.length &&
      saved.spans.every((span, index) => {
        const current = spans[index];
        return span.y === current.y && span.start === current.start && span.end === current.end;
      })) {
    cache.delete(key);
    cache.set(key, saved);
    return saved.markup;
  }

  const path = contourPath(new ContourArea(spans, true));
  const markup = path ? build(path) : '';
  if (cache.size >= 32) cache.delete(cache.keys().next().value!);
  cache.set(key, {
    spans: spans.map((span) => ({ y: span.y, start: span.start, end: span.end })),
    markup,
  });
  return markup;
}

function cachedNomadPath(country: { id: number; range?: number[] }): string {
  const range = country.range ?? [];
  let cache = nomadPathCaches.get(range);
  if (!cache) {
    cache = new Map();
    nomadPathCaches.set(range, cache);
  }
  const saved = cache.get(range.length);
  if (saved !== undefined) return saved;
  const path = contourPath(ContourArea.pixels(range));
  if (cache.size >= 8) cache.delete(cache.keys().next().value!);
  cache.set(range.length, path);
  return path;
}

export interface VectorMapViewport {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function staticSeaDepthMarkup(game: Game, bounds: VectorMapViewport): string {
  let cache = seaDepthMarkupCaches.get(game.world);
  if (!cache) {
    cache = new Map();
    seaDepthMarkupCaches.set(game.world, cache);
  }
  const key = `${bounds.x0}:${bounds.y0}:${bounds.x1}:${bounds.y1}`;
  const saved = cache.get(key);
  if (saved !== undefined) return saved;
  const markup = fillPaths(
    game,
    ['land', 'elevation'],
    bounds,
    (pixel) => !game.world.land[pixel],
  ).map((part) => part.markup).join('');
  if (cache.size >= 32) cache.delete(cache.keys().next().value!);
  cache.set(key, markup);
  return markup;
}

function buildVectorMapSvgPartsInternal(
  game: Game,
  bounds: VectorMapViewport,
  includeNomads: boolean,
  keyPrefix: string,
): VectorMapSvgPart[] {
  const snapshot = game.getSnapshot();
  const mode = snapshot.mapMode;
  const x0 = Math.max(0, Math.min(MAP_WIDTH, Math.floor(bounds.x0)));
  const y0 = Math.max(0, Math.min(MAP_HEIGHT - 1, Math.floor(bounds.y0)));
  const x1 = Math.max(x0, Math.min(MAP_WIDTH, Math.ceil(bounds.x1)));
  const y1 = Math.max(y0, Math.min(MAP_HEIGHT - 1, Math.ceil(bounds.y1)));
  const visibleBounds = { x0, y0, x1, y1 };
  const paths: VectorMapSvgPart[] = [{
    key: 'sea-depth',
    markup: staticSeaDepthMarkup(game, visibleBounds),
    order: 0,
  }];
  if (mode !== 'elevation') {
    paths.push(...fillPaths(game, contourLayersForMode(mode), visibleBounds, (pixel) => !!game.world.land[pixel]));
  }

  if (mode !== 'elevation') {
    const ownerAreas = new Map<number, ContourSpan[]>();
    const landSpans: ContourSpan[] = [];
    for (let y = y0; y <= y1; y += 1) {
      for (const span of game.world.contours.layer('owner').row(y)) {
        if (span.start >= x1) break;
        if (span.end <= x0 || span.value <= 0) continue;
        const area = ownerAreas.get(span.value) ?? [];
        area.push({ y, start: Math.max(x0, span.start), end: Math.min(x1, span.end) });
        ownerAreas.set(span.value, area);
      }
      for (const span of game.world.contours.layer('land').row(y)) {
        if (span.start >= x1) break;
        if (span.end <= x0 || span.value !== 1) continue;
        landSpans.push({ y, start: Math.max(x0, span.start), end: Math.min(x1, span.end) });
      }
    }
    for (const [ownerValue, spans] of ownerAreas) {
      const selected = snapshot.selectedCountryId === ownerValue - 1;
      const stroke = selected ? '#f0d28a' : '#654e3a';
      const width = selected ? 2.2 : 0.7;
      const key = `owner-boundary:${ownerValue}:${selected ? 'selected' : 'normal'}:${x0}:${y0}:${x1}:${y1}`;
      const markup = cachedContourMarkup(game, key, spans, (path) =>
        `<path d="${path}" fill="none" stroke="${stroke}" stroke-opacity="${selected ? 1 : 0.7}" stroke-width="${width}"/>`);
      if (markup) paths.push({ key: `owner-boundary:${ownerValue - 1}`, markup, order: 2 });
    }
    const coastKey = `coast:${x0}:${y0}:${x1}:${y1}`;
    const coastMarkup = cachedContourMarkup(game, coastKey, landSpans, (path) =>
      `<path d="${path}" fill="none" stroke="#654e3a" stroke-opacity=".65" stroke-width="1"/>`);
    if (coastMarkup) paths.push({ key: 'coast', markup: coastMarkup, order: 3 });
  }

  if (includeNomads) paths.push(...buildVectorMapSvgNomadParts(game));

  return keyPrefix
    ? paths.map((part) => ({ ...part, key: `${keyPrefix}${part.key}` }))
    : paths;
}

/** Создаёт отдельные SVG-слои, чтобы менять только изменившиеся контуры. */
export function buildVectorMapSvgParts(game: Game, bounds: VectorMapViewport): VectorMapSvgPart[] {
  return buildVectorMapSvgPartsInternal(game, bounds, true, '');
}

/** Пересобирает векторную геометрию одной изменившейся плитки. */
export function buildVectorMapSvgTileParts(
  game: Game,
  bounds: VectorMapViewport,
  tileId: number,
): VectorMapSvgPart[] {
  return buildVectorMapSvgPartsInternal(game, bounds, false, `tile:${tileId}:`);
}

/** Номадские территории остаются отдельными путями поверх плиток заливки. */
export function buildVectorMapSvgNomadParts(game: Game): VectorMapSvgPart[] {
  const snapshot = game.getSnapshot();
  if (snapshot.mapMode !== 'political' && snapshot.mapMode !== 'cities') return [];
  const paths: VectorMapSvgPart[] = [];
  for (const country of game.world.countries) {
    if (country.type !== 'nomadic' || !country.range?.length) continue;
    const path = cachedNomadPath(country);
    if (!path) continue;
    const color = vectorColorFor(game, {
      key: `country:${country.id}`,
      color: country.color,
      randomized: true,
    });
    const selected = snapshot.selectedCountryId === country.id;
    const outline = selected
      ? ` stroke="#f0d28a" stroke-width="2.2"`
      : '';
    paths.push({
      key: `nomad:${country.id}`,
      markup: `<path data-nomad="${country.id}" d="${path}" fill="${color}" fill-opacity=".48" fill-rule="evenodd"${outline}/>`,
      order: 4,
    });
  }
  return paths;
}

export function buildVectorMapSvg(game: Game, bounds: VectorMapViewport): string {
  return buildVectorMapSvgParts(game, bounds).map((part) => part.markup).join('');
}

export const VECTOR_MAP_HEIGHT = MAP_HEIGHT;
export const VECTOR_MAP_WIDTH = MAP_WIDTH;
