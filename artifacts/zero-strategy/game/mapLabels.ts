import { MAP_HEIGHT, MAP_WIDTH } from './config';
import type { MapMode } from './render';
import type { Country, World } from './world';

export interface CountryMapLabel {
  countryId: number;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  width: number;
  height: number;
  selected: boolean;
  bounds: [number, number, number, number];
}

type LabelCore = Omit<CountryMapLabel, 'selected'>;
const labelCache = new WeakMap<World, { version: number; territoryVersion: number; labels: LabelCore[] }>();
const nomadLabelCache = new WeakMap<World, {
  version: number;
  territoryVersion: number;
  labels: Map<number, LabelCore | null>;
}>();

function countryCore(world: World, country: Country): LabelCore | null {
  if (country.pixels <= 0 || !country.name) return null;
  const [x0, y0, x1, y1] = country.box;
  if (x1 < x0 || y1 < y0) return null;
  const centerX = (x0 + x1) / 2;
  const centerY = (y0 + y1) / 2;
  let best = { x: centerX, y: centerY, left: centerX, right: centerX, width: 0 };
  const firstRow = Math.max(y0, Math.floor(centerY - 64));
  const lastRow = Math.min(y1, Math.ceil(centerY + 64));
  for (let y = firstRow; y <= lastRow; y += 8) {
    let runStart = -1;
    for (let x = x0; x <= x1; x += 1) {
      const owned = world.owner[y * MAP_WIDTH + x] === country.id + 1;
      if (owned && runStart < 0) runStart = x;
      if ((!owned || x === x1) && runStart >= 0) {
        const runEnd = owned && x === x1 ? x : x - 1;
        const width = runEnd - runStart + 1;
        if (width > best.width) best = { x: (runStart + runEnd) / 2, y, left: runStart, right: runEnd, width };
        runStart = -1;
      }
    }
  }
  if (best.width < 1) return null;
  let top = best.y;
  let bottom = best.y;
  for (let y = best.y - 1; y >= y0 && world.owner[y * MAP_WIDTH + Math.round(best.x)] === country.id + 1; y -= 1) top = y;
  for (let y = best.y + 1; y <= y1 && world.owner[y * MAP_WIDTH + Math.round(best.x)] === country.id + 1; y += 1) bottom = y;
  const height = Math.max(1, bottom - top + 1);
  const fontSize = Math.min(40, best.width / Math.max(2, country.name.length * 0.62), height * 0.66);
  if (fontSize < 4) return null;
  return {
    countryId: country.id,
    text: country.name,
    x: best.x,
    y: (top + bottom) / 2,
    fontSize,
    width: country.name.length * fontSize * 0.62,
    height: fontSize * 1.2,
    bounds: [best.left, top, best.right, bottom] as [number, number, number, number],
  };
}

function settledCountryLabels(world: World): LabelCore[] {
  const cached = labelCache.get(world);
  if (cached?.version === world.version && cached.territoryVersion === world.territoryVersion) return cached.labels;
  const labels = world.countries
    .filter((country) => country.type === 'settled' && country.pixels > 0)
    .map((country) => countryCore(world, country))
    .filter((label): label is LabelCore => label !== null);
  labelCache.set(world, { version: world.version, territoryVersion: world.territoryVersion, labels });
  return labels;
}

function selectedNomadLabel(world: World, countryId: number): LabelCore | null {
  let cache = nomadLabelCache.get(world);
  if (!cache || cache.version !== world.version || cache.territoryVersion !== world.territoryVersion) {
    cache = { version: world.version, territoryVersion: world.territoryVersion, labels: new Map() };
    nomadLabelCache.set(world, cache);
  }
  if (cache.labels.has(countryId)) return cache.labels.get(countryId) ?? null;
  const country = world.countries[countryId];
  if (!country || country.type !== 'nomadic' || !country.range?.length) {
    cache.labels.set(countryId, null);
    return null;
  }
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const pixel of country.range) {
    if (!world.land[pixel]) continue;
    sumX += pixel % MAP_WIDTH;
    sumY += Math.floor(pixel / MAP_WIDTH);
    count += 1;
  }
  if (!count) {
    cache.labels.set(countryId, null);
    return null;
  }
  const x = sumX / count;
  const y = sumY / count;
  const center = country.range.reduce((best, pixel) => {
    const distance = (pixel % MAP_WIDTH - x) ** 2 + (Math.floor(pixel / MAP_WIDTH) - y) ** 2;
    return distance < best.distance ? { pixel, distance } : best;
  }, { pixel: country.range[0], distance: Infinity }).pixel;
  const fontSize = Math.min(40, Math.sqrt(count) * 0.9, country.name.length > 0 ? Math.sqrt(count) * 2.4 / country.name.length : 12);
  if (fontSize < 4) {
    cache.labels.set(countryId, null);
    return null;
  }
  const label = {
    countryId,
    text: country.name,
    x: center % MAP_WIDTH,
    y: Math.floor(center / MAP_WIDTH),
    fontSize,
    width: country.name.length * fontSize * 0.62,
    height: fontSize * 1.2,
    bounds: [x - Math.sqrt(count), y - Math.sqrt(count), x + Math.sqrt(count), y + Math.sqrt(count)] as [number, number, number, number],
  };
  cache.labels.set(countryId, label);
  return label;
}

function overlaps(a: CountryMapLabel, b: CountryMapLabel): boolean {
  return Math.abs(a.x - b.x) * 2 < a.width + b.width &&
    Math.abs(a.y - b.y) * 2 < a.height + b.height;
}

/** Подбирает подписи по реальному контуру страны и исключает наложение на выбранное кочевье. */
export function countryMapLabels(
  world: World,
  scale: number,
  mode: MapMode,
  selectedCountryId: number | null,
): CountryMapLabel[] {
  const labels: CountryMapLabel[] = [];
  if (mode === 'political' && selectedCountryId !== null) {
    const selected = selectedNomadLabel(world, selectedCountryId);
    if (selected && selected.fontSize * scale >= 7) labels.push({ ...selected, selected: true });
  }
  const blocked = labels[0];
  for (const core of settledCountryLabels(world)) {
    if (core.fontSize * scale < 7) continue;
    const label: CountryMapLabel = { ...core, selected: false };
    if (blocked && overlaps(label, blocked)) {
      const [x0, y0, x1, y1] = label.bounds;
      const shifts = [
        [0, -label.height * 1.5], [0, label.height * 1.5],
        [-label.width * 0.2, 0], [label.width * 0.2, 0],
      ] as const;
      let moved = false;
      for (const [dx, dy] of shifts) {
        const x = label.x + dx;
        const y = label.y + dy;
        if (x - label.width / 2 < x0 || x + label.width / 2 > x1 ||
          y - label.height / 2 < y0 || y + label.height / 2 > y1) continue;
        const candidate = { ...label, x, y };
        if (!overlaps(candidate, blocked)) {
          Object.assign(label, candidate);
          moved = true;
          break;
        }
      }
      if (!moved) continue;
    }
    labels.push(label);
  }
  return labels.filter((label) => label.x >= 0 && label.x < MAP_WIDTH && label.y >= 0 && label.y < MAP_HEIGHT);
}

export function geographicVisibilityScale(baseScale: number, elevation: number, active = false): number {
  if (active) return baseScale;
  const relative = Math.max(0, Math.min(1, (6500 - elevation) / 6500));
  return baseScale * (1 + relative * 1.4);
}

export function labelIsInMap(pixel: number): boolean {
  return pixel >= 0 && pixel < MAP_WIDTH * MAP_HEIGHT;
}
