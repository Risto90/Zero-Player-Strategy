import { ContourArea, type ContourBounds, type ContourSpan } from './contours';
import { MAP_HEIGHT, MAP_WIDTH } from './config';
import { cityLabelFontSize, cityVisibilityRank, isCityVisibleAtZoom } from './cityVisibility';
import { HUMAN_ORIGINS } from './human';
import {
  fitLabelToVisibleContour,
  type LabelAvoidanceRect,
  type LabelGeometryPoint,
} from './labelGeometry';
import type { EntityLayer, MapMode } from './render';
import type { Country, World } from './world';

export interface CountryMapLabel {
  countryId: number;
  key: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  width: number;
  height: number;
  selected: boolean;
  bounds: [number, number, number, number];
  countryBounds: ContourBounds;
  rings: readonly Int32Array[];
  allowBridge: boolean;
}

type LabelCore = Omit<CountryMapLabel, 'selected'>;
const labelCache = new WeakMap<World, { version: number; territoryVersion: number; labels: LabelCore[] }>();
const nomadLabelCache = new WeakMap<World, {
  version: number;
  territoryVersion: number;
  labels: Map<number, LabelCore[]>;
}>();
const entityAreaCache = new WeakMap<World, {
  version: number;
  territoryVersion: number;
  keys: Map<string, Map<number, ContourArea>>;
}>();
const entityLabelsCache = new WeakMap<World, {
  version: number;
  territoryVersion: number;
  labels: Map<string, LabelCore[]>;
}>();
const labelVisibility = new Map<string, boolean>();

function textWidthFactor(text: string): number {
  const count = [...text].length;
  return Math.max(1, count * 0.62 + Math.max(0, count - 1) * 0.16);
}

function labelLineVariants(text: string): string[][] {
  const variants = [[text]];
  const words = text.trim().split(/\s+/).filter(Boolean);
  for (const lineCount of [2, 3]) {
    if (words.length < lineCount) continue;
    const lines: string[] = [];
    let remaining = [...words];
    for (let lineIndex = 0; lineIndex < lineCount - 1; lineIndex += 1) {
      const linesLeft = lineCount - lineIndex;
      const targetLength = remaining.reduce((sum, word) => sum + word.length, 0) / linesLeft;
      let current: string[] = [];
      let currentLength = 0;
      const maxTake = remaining.length - (linesLeft - 1);
      while (current.length < maxTake) {
        const next = remaining[0];
        if (current.length > 0 &&
            Math.abs(currentLength - targetLength) <= Math.abs(currentLength + next.length + 1 - targetLength)) break;
        current.push(remaining.shift()!);
        currentLength += next.length + (current.length > 1 ? 1 : 0);
      }
      lines.push(current.join(' '));
    }
    lines.push(remaining.join(' '));
    variants.push(lines);
  }
  return variants;
}

function pointToSegmentDistance(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax, dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0
    ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared))
    : 0;
  return Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
}

/** Расстояние между границами вычисляется по векторным кольцам после быстрой проверки bbox. */
function contourDistance(first: ContourArea, second: ContourArea, limit: number): number {
  const a = first.bounds, b = second.bounds;
  const dx = Math.max(0, a.x0 - b.x1 - 1, b.x0 - a.x1 - 1);
  const dy = Math.max(0, a.y0 - b.y1 - 1, b.y0 - a.y1 - 1);
  if (Math.hypot(dx, dy) > limit) return Infinity;

  const firstRings = first.rings();
  const secondRings = second.rings();
  let closest = Infinity;
  for (const firstRing of firstRings) {
    for (let firstIndex = 0; firstIndex < firstRing.length; firstIndex += 2) {
      const firstX = firstRing[firstIndex], firstY = firstRing[firstIndex + 1];
      for (const secondRing of secondRings) {
        for (let secondIndex = 0; secondIndex < secondRing.length; secondIndex += 2) {
          const next = (secondIndex + 2) % secondRing.length;
          closest = Math.min(closest, pointToSegmentDistance(
            firstX,
            firstY,
            secondRing[secondIndex],
            secondRing[secondIndex + 1],
            secondRing[next],
            secondRing[next + 1],
          ));
          if (closest <= 0.01) return 0;
        }
      }
    }
  }
  for (const secondRing of secondRings) {
    for (let secondIndex = 0; secondIndex < secondRing.length; secondIndex += 2) {
      const secondX = secondRing[secondIndex], secondY = secondRing[secondIndex + 1];
      for (const firstRing of firstRings) {
        for (let firstIndex = 0; firstIndex < firstRing.length; firstIndex += 2) {
          const next = (firstIndex + 2) % firstRing.length;
          closest = Math.min(closest, pointToSegmentDistance(
            secondX,
            secondY,
            firstRing[firstIndex],
            firstRing[firstIndex + 1],
            firstRing[next],
            firstRing[next + 1],
          ));
          if (closest <= 0.01) return 0;
        }
      }
    }
  }
  return closest;
}

