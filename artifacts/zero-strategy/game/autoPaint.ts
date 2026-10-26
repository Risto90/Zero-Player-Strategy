import type { CardPainter } from './brush';
import { MAP_HEIGHT, MAP_WIDTH } from './config';
import { forEachNeighbour } from './geography';
import type { Country } from './world';

export interface PaintActions {
  beginStroke(x: number, y: number): void;
  dab(x: number, y: number, radius: number): number;
  line(ax: number, ay: number, bx: number, by: number, radius: number): number;
  endStroke(): void;
}

const MAX_SCORE_CENTERS = 24;
const MAX_TERRITORY_DABS = 256;
const MAX_LAYER_FALLBACK_DABS = MAP_WIDTH * MAP_HEIGHT;
const LAYER_CARDS = new Set(['drought', 'rain', 'desertification', 'swamping',
  'warmCurrent', 'coldCurrent', 'warmWind', 'coldWind', 'faith', 'culture']);

function addCountrySeeds(
  world: CardPainter['world'],
  country: Country,
  into: Set<number>,
  limit = 900,
): void {
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
  if (into.size === initialSize) {
    if (area <= 65_536) {
      world.forEachCountryPixel(country, (pixel) => into.add(pixel));
    } else {
      const land = world.landIndex;
      const stride = Math.max(1, Math.ceil(land.length / limit));
      for (let index = 0; index < land.length; index += stride) {
        const pixel = land[index];
        if (world.owner[pixel] === tag) into.add(pixel);
      }
    }
  }
}

function globalSeeds(world: CardPainter['world'], into: Set<number>, limit = 240): void {
  const land = world.landIndex;
  const stride = Math.max(1, Math.ceil(land.length / limit));
  for (let index = 0; index < land.length; index += stride) into.add(land[index]);
}

function candidatePixels(painter: CardPainter): number[] {
  const { world, card } = painter;
  const candidates = new Set<number>();
  const target = card.type === 'create' && card.newCountryId !== null
    ? world.countries[card.newCountryId]
    : card.targetCountryId === null ? null : world.countries[card.targetCountryId];

  if (LAYER_CARDS.has(card.type)) {
    for (let pixel = 0; pixel < world.land.length; pixel += 1) {
      if (painter.strategyInkCostAt(pixel) > 0) candidates.add(pixel);
    }
  } else if ((card.type === 'create' && (!target || target.pixels === 0)) ||
    card.type === 'warmCurrent' || card.type === 'coldCurrent' ||
    (card.targetCountryId === null && ['drought', 'rain', 'faith', 'culture'].includes(card.type))) {
    globalSeeds(world, candidates);
    const activeCountries = world.countries.filter((country) => country.pixels > 0);
    const perCountryLimit = Math.max(8, Math.floor(900 / Math.max(1, activeCountries.length)));
    for (const country of activeCountries) {
      addCountrySeeds(world, country, candidates, perCountryLimit);
    }
  } else if (card.type === 'expand' && target) {
    if (card.developmentOnly) addCountrySeeds(world, target, candidates);
    const owned = new Set<number>();
    addCountrySeeds(world, target, owned);
    const seas = new Set<number>();
    for (const pixel of owned) {
      forEachNeighbour(pixel, (neighbor) => {
        if (world.land[neighbor] && world.owner[neighbor] === 0) candidates.add(neighbor);
      });
      world.seasOfPixel(pixel, seas);
    }
    let coastBudget = 400;
    for (const sea of seas) {
      if (coastBudget <= 0) break;
      const coasts = world.water.coastsOf[sea];
      const stride = Math.max(1, Math.ceil(coasts.length / coastBudget));
      for (let index = 0; index < coasts.length && coastBudget > 0; index += stride, coastBudget -= 1) {
        if (world.owner[coasts[index]] === 0) candidates.add(coasts[index]);
      }
    }
    globalSeeds(world, candidates, 80);
  } else if (card.type === 'colonization' && painter.colonizationMask) {
    const mask = painter.colonizationMask;
    const stride = Math.max(1, Math.ceil(mask.length / 900));
    for (let pixel = 0; pixel < mask.length; pixel += stride) {
      if (mask[pixel] === 1) candidates.add(pixel);
    }
  } else if (card.type === 'nomadExpand' && target) {
    addCountrySeeds(world, target, candidates);
    if (!card.nomadDensityOnly) {
      const range = target.range ?? [];
      const stride = Math.max(1, Math.ceil(range.length / 900));
      for (let index = 0; index < range.length; index += stride) {
        forEachNeighbour(range[index], (neighbor) => {
          if (world.land[neighbor] && !painter.strategyNomadRangeContains(neighbor)) candidates.add(neighbor);
        });
      }
    }
  } else if (card.type === 'split' && target) {
    addCountrySeeds(world, target, candidates);
  } else if (card.type === 'create' && target) {
    const owned = new Set<number>();
    addCountrySeeds(world, target, owned);
    const seas = new Set<number>();
    for (const pixel of owned) {
      forEachNeighbour(pixel, (neighbor) => {
        if (world.land[neighbor] && world.owner[neighbor] === 0) candidates.add(neighbor);
      });
      world.seasOfPixel(pixel, seas);
    }
    let coastBudget = 400;
    for (const sea of seas) {
      if (coastBudget <= 0) break;
      const coasts = world.water.coastsOf[sea];
      const stride = Math.max(1, Math.ceil(coasts.length / coastBudget));
      for (let index = 0; index < coasts.length && coastBudget > 0; index += stride, coastBudget -= 1) {
        if (world.owner[coasts[index]] === 0) candidates.add(coasts[index]);
      }
    }
    globalSeeds(world, candidates, 48);
  } else if (target && target.type === 'settled') {
    addCountrySeeds(world, target, candidates);
  } else {
    globalSeeds(world, candidates);
  }

  if (card.hint >= 0) candidates.add(card.hint);
  const ordered = [...candidates].sort((a, b) => a - b);
  if (LAYER_CARDS.has(card.type)) return ordered;
  if (ordered.length <= 192) return ordered;
  const stride = ordered.length / 192;
  const sampled = Array.from({ length: 192 }, (_, index) => ordered[Math.floor(index * stride)]);
  if (card.hint >= 0 && !sampled.includes(card.hint)) sampled.push(card.hint);
  return sampled.sort((a, b) => a - b);
}

