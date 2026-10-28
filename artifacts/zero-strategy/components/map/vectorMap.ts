import { ContourArea, type ContourLayerName, type ContourSpan } from '@/game/contours';
import type { VectorPaintInfo } from '@/game/render';
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

interface CachedContourColorGraph {
  revision: number;
  graph: ContourColorGraph;
}

const colorCaches = new Map<string, CachedVectorColor>();
const markupCaches = new WeakMap<object, Map<string, string>>();
const colorGraphCaches = new WeakMap<object, Map<string, CachedContourColorGraph>>();
const seaDepthMarkupCaches = new WeakMap<object, Map<string, string>>();

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

function visibleLayers(game: Game, mode: ReturnType<Game['getSnapshot']>['mapMode']): ContourLayerName[] {
  const layers: ContourLayerName[] = ['land'];
  if (mode === 'political' || mode === 'cities' || mode === 'origins') {
    layers.push('owner', 'humidity', 'temperature', 'drainage');
  }
  if (mode === 'cities') layers.push('cityIdAt');
  if (mode === 'biomes') layers.push('humidity', 'temperature', 'drainage');
  if (mode === 'cultures') layers.push('owner', 'culture');
  if (mode === 'religions') layers.push('owner', 'religion');
  if (mode === 'humidity') layers.push('humidity');
  if (mode === 'temperature') layers.push('temperature');
  if (mode === 'drainage') layers.push('drainage');
  if (mode === 'density') layers.push('density');
  if (mode === 'origins') layers.push('humanOrigins', 'cityIdAt');
  return [...new Set(layers)];
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
  const revision = game.world.contours.revision;
  let cache = colorGraphCaches.get(game.world);
  if (!cache) {
    cache = new Map();
    colorGraphCaches.set(game.world, cache);
  }
  const saved = cache.get(mode);
  if (saved?.revision === revision) return saved.graph;

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
  const layers = visibleLayers(game, mode);
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
  cache.clear();
  cache.set(mode, { revision, graph });
  return graph;
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
  const color = chooseSeparatedColor([...cache.colors.values()], cache.fixed);
  cache.colors.set(paint.key, color);
  persistVectorColors(game, cache);
  return color;
}

function fillPaths(
  game: Game,
  layers: readonly ContourLayerName[],
  bounds: VectorMapViewport,
  accepts: (pixel: number) => boolean,
): string[] {
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
  const paths: string[] = [];
  for (const [key, area] of areas) {
    const path = contourPath(new ContourArea(area.spans, true));
    if (path) paths.push(`<path data-contour="${key}" d="${path}" fill="${area.color}" fill-rule="evenodd"/>`);
  }
  return paths;
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
  ).join('');
  if (cache.size >= 32) cache.delete(cache.keys().next().value!);
  cache.set(key, markup);
  return markup;
}

/** Создаёт SVG-заливки из пересечений контурных строк только в видимой области. */
export function buildVectorMapSvg(game: Game, bounds: VectorMapViewport): string {
  const snapshot = game.getSnapshot();
  const mode = snapshot.mapMode;
  const x0 = Math.max(0, Math.min(MAP_WIDTH, Math.floor(bounds.x0)));
  const y0 = Math.max(0, Math.min(MAP_HEIGHT - 1, Math.floor(bounds.y0)));
  const x1 = Math.max(x0, Math.min(MAP_WIDTH, Math.ceil(bounds.x1)));
  const y1 = Math.max(y0, Math.min(MAP_HEIGHT - 1, Math.ceil(bounds.y1)));
  const layerKey = game.renderer.layer ? `${game.renderer.layer.kind}:${game.renderer.layer.id}` : '';
  const cacheKey = `${game.renderer.visualRevision}:${mode}:${layerKey}:${x0}:${y0}:${x1}:${y1}`;
  let cache = markupCaches.get(game.world);
  if (!cache) {
    cache = new Map();
    markupCaches.set(game.world, cache);
  }
  const cachedMarkup = cache.get(cacheKey);
  if (cachedMarkup) return cachedMarkup;
  const visibleBounds = { x0, y0, x1, y1 };
  const paths = [staticSeaDepthMarkup(game, visibleBounds)];
  if (mode !== 'elevation') {
    paths.push(...fillPaths(game, visibleLayers(game, mode), visibleBounds, (pixel) => !!game.world.land[pixel]));
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
      const path = contourPath(new ContourArea(spans));
      const selected = snapshot.selectedCountryId === ownerValue - 1;
      if (path) {
        const stroke = selected ? '#f0d28a' : '#654e3a';
        const width = selected ? 2.2 : 0.7;
        paths.push(`<path d="${path}" fill="none" stroke="${stroke}" stroke-opacity="${selected ? 1 : 0.7}" stroke-width="${width}"/>`);
      }
    }
    const coast = contourPath(new ContourArea(landSpans));
    if (coast) paths.push(`<path d="${coast}" fill="none" stroke="#654e3a" stroke-opacity=".65" stroke-width="1"/>`);
  }

  if (mode === 'political' || mode === 'cities') {
    for (const country of game.world.countries) {
      if (country.type !== 'nomadic' || !country.range?.length) continue;
      const area = ContourArea.pixels(country.range);
      const path = contourPath(area);
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
      paths.push(`<path data-nomad="${country.id}" d="${path}" fill="${color}" fill-opacity=".48" fill-rule="evenodd"${outline}/>`);
    }
  }

  const markup = paths.join('');
  if (cache.size >= 12) cache.delete(cache.keys().next().value!);
  cache.set(cacheKey, markup);
  return markup;
}

export const VECTOR_MAP_HEIGHT = MAP_HEIGHT;
export const VECTOR_MAP_WIDTH = MAP_WIDTH;
