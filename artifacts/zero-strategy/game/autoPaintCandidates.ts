import type { CardPainter } from './brush';
import { MAP_HEIGHT, MAP_WIDTH } from './config';
import { ContourArea } from './contours';
import { forEachNeighbour } from './geography';
import type { Country } from './world';

export interface CompetitiveContourSelection<T> {
  candidate: T;
  sampleSize: number;
}

/**
 * Расширяет выборку соперников по одному: выгодные варианты сравниваются
 * с худшим контуром текущей выборки, а на последнем шаге остаётся последний
 * доступный вариант без соперника.
 */
export function selectCompetitiveContour<T extends { accessible: { size: number } }>(
  candidates: readonly T[],
  requestedSampleSize: number,
  limit: (candidate: T, competitor: T | null) => T | null,
  compare: (left: T, right: T) => number,
): CompetitiveContourSelection<T> | null {
  if (!candidates.length) return null;
  const firstSampleSize = Math.min(
    candidates.length,
    Math.max(2, Math.floor(requestedSampleSize)),
  );
  for (let sampleSize = firstSampleSize; sampleSize <= candidates.length; sampleSize += 1) {
    const hasCompetitor = sampleSize > 1;
    const competitor = hasCompetitor ? candidates[sampleSize - 1] : null;
    const choiceCount = hasCompetitor ? sampleSize - 1 : sampleSize;
    const available: T[] = [];
    for (let index = 0; index < choiceCount; index += 1) {
      const bounded = limit(candidates[index], competitor);
      if (bounded?.accessible.size) available.push(bounded);
    }
    if (available.length) {
      available.sort(compare);
      return { candidate: available[0], sampleSize };
    }
    if (hasCompetitor && sampleSize === candidates.length) {
      const last = limit(candidates[sampleSize - 1], null);
      if (last?.accessible.size) return { candidate: last, sampleSize };
    }
  }
  return null;
}

export const MAX_SCORE_CENTERS = 24;
export const MAX_TERRITORY_DABS = 256;
export const MAX_LAYER_FALLBACK_DABS = MAP_WIDTH * MAP_HEIGHT;
const CLIMATE_REGION_SAMPLE_LIMIT = 4096;

/** Подбирает ограниченный набор точек-кандидатов для автоматической кисти. */
export class AutoPaintCandidateSelector {
  private static readonly LAYER_CARDS = new Set([
    'drought', 'rain', 'desertification', 'swamping',
    'warmCurrent', 'coldCurrent', 'warmWind', 'coldWind', 'faith', 'culture',
  ]);
  private static readonly CLIMATE_CARDS = new Set([
    'drought', 'rain', 'desertification', 'swamping',
    'warmCurrent', 'coldCurrent', 'warmWind', 'coldWind',
  ]);
  private static readonly TERRITORY_SCORE_OFFSETS = AutoPaintCandidateSelector.circleOffsets(10);
  private static readonly OTHER_SCORE_OFFSETS = AutoPaintCandidateSelector.circleOffsets(16);

  constructor(private readonly painter: CardPainter) {}

  static scoreOffsets(radius: number): Int16Array {
    return radius === 10 ? this.TERRITORY_SCORE_OFFSETS : this.OTHER_SCORE_OFFSETS;
  }

  isLayerCard(): boolean {
    return AutoPaintCandidateSelector.LAYER_CARDS.has(this.painter.card.type);
  }

  bounded(): number[] {
    if (AutoPaintCandidateSelector.CLIMATE_CARDS.has(this.painter.card.type)) {
      return this.climateContourCandidates();
    }
    const pixels = this.candidates();
    if (pixels.length <= MAX_SCORE_CENTERS) return pixels;
    const sampleCount = MAX_SCORE_CENTERS;
    const stride = pixels.length / sampleCount;
    const sampled = Array.from(
      { length: sampleCount },
      (_, index) => pixels[Math.floor(index * stride)],
    );
    if (this.painter.card.hint >= 0 && !sampled.includes(this.painter.card.hint)) {
      sampled.push(this.painter.card.hint);
    }
    return [...new Set(sampled)].sort((a, b) => a - b);
  }

