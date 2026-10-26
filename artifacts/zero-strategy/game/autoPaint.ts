import type { CardPainter } from './brush';
import { MAP_HEIGHT, MAP_WIDTH } from './config';
import { forEachNeighbour } from './geography';
import { ContourArea } from './contours';
import {
  AutoPaintCandidateSelector,
  MAX_LAYER_FALLBACK_DABS,
  MAX_SCORE_CENTERS,
  MAX_TERRITORY_DABS,
} from './autoPaintCandidates';

export interface PaintActions {
  beginStroke(x: number, y: number): void;
  dab(x: number, y: number, radius: number): number;
  line(ax: number, ay: number, bx: number, by: number, radius: number): number;
  endStroke(): void;
  contour?(area: ContourArea, seed?: number): number;
}

/** ИИ выбирает связные пересечения климатических контуров, а не перебирает круговые мазки. */
class ContourTerritoryStrategy {
  constructor(
    private readonly painter: CardPainter,
    private readonly actions: PaintActions,
    private readonly onMeasure?: (stage: string, durationMs: number) => void,
  ) {}

  run(): void {
    const { world, card } = this.painter;
    const started = this.onMeasure ? performance.now() : 0;
    const bounds = { x0: 0, y0: 0, x1: MAP_WIDTH - 1, y1: MAP_HEIGHT - 1 };
    const { paint, start } = this.painter.strategyStrokeContours(bounds);
    const regions = world.contours.climateIntersections(paint);
    const regionIds = new Map<string, number>();
    regions.forEach((region, id) => {
      regionIds.set(`${region.humidity}:${region.temperature}:${region.drainage}`, id);
    });
    const country = card.type === 'create'
      ? world.countries[card.newCountryId ?? -1] : world.countries[card.targetCountryId ?? -1];
    const candidates = new Map<number, { pixel: number; fit: number; efficiency: number }>();
    const consideredSeas = new Set(this.painter.strategySeaBodies());
    let choosingFirst = country?.pixels === 0;
    const consider = (pixel: number, knownId?: number) => {
      if (world.owner[pixel] !== 0 || !world.land[pixel] || !paint.contains(pixel)) return;
      const id = knownId ?? regionIds.get(
        `${world.humidity[pixel]}:${world.temperature[pixel]}:${world.drainage[pixel]}`,
      );
      if (id === undefined) return;
      const previous = candidates.get(id);
      if (previous && world.owner[previous.pixel] === 0) return;
      const region = regions[id];
      const impact = this.painter.strategyImpactAt(pixel);
      const cost = this.painter.strategyInkCostAt(pixel, impact);
      if (!(cost > 0)) return;
      candidates.set(id, { pixel, fit: this.painter.strategyClimateFit(region.temperature, region.humidity),
        efficiency: impact / cost });
    };
    if (choosingFirst) {
      regions.forEach((region, id) => {
        const first = region.area.intersect(start).spans[0];
        if (first) consider(first.y * MAP_WIDTH + first.start, id);
      });
    } else start.forEachPixel((pixel) => consider(pixel));
    this.onMeasure?.('подготовка контурного плана', performance.now() - started);
    let paintingMs = 0, frontierMs = 0;
    while (card.ink > 0 && candidates.size > 0) {
      let bestId = -1, bestPixel = -1, bestFit = -Infinity, bestEfficiency = -Infinity;
      for (const [id, { pixel, fit, efficiency }] of candidates) {
        if (world.owner[pixel] !== 0) continue;
        if (fit > bestFit || (fit === bestFit && (efficiency > bestEfficiency ||
          (efficiency === bestEfficiency && pixel < bestPixel)))) {
          bestId = id; bestPixel = pixel; bestFit = fit; bestEfficiency = efficiency;
        }
      }
      if (bestId < 0) break;
      candidates.delete(bestId);
      const area = regions[bestId].area;
      const changedStart = this.painter.changed.length;
      const paintStarted = this.onMeasure ? performance.now() : 0;
      const spent = this.actions.contour!(area, bestPixel);
      if (this.onMeasure) paintingMs += performance.now() - paintStarted;
      if (!(spent > 0)) continue;
      const frontierStarted = this.onMeasure ? performance.now() : 0;
      if (choosingFirst) {
        choosingFirst = false;
        candidates.clear();
      }
      // Меняется только граница закрашенного контура; весь доступный мир повторно не вычисляется.
      for (let index = changedStart; index < this.painter.changed.length; index += 1) {
        forEachNeighbour(this.painter.changed[index], (pixel) => consider(pixel));
      }
      for (const sea of this.painter.strategySeaBodies()) {
        if (consideredSeas.has(sea)) continue;
        consideredSeas.add(sea);
        for (const pixel of world.water.coastsOf[sea]) consider(pixel);
      }
      if (this.onMeasure) frontierMs += performance.now() - frontierStarted;
    }
    this.onMeasure?.('заливка климатических контуров', paintingMs);
    this.onMeasure?.('обновление границы контурного плана', frontierMs);
    this.actions.endStroke();
  }
}

/** Оценивает отдачу от одного центра кисти на единицу фактической стоимости. */
class AutoPaintCenterScorer {
  constructor(private readonly painter: CardPainter) {}

