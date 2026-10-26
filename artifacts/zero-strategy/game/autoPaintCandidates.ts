import type { CardPainter } from './brush';
import { MAP_HEIGHT, MAP_WIDTH } from './config';
import { forEachNeighbour } from './geography';
import type { Country } from './world';

export const MAX_SCORE_CENTERS = 24;
export const MAX_TERRITORY_DABS = 256;
export const MAX_LAYER_FALLBACK_DABS = MAP_WIDTH * MAP_HEIGHT;

/** Подбирает ограниченный набор точек-кандидатов для автоматической кисти. */
export class AutoPaintCandidateSelector {
  private static readonly LAYER_CARDS = new Set([
    'drought', 'rain', 'desertification', 'swamping',
    'warmCurrent', 'coldCurrent', 'warmWind', 'coldWind', 'faith', 'culture',
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
    const pixels = this.candidates();
    if (pixels.length <= MAX_SCORE_CENTERS) return pixels;
    const stride = pixels.length / MAX_SCORE_CENTERS;
    const sampled = Array.from(
      { length: MAX_SCORE_CENTERS },
      (_, index) => pixels[Math.floor(index * stride)],
    );
    if (this.painter.card.hint >= 0 && !sampled.includes(this.painter.card.hint)) {
      sampled.push(this.painter.card.hint);
    }
    return sampled.sort((a, b) => a - b);
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
      this.globalSeeds(candidates, 80);
    } else if (card.type === 'colonization' && this.painter.colonizationMask) {
      const mask = this.painter.colonizationMask;
      const stride = Math.max(1, Math.ceil(mask.length / 900));
      for (let pixel = 0; pixel < mask.length; pixel += stride) {
        if (mask[pixel] === 1) candidates.add(pixel);
      }
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