  private climateContourCandidates(): number[] {
    const bounds = { x0: 0, y0: 0, x1: MAP_WIDTH - 1, y1: MAP_HEIGHT - 1 };
    const target = this.painter.strategyLayerTargetArea(bounds);
    const occupied = this.painter.world.contours.layer('density')
      .select((value) => value > 0, bounds)
      .union(ContourArea.pixels(this.painter.world.cities
        .filter((city) => city.population > 0)
        .map((city) => city.pixel)))
      .intersect(target);
    const regions = this.painter.world.contours.climateIntersections(occupied);
    const sampleCount = Math.min(CLIMATE_REGION_SAMPLE_LIMIT, regions.length);
    const stride = sampleCount > 0 ? regions.length / sampleCount : 0;
    const spatial: number[] = [];
    const ranked: { pixel: number; value: number }[] = [];
    for (let index = 0; index < sampleCount; index += 1) {
      const region = regions[Math.floor(index * stride)];
      const spans = region.area.spans;
      if (!spans.length) continue;
      const rows = spans.length <= 3
        ? spans
        : [spans[0], spans[Math.floor((spans.length - 1) / 2)], spans[spans.length - 1]];
      for (const span of rows) {
        const pixel = span.y * MAP_WIDTH + Math.floor((span.start + span.end - 1) / 2);
        const cost = this.painter.strategyInkCostAt(pixel);
        if (cost <= 0) continue;
        spatial.push(pixel);
        const impact = this.painter.strategyImpactAt(pixel);
        if (impact > 0) ranked.push({ pixel, value: impact / cost });
      }
    }
    const spatialCount = Math.ceil(MAX_SCORE_CENTERS / 2);
    const spatialStride = spatial.length / spatialCount;
    const sampled = spatial.length <= MAX_SCORE_CENTERS
      ? spatial
      : Array.from(
        { length: spatialCount },
        (_, index) => spatial[Math.floor(index * spatialStride)],
      );
    ranked.sort((a, b) => b.value - a.value || a.pixel - b.pixel);
    sampled.push(...ranked
      .slice(0, MAX_SCORE_CENTERS - Math.min(spatialCount, sampled.length))
      .map((candidate) => candidate.pixel));
    if (this.painter.card.hint >= 0 && !sampled.includes(this.painter.card.hint)) {
      sampled.push(this.painter.card.hint);
    }
    return [...new Set(sampled)].sort((a, b) => a - b);
  }