function nearbyComponentGroups(
  components: readonly ContourArea[],
  text: string,
): { index: number; areas: ContourArea[] }[] {
  if (!components.length) return [];
  const largest = components[0].bounds;
  const hRef = Math.min(
    42,
    (largest.x1 - largest.x0 + 1) / textWidthFactor(text),
    (largest.y1 - largest.y0 + 1) / 1.25,
  );
  const mergeDistance = 2 * Math.max(11, hRef);
  const groups: { index: number; areas: ContourArea[] }[] = [];
  components.forEach((component, index) => {
    const connected = groups.filter((group) =>
      group.areas.some((area) => contourDistance(component, area, mergeDistance) <= mergeDistance));
    if (!connected.length) {
      groups.push({ index, areas: [component] });
      return;
    }
    const target = connected[0];
    target.index = Math.min(target.index, index);
    target.areas.push(component);
    for (const extra of connected.slice(1)) {
      target.index = Math.min(target.index, extra.index);
      target.areas.push(...extra.areas);
      groups.splice(groups.indexOf(extra), 1);
    }
  });
  return groups.sort((a, b) => a.index - b.index);
}

function makeLabel(
  area: ContourArea,
  country: Pick<Country, 'id' | 'name'>,
  key: string,
  requiredAreas: readonly ContourArea[] = [],
): LabelCore | null {
  if (!area.size || !country.name) return null;
  const countryBounds = area.bounds;
  const areaWidth = countryBounds.x1 - countryBounds.x0 + 1;
  const areaHeight = countryBounds.y1 - countryBounds.y0 + 1;
  const widthFactor = textWidthFactor(country.name);
  const maximumFont = Math.min(42, areaWidth / widthFactor, areaHeight / 1.25);
  if (!(maximumFont > 0)) return null;
  const fontSize = maximumFont;
  const width = widthFactor * fontSize;
  const height = fontSize * 1.2;
  const x = (countryBounds.x0 + countryBounds.x1 + 1) / 2;
  const y = (countryBounds.y0 + countryBounds.y1 + 1) / 2;
  return {
    countryId: country.id,
    key,
    text: country.name,
    x,
    y,
    fontSize,
    width,
    height,
    bounds: [
      x - width / 2,
      y - height / 2,
      x + width / 2,
      y + height / 2,
    ],
    countryBounds,
    rings: area.rings(),
    allowBridge: requiredAreas.length > 1,
  };
}

function labelVisible(key: string, fontSize: number): boolean {
  const wasVisible = labelVisibility.get(key) ?? false;
  const visible = fontSize >= (wasVisible ? 9 : 11);
  if (labelVisibility.size >= 2048 && !labelVisibility.has(key)) {
    labelVisibility.delete(labelVisibility.keys().next().value!);
  }
  labelVisibility.set(key, visible);
  return visible;
}

function countryArea(world: World, country: Country): ContourArea {
  const [x0, y0, x1, y1] = country.box;
  return world.contours.layer('owner').select(
    (owner) => owner === country.id + 1,
    { x0, y0, x1, y1 },
    `map-label-owner-${country.id}-${world.territoryVersion}`,
  );
}