  score(pixel: number, radius: number): number {
    const { world, card } = this.painter;
    const cx = pixel % MAP_WIDTH;
    const cy = Math.floor(pixel / MAP_WIDTH);
    let score = 0;
    const offsets = AutoPaintCandidateSelector.scoreOffsets(radius);
    let ink = 0;
    for (let offset = 0; offset < offsets.length; offset += 2) {
      const x = cx + offsets[offset];
      const y = cy + offsets[offset + 1];
      if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) continue;
      const scorePixel = y * MAP_WIDTH + x;
      const impact = this.painter.strategyImpactAt(scorePixel);
      ink += this.painter.strategyInkCostAt(scorePixel, impact);
      score += impact;
      // Новая страна начинает с одной исходной точки; далее действует обычное расширение.
      if (card.type === 'create' && world.countries[card.newCountryId ?? -1]?.pixels === 0 && impact > 0) {
        return ink > 0 ? score / ink : 0;
      }
    }
    return ink > 0 ? score / ink : 0;
  }
}

/** Координирует автоматический выбор центров и нанесение мазков карты. */
class AutoPaintStrategy {
  private readonly candidates: AutoPaintCandidateSelector;
  private readonly scorer: AutoPaintCenterScorer;

  constructor(
    private readonly painter: CardPainter,
    private readonly actions: PaintActions,
    private readonly onMeasure?: (stage: string, durationMs: number) => void,
  ) {
    this.candidates = new AutoPaintCandidateSelector(painter);
    this.scorer = new AutoPaintCenterScorer(painter);
  }

  run(): void {
    const card = this.painter.card;
    if (card.hint < 0 && card.type !== 'create') return;
    const territorial = card.type === 'create' || card.type === 'expand' ||
      card.type === 'colonization' || card.type === 'split' || card.type === 'nomadExpand';
    const radius = territorial ? 10 : 16;
    const isWind = card.type === 'warmWind' || card.type === 'coldWind';
    if (this.actions.contour && (card.type === 'create' || card.type === 'expand') &&
      this.painter.mode === 'respect' && !card.developmentOnly) {
      new ContourTerritoryStrategy(this.painter, this.actions, this.onMeasure).run();
      return;
    }
    if (territorial) this.paintTerritory(radius);
    else this.paintOtherCards(radius, isWind);
    this.actions.endStroke();
  }

  private paintTerritory(radius: number): void {
    const { painter, actions, onMeasure } = this;
    const { card, world } = painter;
    let scoringDurationMs = 0;
    let paintingDurationMs = 0;
    if (card.type === 'split' && card.newCountryId !== null &&
      world.countries[card.newCountryId]?.pixels === 0 && painter.strategyImpactAt(card.hint) > 0) {
      const startedAt = onMeasure ? performance.now() : 0;
      actions.dab((card.hint % MAP_WIDTH) + 0.5, Math.floor(card.hint / MAP_WIDTH) + 0.5, radius);
      if (onMeasure) paintingDurationMs += performance.now() - startedAt;
    }
    if (card.type === 'colonization' && card.hint >= 0 && painter.strategyImpactAt(card.hint) > 0) {
      const startedAt = onMeasure ? performance.now() : 0;
      actions.dab((card.hint % MAP_WIDTH) + 0.5, Math.floor(card.hint / MAP_WIDTH) + 0.5, radius);
      if (onMeasure) paintingDurationMs += performance.now() - startedAt;
    }
    for (let step = 0; step < MAX_TERRITORY_DABS && card.ink > 0; step += 1) {
      const scoringStartedAt = onMeasure ? performance.now() : 0;
      const scored = this.rankCandidates(radius).slice(0, MAX_SCORE_CENTERS);
      if (onMeasure) scoringDurationMs += performance.now() - scoringStartedAt;
      if (!scored.length) break;
      let spent = 0;
      for (const candidate of scored.slice(0, 8)) {
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
  }

  private paintOtherCards(radius: number, isWind: boolean): void {
    const { painter, actions } = this;
    const { card, world } = painter;
    const candidates = this.rankCandidates(radius);
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
      actions.beginStroke((windStart % MAP_WIDTH) + 0.5, Math.floor(windStart / MAP_WIDTH) + 0.5);
    }
    for (const pixel of selected) {
      if (card.ink <= 0) break;
      if (isWind && pixel === windStart) continue;
      actions.dab((pixel % MAP_WIDTH) + 0.5, Math.floor(pixel / MAP_WIDTH) + 0.5, radius);
    }
    if (this.candidates.isLayerCard() && card.ink > 0) {
      this.paintRemainingLayerTargets(isWind, windStart);
    }
    if (isWind && windStart >= 0) {
      const x = (windStart % MAP_WIDTH) + 0.5;
      const y = Math.floor(windStart / MAP_WIDTH) + 0.5;
      actions.line(x, y, x, y, radius);
    }
  }

  private paintRemainingLayerTargets(isWind: boolean, windStart: number): void {
    const { painter, actions } = this;
    const { card, world } = painter;
    const legalTargets: number[] = [];
    for (let pixel = 0; pixel < world.land.length; pixel += 1) {
      if (painter.strategyInkCostAt(pixel) > 0) legalTargets.push(pixel);
    }
    if (isWind && windStart < 0 && legalTargets.length) {
      const start = legalTargets.find((pixel) => world.owner[pixel] === (card.targetCountryId ?? -2) + 1);
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

  private rankCandidates(radius: number): { pixel: number; score: number }[] {
    return this.candidates.bounded()
      .map((pixel) => ({ pixel, score: this.scorer.score(pixel, radius) }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score || a.pixel - b.pixel);
  }
}

/** Совместимая точка входа для автоматического выполнения карты. */
export function autoPaint(
  painter: CardPainter,
  actions: PaintActions,
  onMeasure?: (stage: string, durationMs: number) => void,
): void {
  new AutoPaintStrategy(painter, actions, onMeasure).run();
}