  private static circleOffsets(radius: number): Int16Array {
    const offsets: number[] = [];
    const radiusSquared = radius * radius;
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx * dx + dy * dy <= radiusSquared) offsets.push(dx, dy);
      }
    }
    return Int16Array.from(offsets);
  }

  private candidates(): number[] {
    const { world, card } = this.painter;
    const candidates = new Set<number>();
    const target = card.type === 'create' && card.newCountryId !== null
      ? world.countries[card.newCountryId]
      : card.targetCountryId === null ? null : world.countries[card.targetCountryId];

    if (this.isLayerCard()) {
      for (let pixel = 0; pixel < world.land.length; pixel += 1) {
        if (this.painter.strategyInkCostAt(pixel) > 0) candidates.add(pixel);
      }
    } else if ((card.type === 'create' && (!target || target.pixels === 0)) ||
      card.type === 'warmCurrent' || card.type === 'coldCurrent' ||
      (card.targetCountryId === null && ['drought', 'rain', 'faith', 'culture'].includes(card.type))) {
      this.globalSeeds(candidates);
      const activeCountries = world.countries.filter((country) => country.pixels > 0);
      const perCountryLimit = Math.max(8, Math.floor(900 / Math.max(1, activeCountries.length)));
      for (const country of activeCountries) this.addCountrySeeds(country, candidates, perCountryLimit);
    } else if (card.type === 'expand' && target) {
      if (card.developmentOnly) this.addCountrySeeds(target, candidates);
      const owned = new Set<number>();
      this.addCountrySeeds(target, owned);
      const seas = new Set<number>();
      for (const pixel of owned) {
        forEachNeighbour(pixel, (neighbor) => {
          if (world.land[neighbor] && world.owner[neighbor] === 0) candidates.add(neighbor);
        });
        world.seasOfPixel(pixel, seas);
      }
      this.addCoastSeeds(seas, candidates, 400);
    } else if (card.type === 'nomadExpand' && target) {
      this.addCountrySeeds(target, candidates);
      if (!card.nomadDensityOnly) {
        const range = target.range ?? [];
        const stride = Math.max(1, Math.ceil(range.length / 900));
        for (let index = 0; index < range.length; index += stride) {
          forEachNeighbour(range[index], (neighbor) => {
            if (world.land[neighbor] && !this.painter.strategyNomadRangeContains(neighbor)) {
              candidates.add(neighbor);
            }
          });
        }
      }
    } else if (card.type === 'split' && target) {
      this.addCountrySeeds(target, candidates);
    } else if (card.type === 'create' && target) {
      const owned = new Set<number>();
      this.addCountrySeeds(target, owned);
      const seas = new Set<number>();
      for (const pixel of owned) {
        forEachNeighbour(pixel, (neighbor) => {
          if (world.land[neighbor] && world.owner[neighbor] === 0) candidates.add(neighbor);
        });
        world.seasOfPixel(pixel, seas);
      }
      this.addCoastSeeds(seas, candidates, 400);
      this.globalSeeds(candidates, 48);
    } else if (target && target.type === 'settled') {
      this.addCountrySeeds(target, candidates);
    } else {
      this.globalSeeds(candidates);
    }

    if (card.hint >= 0) candidates.add(card.hint);
    const ordered = [...candidates].sort((a, b) => a - b);
    if (this.isLayerCard()) return ordered;
    if (ordered.length <= 192) return ordered;
    const stride = ordered.length / 192;
    const sampled = Array.from({ length: 192 }, (_, index) => ordered[Math.floor(index * stride)]);
    if (card.hint >= 0 && !sampled.includes(card.hint)) sampled.push(card.hint);
    return sampled.sort((a, b) => a - b);
  }

  private addCountrySeeds(country: Country, into: Set<number>, limit = 900): void {
    const { world } = this.painter;
    if (country.type === 'nomadic') {
      const range = country.range ?? [];
      const stride = Math.max(1, Math.ceil(range.length / limit));
      for (let index = 0; index < range.length; index += stride) into.add(range[index]);
      return;
    }
    const initialSize = into.size;
    const [x0, y0, x1, y1] = country.box;
    const area = Math.max(1, (x1 - x0 + 1) * (y1 - y0 + 1));
    const step = Math.max(1, Math.ceil(Math.sqrt(area / limit)));
    const tag = country.id + 1;
    for (let y = y0; y <= y1; y += step) {
      for (let x = x0; x <= x1; x += step) {
        const pixel = y * MAP_WIDTH + x;
        if (world.owner[pixel] === tag) into.add(pixel);
      }
    }
    if (into.size !== initialSize) return;
    if (area <= 65_536) {
      world.forEachCountryPixel(country, (pixel) => into.add(pixel));
      return;
    }
    const land = world.landIndex;
    const stride = Math.max(1, Math.ceil(land.length / limit));
    for (let index = 0; index < land.length; index += stride) {
      const pixel = land[index];
      if (world.owner[pixel] === tag) into.add(pixel);
    }
  }

  private addCoastSeeds(seas: Set<number>, into: Set<number>, budget: number): void {
    const { world } = this.painter;
    let remaining = budget;
    for (const sea of seas) {
      if (remaining <= 0) break;
      const coasts = world.water.coastsOf[sea];
      const stride = Math.max(1, Math.ceil(coasts.length / remaining));
      for (let index = 0; index < coasts.length && remaining > 0; index += stride, remaining -= 1) {
        if (world.owner[coasts[index]] === 0) into.add(coasts[index]);
      }
    }
  }

  private globalSeeds(into: Set<number>, limit = 240): void {
    const land = this.painter.world.landIndex;
    const stride = Math.max(1, Math.ceil(land.length / limit));
    for (let index = 0; index < land.length; index += stride) into.add(land[index]);
  }
}