function settledCountryLabels(world: World): LabelCore[] {
  const cached = labelCache.get(world);
  if (cached?.version === world.version && cached.territoryVersion === world.territoryVersion) return cached.labels;
  const labels: LabelCore[] = [];
  for (const country of world.countries) {
    if (country.type !== 'settled' || country.pixels <= 0 || !country.name) continue;
    const area = countryArea(world, country);
    if (!area.size) continue;
    const components = area.components().sort((a, b) => b.size - a.size);
    for (const group of nearbyComponentGroups(components, country.name)) {
      const groupArea = group.areas.slice(1).reduce((combined, component) => combined.union(component), group.areas[0]);
      const label = makeLabel(
        groupArea,
        country,
        `country-${country.id}-cluster-${group.index}`,
        group.areas,
      );
      if (label) labels.push(label);
    }
  }
  labelCache.set(world, { version: world.version, territoryVersion: world.territoryVersion, labels });
  return labels;
}

function selectedNomadLabels(world: World, countryId: number): LabelCore[] {
  let cache = nomadLabelCache.get(world);
  if (!cache || cache.version !== world.version || cache.territoryVersion !== world.territoryVersion) {
    cache = { version: world.version, territoryVersion: world.territoryVersion, labels: new Map() };
    nomadLabelCache.set(world, cache);
  }
  if (cache.labels.has(countryId)) return cache.labels.get(countryId) ?? [];
  const country = world.countries[countryId];
  if (!country || country.type !== 'nomadic' || !country.range?.length || !country.name) {
    cache.labels.set(countryId, []);
    return [];
  }
  const area = ContourArea.pixels(country.range).intersect(
    ContourArea.rectangle({ x0: 0, y0: 0, x1: MAP_WIDTH - 1, y1: MAP_HEIGHT - 1 }),
  );
  const components = area.components().sort((a, b) => b.size - a.size);
  const labels = nearbyComponentGroups(components, country.name).flatMap((group) => {
    const groupArea = group.areas.slice(1).reduce((combined, component) => combined.union(component), group.areas[0]);
    const label = makeLabel(groupArea, country, `nomad-${countryId}-cluster-${group.index}`, group.areas);
    return label ? [label] : [];
  });
  cache.labels.set(countryId, labels);
  return labels;
}

function overlaps(
  a: Pick<CountryMapLabel, 'x' | 'y' | 'width' | 'height'>,
  b: Pick<CountryMapLabel, 'x' | 'y' | 'width' | 'height'>,
): boolean {
  return Math.abs(a.x - b.x) * 2 < a.width + b.width &&
    Math.abs(a.y - b.y) * 2 < a.height + b.height;
}

/** Подписи выбираются по областям контуров, включая отдельные части разделённых стран. */
export function countryMapLabels(
  world: World,
  scale: number | null,
  mode: MapMode,
  selectedCountryId: number | null,
  resolveCollisions = true,
): CountryMapLabel[] {
  if (!shouldShowStateLabels(mode)) return [];
  const labels: CountryMapLabel[] = [];
  const nomads = world.countries
    .filter((country) => country.type === 'nomadic')
    .flatMap((country) => selectedNomadLabels(world, country.id).map((core) => ({ country, core })))
    .sort((a, b) =>
      Number(b.country.id === selectedCountryId) - Number(a.country.id === selectedCountryId) ||
      b.core.fontSize - a.core.fontSize ||
      a.country.id - b.country.id);
  for (const { country, core } of nomads) {
    if (scale !== null && !labelVisible(core.key, core.fontSize * scale)) continue;
    const label: CountryMapLabel = { ...core, selected: country.id === selectedCountryId };
    if (!resolveCollisions || !labels.some((placed) => overlaps(label, placed))) labels.push(label);
  }
  const settled = [...settledCountryLabels(world)].sort((a, b) => b.fontSize - a.fontSize || a.countryId - b.countryId);
  for (const core of settled) {
    if (scale !== null && !labelVisible(core.key, core.fontSize * scale)) continue;
    const label: CountryMapLabel = { ...core, selected: false };
    if (resolveCollisions && labels.some((placed) => overlaps(label, placed))) continue;
    labels.push(label);
  }
  return labels.filter((label) => label.x >= 0 && label.x < MAP_WIDTH && label.y >= 0 && label.y < MAP_HEIGHT);
}

