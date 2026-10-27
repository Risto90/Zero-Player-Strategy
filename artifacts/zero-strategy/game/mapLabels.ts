import { ContourArea, type ContourBounds, type ContourSpan } from './contours';
import { MAP_HEIGHT, MAP_WIDTH } from './config';
import { HUMAN_ORIGINS } from './human';
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
}

type LabelCore = Omit<CountryMapLabel, 'selected'>;
const labelCache = new WeakMap<World, { version: number; territoryVersion: number; labels: LabelCore[] }>();
const nomadLabelCache = new WeakMap<World, {
  version: number;
  territoryVersion: number;
  labels: Map<number, LabelCore | null>;
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

function contourAreaBounds(area: ContourArea): ContourBounds {
  return area.bounds;
}

function labelTouchesComponent(
  area: ContourArea,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  const bounds = area.bounds;
  return x + width / 2 >= bounds.x0 &&
    x - width / 2 <= bounds.x1 + 1 &&
    y + height / 2 >= bounds.y0 &&
    y - height / 2 <= bounds.y1 + 1;
}

function labelCoverage(area: ContourArea, x: number, y: number, width: number, height: number): number {
  const left = x - width / 2;
  const right = x + width / 2;
  const top = y - height / 2;
  const bottom = y + height / 2;
  let covered = 0;
  let low = 0;
  let high = area.spans.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (area.spans[middle].y < top) low = middle + 1;
    else high = middle;
  }
  for (let index = low; index < area.spans.length; index += 1) {
    const span = area.spans[index];
    if (span.y > bottom) break;
    covered += Math.max(0, Math.min(right, span.end) - Math.max(left, span.start));
  }
  return covered / Math.max(1, width * height);
}

function labelCandidates(area: ContourArea): { x: number; y: number }[] {
  if (!area.spans.length) return [];
  const bounds = area.bounds;
  let weightedX = 0;
  let weightedY = 0;
  let total = 0;
  for (const span of area.spans) {
    const length = span.end - span.start;
    weightedX += (span.start + span.end - 1) * 0.5 * length;
    weightedY += span.y * length;
    total += length;
  }
  const candidates = [{ x: weightedX / total, y: weightedY / total }];
  const widest = [...area.spans]
    .sort((a, b) => (b.end - b.start) - (a.end - a.start))
    .slice(0, 24);
  for (const span of widest) candidates.push({ x: (span.start + span.end - 1) / 2, y: span.y });
  candidates.push({ x: (bounds.x0 + bounds.x1) / 2, y: (bounds.y0 + bounds.y1) / 2 });
  const unique = new Map<string, { x: number; y: number }>();
  for (const point of candidates) unique.set(`${Math.round(point.x)}:${Math.round(point.y)}`, point);
  return [...unique.values()];
}

