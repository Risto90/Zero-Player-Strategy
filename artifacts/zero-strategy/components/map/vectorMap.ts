import { ContourArea, type ContourLayerName, type ContourSpan } from '@/game/contours';
import { ELEVATION_COLOR_STOPS, SEA_DEPTH_RAMP, type VectorPaintInfo } from '@/game/render';
import { MAP_HEIGHT, MAP_WIDTH } from '@/game/config';
import type { Game } from '@/game/game';

type RGB = [number, number, number];

interface CachedVectorColor {
  colors: Map<string, string>;
  fixed: Set<string>;
}

const colorCaches = new Map<string, CachedVectorColor>();
const markupCaches = new WeakMap<object, Map<string, string>>();

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
      ...SEA_DEPTH_RAMP,
      ...ELEVATION_COLOR_STOPS.map(([, color]) => color),
      '#000000',
      '#ffffff',
    ]),
  };
  colorCaches.set(playerKey, result);
  return result;
}

function chooseSeparatedColor(cache: CachedVectorColor): string {
  const known = [...cache.fixed, ...cache.colors.values()].map(rgb);
  const candidates: RGB[] = [];
  for (const r of [24, 72, 120, 168, 216, 240]) {
    for (const g of [24, 72, 120, 168, 216, 240]) {
      for (const b of [24, 72, 120, 168, 216, 240]) {
        if ((r <= 24 && g <= 24 && b <= 24) || (r >= 240 && g >= 240 && b >= 240)) continue;
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

export function vectorColorFor(game: Game, paint: VectorPaintInfo): string {
  if (!paint.randomized) return paint.color;
  const cache = colorsFor(game);
  const found = cache.colors.get(paint.key);
  if (found) return found;
  const color = chooseSeparatedColor(cache);
  cache.colors.set(paint.key, color);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(`zero-strategy-map-contour-colors:${game.world.seed}:${game.getSnapshot().role}:${game.getSnapshot().focusCountry?.id ?? 'world'}`,
        JSON.stringify(Object.fromEntries(cache.colors)));
    } catch {
      // Переполненное хранилище не меняет отрисовку текущего сеанса.
    }
  }
  return color;
}

function contourPath(area: ContourArea): string {
  const stride = MAP_WIDTH + 1;
  const commands: string[] = [];
  for (const ring of area.rings()) {
    if (ring.length < 4) continue;
    let path = `M${ring[0] % stride} ${Math.floor(ring[0] / stride)}`;
    for (let index = 1; index < ring.length; index += 1) {
      path += `L${ring[index] % stride} ${Math.floor(ring[index] / stride)}`;
    }
    commands.push(`${path}Z`);
  }
  return commands.join('');
}

function visibleLayers(game: Game, mode: ReturnType<Game['getSnapshot']>['mapMode']): ContourLayerName[] {
  const layers: ContourLayerName[] = ['land', 'elevation'];
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

export interface VectorMapViewport {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
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
  const cacheKey = `${game.world.version}:${mode}:${layerKey}:${x0}:${y0}:${x1}:${y1}`;
  let cache = markupCaches.get(game.world);
  if (!cache) {
    cache = new Map();
    markupCaches.set(game.world, cache);
  }
  const cachedMarkup = cache.get(cacheKey);
  if (cachedMarkup) return cachedMarkup;
  const layers = visibleLayers(game, mode);
  const areas = new Map<string, { color: string; spans: ContourSpan[] }>();

  for (let y = y0; y <= y1; y += 1) {
    for (const span of spansForRow(game, layers, y, x0, x1)) {
      const pixel = y * MAP_WIDTH + span.start;
      if (mode === 'elevation' && game.world.land[pixel]) continue;
      const paint = game.renderer.vectorPaintAt(pixel);
      const color = vectorColorFor(game, paint);
      const key = `${paint.key}:${color}`;
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
    for (const spans of ownerAreas.values()) {
      const path = contourPath(new ContourArea(spans));
      if (path) paths.push(`<path d="${path}" fill="none" stroke="#654e3a" stroke-opacity=".7" stroke-width=".7"/>`);
    }
    const coast = contourPath(new ContourArea(landSpans));
    if (coast) paths.push(`<path d="${coast}" fill="none" stroke="#654e3a" stroke-opacity=".65" stroke-width="1"/>`);
  }

  if (mode === 'political') {
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
      paths.push(`<path data-nomad="${country.id}" d="${path}" fill="${color}" fill-opacity=".48" fill-rule="evenodd"/>`);
    }
  }

  const markup = paths.join('');
  if (cache.size >= 12) cache.delete(cache.keys().next().value!);
  cache.set(cacheKey, markup);
  return markup;
}

export const VECTOR_MAP_HEIGHT = MAP_HEIGHT;
export const VECTOR_MAP_WIDTH = MAP_WIDTH;