/**
 * Подписи культур, религий и рас строятся по диапазонам значений контурного слоя,
 * а не перебором отдельных точек карты. Без выбранного объекта подписываются
 * преобладающие группы; при выборе — все участки, где присутствует эта группа.
 */
export function entityMapLabels(
  world: World,
  mode: MapMode,
  selectedLayer: EntityLayer | null,
  scale?: number,
  resolveCollisions = true,
): CountryMapLabel[] {
  const definition = mode === 'cultures'
    ? { kind: 'culture' as const, contour: 'culture' as const, table: world.cultureTable, entities: world.cultures }
    : mode === 'religions'
      ? { kind: 'religion' as const, contour: 'religion' as const, table: world.religionTable, entities: world.religions }
      : mode === 'origins'
        ? {
          kind: 'origin' as const,
          contour: 'humanOrigins' as const,
          table: world.humanOriginTable,
          entities: HUMAN_ORIGINS.map((origin, id) => ({ id, name: origin.name })),
        }
        : null;
  if (!definition) return [];
  const selectedId = selectedLayer?.kind === definition.kind ? selectedLayer.id : null;
  const cache = entityAreaCache.get(world);
  const cacheKey = `${mode}:${selectedId ?? 'dominant'}`;
  let areaGroups: Map<number, ContourArea>;
  if (cache?.version === world.version && cache.territoryVersion === world.territoryVersion &&
      cache.keys.has(cacheKey)) {
    areaGroups = cache.keys.get(cacheKey)!;
  } else {
    let current = cache;
    if (!current || current.version !== world.version || current.territoryVersion !== world.territoryVersion) {
      current = {
        version: world.version,
        territoryVersion: world.territoryVersion,
        keys: new Map(),
      };
      entityAreaCache.set(world, current);
    }
    areaGroups = new Map<number, ContourArea>();
    const spansById = new Map<number, ContourSpan[]>();
    const layer = world.contours.layer(definition.contour);
    for (let y = 0; y < MAP_HEIGHT; y += 1) {
      for (const span of layer.row(y)) {
        const composition = definition.table.entries[span.value];
        if (!composition?.ids.length) continue;
        let targetId = selectedId;
        if (targetId !== null) {
          if (definition.table.shareOf(span.value, targetId) <= 0) continue;
        } else {
          let bestShare = 0;
          targetId = -1;
          for (let index = 0; index < composition.ids.length; index += 1) {
            const share = composition.shares[index] ?? 0;
            const entityId = composition.ids[index];
            if (share > bestShare || (share === bestShare && entityId < targetId)) {
              bestShare = share;
              targetId = entityId;
            }
          }
          if (bestShare <= 0 || targetId < 0) continue;
        }
        const spans = spansById.get(targetId) ?? [];
        spans.push({ y, start: span.start, end: span.end });
        spansById.set(targetId, spans);
      }
    }
    if (mode === 'origins') {
      // Кочевья не входят в слой оседлых контуров; их клетки добавляются отдельными контурами.
      for (const country of world.countries) {
        if (country.type !== 'nomadic') continue;
        for (const cell of country.cells ?? []) {
          if (!(cell.population > 0) || cell.pixel < 0 || cell.pixel >= MAP_WIDTH * MAP_HEIGHT || !world.land[cell.pixel]) continue;
          const composition = definition.table.entries[cell.humanOriginMix];
          if (!composition?.ids.length) continue;
          let targetId = selectedId;
          if (targetId !== null) {
            if (definition.table.shareOf(cell.humanOriginMix, targetId) <= 0) continue;
          } else {
            let bestShare = 0;
            targetId = -1;
            for (let index = 0; index < composition.ids.length; index += 1) {
              const share = composition.shares[index] ?? 0;
              const entityId = composition.ids[index];
              if (share > bestShare || (share === bestShare && entityId < targetId)) {
                bestShare = share;
                targetId = entityId;
              }
            }
            if (bestShare <= 0 || targetId < 0) continue;
          }
          const y = Math.floor(cell.pixel / MAP_WIDTH);
          const start = cell.pixel - y * MAP_WIDTH;
          const spans = spansById.get(targetId) ?? [];
          spans.push({ y, start, end: start + 1 });
          spansById.set(targetId, spans);
        }
      }
    }
    for (const [id, spans] of spansById) areaGroups.set(id, new ContourArea(spans));
    current.keys.set(cacheKey, areaGroups);
    if (current.keys.size > 6) current.keys.delete(current.keys.keys().next().value!);
  }

  let labelCache = entityLabelsCache.get(world);
  if (!labelCache || labelCache.version !== world.version || labelCache.territoryVersion !== world.territoryVersion) {
    labelCache = { version: world.version, territoryVersion: world.territoryVersion, labels: new Map() };
    entityLabelsCache.set(world, labelCache);
  }
  let cores = labelCache.labels.get(cacheKey);
  if (!cores) {
    const names = new Map<number, string>();
    for (const entity of definition.entities) {
      const name = 'name' in entity ? entity.name : '';
      if (name) names.set(entity.id, name);
    }
    cores = [];
    for (const [id, area] of areaGroups) {
      const name = names.get(id);
      if (!name || !area.size) continue;
      const components = area.components().sort((a, b) => b.size - a.size);
      for (const group of nearbyComponentGroups(components, name)) {
        const groupArea = group.areas.slice(1).reduce((combined, component) => combined.union(component), group.areas[0]);
        const key = `${definition.kind}-${id}-cluster-${group.index}`;
        const core = makeLabel(groupArea, { id, name }, key, group.areas);
        if (core) cores.push(core);
      }
    }
    cores.sort((a, b) => b.width * b.height - a.width * a.height || a.key.localeCompare(b.key));
    labelCache.labels.set(cacheKey, cores);
    if (labelCache.labels.size > 6) labelCache.labels.delete(labelCache.labels.keys().next().value!);
  }
  const result: CountryMapLabel[] = [];
  for (const core of cores) {
    if (scale !== undefined && !labelVisible(core.key, core.fontSize * scale)) continue;
    if (resolveCollisions && result.some((placed) => overlaps(core, placed))) continue;
    result.push({ ...core, selected: false });
  }
  return result;
}