function makeLabel(
  area: ContourArea,
  country: Pick<Country, 'id' | 'name'>,
  key: string,
  forceComponentLabel: boolean,
  requiredAreas: readonly ContourArea[] = [],
): LabelCore | null {
  if (!area.size || !country.name) return null;
  const countryBounds = contourAreaBounds(area);
  const areaWidth = countryBounds.x1 - countryBounds.x0 + 1;
  const areaHeight = countryBounds.y1 - countryBounds.y0 + 1;
  const widthFactor = textWidthFactor(country.name);
  const maximumFont = Math.min(42, areaWidth / widthFactor, areaHeight / 1.25);
  const candidates = labelCandidates(area);
  let best: { x: number; y: number; fontSize: number; width: number; height: number } | null = null;

  for (const point of candidates) {
    const localMax = Math.min(maximumFont, areaWidth / widthFactor, areaHeight / 1.25);
    for (let fontSize = localMax; fontSize >= 0.25; fontSize -= Math.max(0.1, localMax / 24)) {
      const width = widthFactor * fontSize;
      const height = fontSize * 1.2;
      if (requiredAreas.some((required) =>
        !labelTouchesComponent(required, point.x, point.y, width, height) ||
        labelCoverage(required, point.x, point.y, width, height) <= 0)) continue;
      if (labelCoverage(area, point.x, point.y, width, height) < 0.5) continue;
      if (!best || fontSize > best.fontSize) best = { ...point, fontSize, width, height };
      break;
    }
  }

  if (!best && forceComponentLabel) {
    const fallback = candidates[0];
    const fontSize = Math.min(4, maximumFont);
    if (fontSize <= 0) return null;
    best = { ...fallback, fontSize, width: widthFactor * fontSize, height: fontSize * 1.2 };
  }
  if (!best) return null;
  return {
    countryId: country.id,
    key,
    text: country.name,
    ...best,
    bounds: [
      best.x - best.width / 2,
      best.y - best.height / 2,
      best.x + best.width / 2,
      best.y + best.height / 2,
    ],
    countryBounds,
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
    if (components.length <= 1) {
      const label = makeLabel(area, country, `country-${country.id}-0`, true);
      if (label) labels.push(label);
      continue;
    }

    // Одна подпись допустима, только если больше половины её площади остаётся внутри страны.
    const shared = makeLabel(area, country, `country-${country.id}-all`, false, components);
    if (shared && labelCoverage(area, shared.x, shared.y, shared.width, shared.height) > 0.5) {
      labels.push(shared);
      continue;
    }
    components.forEach((component, index) => {
      const label = makeLabel(component, country, `country-${country.id}-part-${index}`, true);
      if (label) labels.push(label);
    });
  }
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
  if (!country || country.type !== 'nomadic' || !country.range?.length || !country.name) {
    cache.labels.set(countryId, null);
    return null;
  }
  const area = ContourArea.pixels(country.range).intersect(
    ContourArea.rectangle({ x0: 0, y0: 0, x1: MAP_WIDTH - 1, y1: MAP_HEIGHT - 1 }),
  );
  const components = area.components().sort((a, b) => b.size - a.size);
  const label = makeLabel(area, country, `nomad-${countryId}`, false) ??
    (components[0] ? makeLabel(components[0], country, `nomad-${countryId}`, true) : null);
  cache.labels.set(countryId, label);
  return label;
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
): CountryMapLabel[] {
  if (!shouldShowStateLabels(mode)) return [];
  const labels: CountryMapLabel[] = [];
  if (selectedCountryId !== null) {
    const selected = selectedNomadLabel(world, selectedCountryId);
    if (selected && (scale === null || labelVisible(selected.key, selected.fontSize * scale))) {
      labels.push({ ...selected, selected: true });
    }
  }
  const blocked = labels[0];
  for (const core of settledCountryLabels(world)) {
    if (scale !== null && !labelVisible(core.key, core.fontSize * scale)) continue;
    const label: CountryMapLabel = { ...core, selected: false };
    if (blocked && overlaps(label, blocked)) {
      const country = world.countries[core.countryId];
      const area = country ? countryArea(world, country) : null;
      const candidates = (area ? labelCandidates(area) : [])
        .filter((point) => area && labelCoverage(area, point.x, point.y, label.width, label.height) > 0.5)
        .map((point) => ({ ...label, ...point }))
        .filter((candidate) => !overlaps(candidate, blocked))
        .sort((a, b) => {
          const centerX = (core.countryBounds.x0 + core.countryBounds.x1) / 2;
          const centerY = (core.countryBounds.y0 + core.countryBounds.y1) / 2;
          return Math.hypot(a.x - centerX, a.y - centerY) - Math.hypot(b.x - centerX, b.y - centerY);
        });
      if (candidates.length) {
        label.x = candidates[0].x;
        label.y = candidates[0].y;
        label.bounds = [
          label.x - label.width / 2,
          label.y - label.height / 2,
          label.x + label.width / 2,
          label.y + label.height / 2,
        ];
      }
    }
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
      for (let index = 0; index < components.length; index += 1) {
        const key = `${definition.kind}-${id}-${index}`;
        const core = makeLabel(components[index], { id, name }, key, true);
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
    if (result.some((placed) => overlaps(core, placed))) continue;
    result.push({ ...core, selected: false });
  }
  return result;
}

export function shouldShowCityMarks(mode: MapMode): boolean {
  return mode === 'political' || mode === 'cities';
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
  fontSize: number;
  letterSpacing: number;
  territoryVisible: boolean;
  visible: boolean;
}

/** Масштабирует подпись вверх и удерживает её в окне, не показывая страну вне видимой карты. */
export function countryLabelViewportLayout(
  label: CountryMapLabel,
  scale: number,
  ox: number,
  oy: number,
  viewportWidth: number,
  viewportHeight: number,
  measuredTextWidthFactor?: number,
  visibilityThreshold = 11,
): CountryLabelViewportLayout {
  const bounds = label.countryBounds;
  const mapLeft = ox + bounds.x0 * scale;
  const mapRight = ox + (bounds.x1 + 1) * scale;
  const mapTop = oy + bounds.y0 * scale;
  const mapBottom = oy + (bounds.y1 + 1) * scale;
  const countryVisible = mapRight > 0 && mapLeft < viewportWidth && mapBottom > 0 && mapTop < viewportHeight;
  const factor = measuredTextWidthFactor && Number.isFinite(measuredTextWidthFactor) && measuredTextWidthFactor > 0
    ? measuredTextWidthFactor
    : textWidthFactor(label.text);
  const maxFont = Math.min(
    Math.max(0, (viewportWidth - 16) / factor),
    Math.max(0, (viewportHeight - 16) / 1.2),
  );
  const fontSize = Math.min(label.fontSize * scale, maxFont);
  const textWidth = factor * fontSize;
  const textHeight = fontSize * 1.2;
  const rawX = ox + label.x * scale;
  const rawY = oy + label.y * scale;
  const x = Math.max(textWidth / 2 + 8, Math.min(viewportWidth - textWidth / 2 - 8, rawX));
  const y = Math.max(textHeight / 2 + 8, Math.min(viewportHeight - textHeight / 2 - 8, rawY));
  const territoryVisible = countryVisible && fontSize > 0;
  return {
    x,
    y,
    fontSize,
    letterSpacing: fontSize * 0.16,
    territoryVisible,
    visible: territoryVisible && fontSize >= visibilityThreshold,
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