function boundedCandidatePixels(painter: CardPainter): number[] {
  const pixels = candidatePixels(painter);
  if (pixels.length <= MAX_SCORE_CENTERS) return pixels;
  const stride = pixels.length / MAX_SCORE_CENTERS;
  const sampled = Array.from(
    { length: MAX_SCORE_CENTERS },
    (_, index) => pixels[Math.floor(index * stride)],
  );
  if (painter.card.hint >= 0 && !sampled.includes(painter.card.hint)) sampled.push(painter.card.hint);
  return sampled.sort((a, b) => a - b);
}

function scoreCenter(painter: CardPainter, pixel: number, radius: number): number {
  const { world } = painter;
  const cx = pixel % MAP_WIDTH;
  const cy = Math.floor(pixel / MAP_WIDTH);
  let score = 0;
  const x0 = Math.max(0, cx - radius), x1 = Math.min(MAP_WIDTH - 1, cx + radius);
  const y0 = Math.max(0, cy - radius), y1 = Math.min(MAP_HEIGHT - 1, cy + radius);
  const r2 = radius * radius;
  let ink = 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r2) continue;
      const pixel = y * MAP_WIDTH + x;
      const impact = painter.strategyImpactAt(pixel);
       ink += painter.strategyInkCostAt(pixel, impact);
      score += impact;
      // A new country starts with exactly one seed pixel; later dabs grow it
      // through the normal territory rules.
      if (painter.card.type === 'create' &&
        painter.world.countries[painter.card.newCountryId ?? -1]?.pixels === 0 && impact > 0) {
        return ink > 0 ? score / ink : 0;
      }
    }
  }
  return ink > 0 ? score / ink : 0;
}

/**
 * Selects non-overlapping areas by expected immediate effect per actual ink cost.
 * The painter supplies the card-specific eligibility, impact and cost estimate;
 * all mutations still go through the caller's shared action dispatcher.
 */