export function shouldShowCityMarks(mode: MapMode): boolean {
  return mode === 'political' || mode === 'cities';
}

/** Подбирает подписи только для видимых значков города, не допуская наложения названий. */
export function visibleCityLabelIds(
  world: World,
  mode: MapMode,
  scale: number,
  baseScale: number,
  ox: number,
  oy: number,
  viewportWidth: number,
  viewportHeight: number,
  occupiedLabels: readonly { left: number; top: number; right: number; bottom: number }[] = [],
): Set<number> {
  const visible = new Set<number>();
  if (!shouldShowCityMarks(mode)) return visible;

  const cellSize = 64;
  const occupied = new Map<string, { left: number; top: number; right: number; bottom: number }[]>();
  const keysFor = (rect: { left: number; top: number; right: number; bottom: number }) => {
    const keys: string[] = [];
    for (let x = Math.floor(rect.left / cellSize); x <= Math.floor(rect.right / cellSize); x += 1) {
      for (let y = Math.floor(rect.top / cellSize); y <= Math.floor(rect.bottom / cellSize); y += 1) {
        keys.push(`${x}:${y}`);
      }
    }
    return keys;
  };
  const isFree = (rect: { left: number; top: number; right: number; bottom: number }) => {
    const checked = new Set<object>();
    for (const key of keysFor(rect)) {
      for (const other of occupied.get(key) ?? []) {
        if (checked.has(other)) continue;
        checked.add(other);
        if (rect.left < other.right && rect.right > other.left && rect.top < other.bottom && rect.bottom > other.top) {
          return false;
        }
      }
    }
    return true;
  };
  const occupy = (rect: { left: number; top: number; right: number; bottom: number }) => {
    for (const key of keysFor(rect)) {
      const bucket = occupied.get(key) ?? [];
      bucket.push(rect);
      occupied.set(key, bucket);
    }
  };
  for (const rect of occupiedLabels) occupy(rect);

  const candidates = world.cities
    .map((city) => {
      const hasPort = world.isCoastal(city.pixel) || world.knownRivers[city.pixel] > 0;
      return { city, hasPort, zoomRank: cityVisibilityRank(city, hasPort) };
    })
    .filter(({ city, zoomRank }) => city.name && isCityVisibleAtZoom(scale, baseScale, zoomRank))
    .sort((a, b) =>
      Number(b.city.capital) - Number(a.city.capital) ||
      b.city.rank - a.city.rank ||
      a.zoomRank - b.zoomRank ||
      a.city.id - b.city.id);

  for (const { city, hasPort } of candidates) {
    let fontSize = cityLabelFontSize(scale, baseScale);
    const textUnits = [...(city.name ?? '')].length * 0.62 + Number(city.capital) * 1.1;
    fontSize = Math.min(fontSize, Math.max(0, viewportWidth - 16) / Math.max(1, textUnits));
    if (fontSize < 8) continue;

    const x = ox + (city.pixel % MAP_WIDTH) * scale;
    const y = oy + Math.floor(city.pixel / MAP_WIDTH) * scale;
    const iconSize = hasPort ? 30 + city.rank : 24 + city.rank;
    const width = ([...(city.name ?? '')].length * 0.62 + Number(city.capital) * 1.1) * fontSize;
    const height = fontSize * 1.2;
    const labelBottom = y - iconSize / 2 - Math.max(2, fontSize * 0.22);
    const label = {
      left: x - width / 2 - 3,
      right: x + width / 2 + 3,
      top: labelBottom - height,
      bottom: labelBottom + 2,
    };
    if (
      label.left < 8 || label.right > viewportWidth - 8 ||
      label.top < 8 || label.bottom > viewportHeight - 8 ||
      !isFree(label)
    ) continue;
    visible.add(city.id);
    occupy(label);
    occupy({
      left: x - iconSize / 2 - 2,
      right: x + iconSize / 2 + 2,
      top: y - iconSize / 2 - 2,
      bottom: y + iconSize / 2 + 2,
    });
  }
  return visible;
}

export function shouldShowGeographyMarks(mode: MapMode): boolean {
  return mode === 'political' || mode === 'elevation';
}

export function shouldShowStateLabels(mode: MapMode): boolean {
  return mode === 'political' || mode === 'cities';
}

/** Web-холст запоминает гистерезис между кадрами; нативный холст использует shared value. */
export function labelVisibilityThreshold(key: string): number {
  return labelVisibility.get(key) ? 9 : 11;
}

export interface CountryLabelViewportLayout {
  x: number;
  y: number;
  worldX: number;
  worldY: number;
  lines: string[];
  fontSize: number;
  letterSpacing: number;
  angle: number;
  path: LabelGeometryPoint[] | null;
  territoryVisible: boolean;
  visible: boolean;
}

/** Повторно размещает подпись по видимой части контура, не смещая её за пределы своей территории. */
export function countryLabelViewportLayout(
  label: CountryMapLabel,
  scale: number,
  ox: number,
  oy: number,
  viewportWidth: number,
  viewportHeight: number,
  measuredTextWidthFactor?: number,
  visibilityThreshold = 11,
  measureLineWidthFactor?: (text: string) => number,
  obstacles: readonly LabelAvoidanceRect[] = [],
): CountryLabelViewportLayout {
  const worldBounds = label.countryBounds;
  const screenLeft = ox + worldBounds.x0 * scale;
  const screenRight = ox + (worldBounds.x1 + 1) * scale;
  const screenTop = oy + worldBounds.y0 * scale;
  const screenBottom = oy + (worldBounds.y1 + 1) * scale;
  if (screenRight <= 8 || screenLeft >= viewportWidth - 8 ||
      screenBottom <= 8 || screenTop >= viewportHeight - 8) {
    return {
      x: 0,
      y: 0,
      worldX: 0,
      worldY: 0,
      lines: [],
      fontSize: 0,
      letterSpacing: 0,
      angle: 0,
      path: null,
      territoryVisible: false,
      visible: false,
    };
  }
  const factor = measuredTextWidthFactor && Number.isFinite(measuredTextWidthFactor) && measuredTextWidthFactor > 0
    ? measuredTextWidthFactor
    : textWidthFactor(label.text);
  const visibleCore = label.rings.some((ring) => ring.length >= 6);
  const viewportCap = Math.max(visibilityThreshold, Math.min(48, Math.min(viewportWidth, viewportHeight) * 0.045));
  const maxFont = Math.min(viewportCap, Math.max(visibilityThreshold, label.fontSize * scale * 1.5));
  let fitted: ReturnType<typeof fitLabelToVisibleContour> = null;
  let fittedLines = [label.text];
  if (visibleCore) {
    for (const lines of labelLineVariants(label.text)) {
      const longestLine = lines.reduce((longest, line) => {
        const width = measureLineWidthFactor?.(line) ?? textWidthFactor(line);
        const longestWidth = measureLineWidthFactor?.(longest) ?? textWidthFactor(longest);
        return width > longestWidth ? line : longest;
      });
      const candidate = fitLabelToVisibleContour({
      rings: label.rings,
      scale,
      ox,
      oy,
      viewportWidth,
      viewportHeight,
      glyphWidthFactor: measureLineWidthFactor?.(longestLine) ??
        (lines.length === 1 ? factor : textWidthFactor(longestLine)),
      glyphCount: [...longestLine].length,
      lineCount: lines.length,
      maxFontSize: maxFont,
      allowBridge: label.allowBridge,
      obstacles,
      });
      if (candidate && (!fitted || candidate.fontSize > fitted.fontSize + 0.1 ||
          (Math.abs(candidate.fontSize - fitted.fontSize) <= 0.1 && lines.length < fittedLines.length))) {
        fitted = candidate;
        fittedLines = lines;
      }
    }
  }
  const fontSize = fitted?.fontSize ?? 0;
  const visible = fitted ? labelVisible(label.key, fontSize) : false;
  return {
    x: fitted?.x ?? 0,
    y: fitted?.y ?? 0,
    worldX: fitted?.worldX ?? 0,
    worldY: fitted?.worldY ?? 0,
    lines: fitted ? fittedLines : [],
    fontSize,
    letterSpacing: fitted?.letterSpacing ?? 0,
    angle: fitted?.angle ?? 0,
    path: fitted?.path ?? null,
    territoryVisible: visibleCore,
    visible: visible && fontSize >= visibilityThreshold,
  };
}

export function geographicVisibilityScale(baseScale: number, elevation: number): number {
  const relative = Math.max(0, Math.min(1, (6500 - elevation) / 6500));
  return baseScale * (1 + relative * 1.4);
}

/** Частые и мощные извержения видны раньше; редкие слабые требуют крупного масштаба. */
export function volcanoVisibilityScale(
  baseScale: number,
  intervalYears = 226,
  eruptionIntensity = 1,
): number {
  const activity = Math.max(0, Math.min(1, (24 / Math.max(1, intervalYears)) * (Math.max(1, eruptionIntensity) / 3)));
  return baseScale * (1 + (1 - activity) * 9);
}

export { riverVisibilityScale } from './geographyGeometry';

export function labelIsInMap(pixel: number): boolean {
  return pixel >= 0 && pixel < MAP_WIDTH * MAP_HEIGHT;
}