export function autoPaint(
  painter: CardPainter,
  actions: PaintActions,
  onMeasure?: (stage: string, durationMs: number) => void,
): void {
  const card = painter.card;
  if (card.hint < 0 && card.type !== 'create') return;
  const territorial = card.type === 'create' || card.type === 'expand' ||
    card.type === 'colonization' || card.type === 'split' || card.type === 'nomadExpand';
  const radius = territorial ? 10 : 16;
  const isWind = card.type === 'warmWind' || card.type === 'coldWind';
  if (territorial) {
    let scoringDurationMs = 0;
    let paintingDurationMs = 0;
    if (card.type === 'split' && card.newCountryId !== null &&
      painter.world.countries[card.newCountryId]?.pixels === 0 &&
      painter.strategyImpactAt(card.hint) > 0) {
      // Split cards carry the largest eligible city as their hint; it is the
      // required connected seed, so preserve that card-specific constraint.
      const startedAt = onMeasure ? performance.now() : 0;
      actions.dab(
        (card.hint % MAP_WIDTH) + 0.5,
        Math.floor(card.hint / MAP_WIDTH) + 0.5,
        radius,
      );
      if (onMeasure) paintingDurationMs += performance.now() - startedAt;
    }
    if (card.type === 'colonization' && card.hint >= 0 &&
      painter.strategyImpactAt(card.hint) > 0) {
      // The plan hint is guaranteed to be an anchor or border-connected
      // target. Paint it first so even a reduced fractional quota has a
      // reachable target before the general strategy re-scores the frontier.
      const startedAt = onMeasure ? performance.now() : 0;
      actions.dab(
        (card.hint % MAP_WIDTH) + 0.5,
        Math.floor(card.hint / MAP_WIDTH) + 0.5,
        radius,
      );
      if (onMeasure) paintingDurationMs += performance.now() - startedAt;
    }
    // Territory eligibility changes as the frontier grows, so re-score a small
    // bounded candidate set after each successful dab.
    for (let step = 0; step < MAX_TERRITORY_DABS && card.ink > 0; step += 1) {
      const scoringStartedAt = onMeasure ? performance.now() : 0;
      const candidates = boundedCandidatePixels(painter)
        .map((pixel) => ({ pixel, score: scoreCenter(painter, pixel, radius) }))
        .filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score || a.pixel - b.pixel)
        .slice(0, MAX_SCORE_CENTERS);
      if (onMeasure) scoringDurationMs += performance.now() - scoringStartedAt;
      if (!candidates.length) break;
      let spent = 0;
      for (const candidate of candidates.slice(0, 8)) {
        const paintingStartedAt = onMeasure ? performance.now() : 0;
        spent = actions.dab(
          (candidate.pixel % MAP_WIDTH) + 0.5,
          Math.floor(candidate.pixel / MAP_WIDTH) + 0.5,
          radius,
        );
        if (onMeasure) paintingDurationMs += performance.now() - paintingStartedAt;
        if (spent > 0) break;
      }
      if (spent <= 0) break;
    }
    onMeasure?.('подбор центров кисти', scoringDurationMs);
    onMeasure?.('обработка мазков кисти', paintingDurationMs);
  } else {
    const candidates = boundedCandidatePixels(painter)
      .map((pixel) => ({ pixel, score: scoreCenter(painter, pixel, radius) }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score || a.pixel - b.pixel);

    const selected: number[] = [];
    const spacing = radius * 1.6;
    const spacingSquared = spacing * spacing;
    for (const candidate of candidates) {
      if (selected.length >= MAX_SCORE_CENTERS) break;
      const x = candidate.pixel % MAP_WIDTH, y = Math.floor(candidate.pixel / MAP_WIDTH);
      if (selected.some((pixel) =>
        (pixel % MAP_WIDTH - x) ** 2 + (Math.floor(pixel / MAP_WIDTH) - y) ** 2 < spacingSquared,
      )) continue;
      selected.push(candidate.pixel);
    }

    const windStart = isWind && card.hint >= 0 ? card.hint : -1;
    if (windStart >= 0) {
      const x = (windStart % MAP_WIDTH) + 0.5;
      const y = Math.floor(windStart / MAP_WIDTH) + 0.5;
      actions.beginStroke(x, y);
    }
    for (const pixel of selected) {
      if (card.ink <= 0) break;
      if (isWind && pixel === windStart) continue;
      actions.dab((pixel % MAP_WIDTH) + 0.5, Math.floor(pixel / MAP_WIDTH) + 0.5, radius);
    }
    if (LAYER_CARDS.has(card.type) && card.ink > 0) {
      // Benefit scoring is only a preference. The issued quota is based on
      // legal targets, so spend the remainder there even when the direct
      // climate benefit is neutral or negative.
      const legalTargets: number[] = [];
      for (let pixel = 0; pixel < painter.world.land.length; pixel += 1) {
        if (painter.strategyInkCostAt(pixel) <= 0) continue;
        legalTargets.push(pixel);
      }
      if (isWind && windStart < 0 && legalTargets.length) {
        const start = legalTargets.find((pixel) =>
          painter.world.owner[pixel] === (card.targetCountryId ?? -2) + 1,
        );
        if (start !== undefined) {
          actions.beginStroke((start % MAP_WIDTH) + 0.5, Math.floor(start / MAP_WIDTH) + 0.5);
        }
      }
      let fallbackDabs = 0;
      for (const pixel of legalTargets) {
        if (card.ink <= 0 || fallbackDabs >= MAX_LAYER_FALLBACK_DABS) break;
        if (painter.strategyInkCostAt(pixel) <= 0) continue;
        actions.dab((pixel % MAP_WIDTH) + 0.5, Math.floor(pixel / MAP_WIDTH) + 0.5, 5);
        fallbackDabs += 1;
      }
    }
    if (isWind && windStart >= 0) {
      const x = (windStart % MAP_WIDTH) + 0.5;
      const y = Math.floor(windStart / MAP_WIDTH) + 0.5;
      actions.line(x, y, x, y, radius);
    }
  }
  actions.endStroke();
}
