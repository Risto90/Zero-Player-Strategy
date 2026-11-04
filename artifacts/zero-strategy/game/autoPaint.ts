import { climateBrushNeedsLandEndpoints, type CardPainter } from './brush';
import { MAP_HEIGHT, MAP_WIDTH } from './config';
import { forEachNeighbour } from './geography';
import { ContourArea, type ClimateContour } from './contours';
import {
  AutoPaintCandidateSelector,
  MAX_LAYER_FALLBACK_DABS,
  MAX_SCORE_CENTERS,
  MAX_TERRITORY_DABS,
  selectCompetitiveContour,
} from './autoPaintCandidates';

interface TerritorySample {
  humidity: number;
  temperature: number;
  drainage: number;
  pixel: number;
  weight: number;
}

interface TerritoryCandidate {
  key: string;
  pixel: number;
  score: number;
  efficiency: number;
  averageCost: number;
  safe: boolean;
  enemyDistance: number;
  foreignTarget: boolean;
  capturesCity: boolean;
  accessible: ContourArea;
  area: ContourArea;
  competitionLimited?: boolean;
}

interface CompetitiveSelection {
  candidate: TerritoryCandidate;
  sampleSize: number;
}

interface TerritoryPlanAssessment {
  plan: { paint: ContourArea; start: ContourArea };
  candidates: TerritoryCandidate[];
  score: number;
}

export interface PaintActions {
  beginStroke(x: number, y: number): void;
  dab(x: number, y: number, radius: number): number;
  line(ax: number, ay: number, bx: number, by: number, radius: number): number;
  endStroke(): void;
  contour?(area: ContourArea, seed?: number): number;
  contours?(
    areas: readonly ContourArea[],
    seeds?: readonly (number | undefined)[],
  ): number;
}

/**
 * ИИ выбирает связные пересечения климатических контуров, а не перебирает круговые мазки.
 * Контуры отвечают за поиск подходящей области; фактическую заливку выполняет тот же CardPainter,
 * что и ручной ввод. Не подменять выбор или заливку отдельной пиксельной кистью.
 */
class ContourTerritoryStrategy {
  private readonly paintAreaClimateCache = new WeakMap<ContourArea, Map<string, ContourArea>>();

  constructor(
    private readonly painter: CardPainter,
    private readonly actions: PaintActions,
    private readonly onMeasure?: (stage: string, durationMs: number) => void,
  ) {}

  private representativePixels(area: ContourArea): number[] {
    const spans = area.spans;
    if (!spans.length) return [];
    const selected = spans.length <= 3
      ? spans
      : [spans[0], spans[Math.floor((spans.length - 1) / 2)], spans[spans.length - 1]];
    const pixels: number[] = [];
    for (const span of selected) {
      const row = span.y * MAP_WIDTH;
      pixels.push(row + span.start, row + Math.floor((span.start + span.end - 1) / 2), row + span.end - 1);
    }
    return [...new Set(pixels)];
  }

  /** Берёт представителей климатических множеств; дистанцию учитывает формула конкуренции. */
  private regionSamples(initialRegions: readonly ClimateContour[]): TerritorySample[] {
    const samples: TerritorySample[] = [];
    for (const region of initialRegions) {
      const pixels = this.representativePixels(region.area);
      if (!pixels.length) continue;
      const weight = region.area.size / pixels.length;
      for (const pixel of pixels) samples.push({
        humidity: region.humidity,
        temperature: region.temperature,
        drainage: region.drainage,
        pixel,
        weight,
      });
    }
    return samples;
  }

  run(): void {
    const { world, card } = this.painter;
    if (!this.actions.contour) {
      throw new Error('Для территориальной кисти ИИ требуется общий инструмент контурной заливки.');
    }
    const bounds = { x0: 0, y0: 0, x1: MAP_WIDTH - 1, y1: MAP_HEIGHT - 1 };
    const planningStarted = this.onMeasure ? performance.now() : 0;
    let mode = this.painter.mode;
    let preparedPlan: TerritoryPlanAssessment['plan'] | null = null;
    let preparedCandidates: TerritoryCandidate[] | null = null;
    if (card.type === 'create' || card.type === 'split') mode = 'respect';
    else if (card.type === 'expand') {
      if (card.developmentOnly) mode = 'repeat';
      else {
        const expansion = this.assessPlan('respect', bounds);
        const repeat = this.assessPlan('repeat', bounds);
        const selected = repeat.score > expansion.score ? repeat : expansion;
        mode = selected === repeat ? 'repeat' : 'respect';
        preparedPlan = selected.plan;
        preparedCandidates = selected.candidates;
      }
    }
    this.painter.setStrategyMode(mode);
    const plan = preparedPlan ?? this.makePlan(bounds, mode);
    let paintArea = plan.paint;
    let available = plan.start;
    if (card.type === 'expand' && mode === 'repeat') available = paintArea;
    let paintedTerritoryArea = new ContourArea();
    let createdCountryArea = card.type === 'create'
      ? ContourArea.pixels(this.painter.changed)
      : new ContourArea();
    this.onMeasure?.('подготовка контурного плана', performance.now() - planningStarted);

    const createCandidatesByKey = card.type === 'create'
      ? new Map<string, TerritoryCandidate>()
      : null;
    const createMetricsByKey = card.type === 'create'
      ? new Map<string, { efficiency: number; averageCost: number }>()
      : null;
    if (createCandidatesByKey && createMetricsByKey) {
      const scoringStarted = this.onMeasure ? performance.now() : 0;
      const regions = world.contours.climateIntersections(available);
      for (const candidate of this.scoreCandidates(available, paintArea, regions)) {
        createCandidatesByKey.set(candidate.key, candidate);
        createMetricsByKey.set(candidate.key, {
          efficiency: candidate.efficiency,
          averageCost: candidate.averageCost,
        });
      }
      if (this.onMeasure) {
        this.onMeasure('оценка доступных контуров', performance.now() - scoringStarted);
      }
    }

    let paintingMs = 0;
    let frontierMs = 0;
    let competitiveSampleSize = 2;
    let dabs = 0;
    let usePreparedCandidates = preparedCandidates !== null;
    while (dabs < MAX_TERRITORY_DABS && card.ink > 0 && available.size > 0) {
      const scoringStarted = this.onMeasure ? performance.now() : 0;
      const countryWasEmpty = card.type === 'create' &&
        world.countries[card.newCountryId ?? -1]?.pixels === 0;
      let eligibleCandidates: TerritoryCandidate[];
      if (createCandidatesByKey) {
        eligibleCandidates = this.topCreateCandidates(
          createCandidatesByKey.values(),
          card.ink,
          1,
        );
      } else {
        const candidates = usePreparedCandidates
          ? preparedCandidates ?? []
          : this.scoreCandidates(available, paintArea);
        eligibleCandidates = candidates
          .filter((candidate) => card.type !== 'expand' || mode === 'repeat' || candidate.safe)
          .sort((a, b) => this.compareCandidates(a, b));
      }
      usePreparedCandidates = false;
      if (this.onMeasure) this.onMeasure('оценка доступных контуров', performance.now() - scoringStarted);
      let candidate: TerritoryCandidate | undefined = eligibleCandidates[0];
      let competition: CompetitiveSelection | null = null;
      if (card.type === 'expand' || card.type === 'colonization') {
        competition = this.selectCompetitiveCandidate(eligibleCandidates, competitiveSampleSize);
        candidate = competition?.candidate;
      }
      if (!candidate) break;

      const changedStart = this.painter.changed.length;
      const previousSeas = card.type === 'expand' || card.type === 'create'
        ? new Set(this.painter.strategySeaBodies())
        : null;
      const previousCityOwners = card.type === 'colonization'
        ? new Map(world.cities.map((city) => [city.id, city.countryId]))
        : null;
      const paintStarted = this.onMeasure ? performance.now() : 0;
      const spent = this.actions.contour!(candidate.area, candidate.pixel);
      if (this.onMeasure) paintingMs += performance.now() - paintStarted;
      dabs += 1;
      available = available.subtract(candidate.accessible);
      createCandidatesByKey?.delete(candidate.key);
      const stepChanged = spent > 0
        ? this.painter.changed.slice(changedStart)
        : [];
      if ((card.type === 'expand' || card.type === 'colonization') &&
        competition?.candidate.competitionLimited && spent > 0 && card.ink > 0) {
        competitiveSampleSize = Math.min(
          Math.max(2, competition.sampleSize + 1),
          eligibleCandidates.length,
        );
      }
      const stepOpenedSeas = previousSeas === null
        ? []
        : [...this.painter.strategySeaBodies()].filter((sea) => !previousSeas.has(sea));
      if (card.type === 'create' && stepChanged.length > 0) {
        createdCountryArea = createdCountryArea.union(ContourArea.pixels(stepChanged));
      }
      if (card.type !== 'create') {
        if (!(spent > 0)) continue;
        if (!stepChanged.length) break;
      } else {
        if (!(spent > 0) || !stepChanged.length) continue;
      }
      const changed = stepChanged;
      if (!changed.length) break;
      const frontierStarted = this.onMeasure ? performance.now() : 0;
      const capturedCity = card.type === 'colonization' && world.cities.some((city) =>
        previousCityOwners?.get(city.id) !== undefined &&
        previousCityOwners.get(city.id) !== card.targetCountryId &&
        city.countryId === card.targetCountryId,
      );
      const openedSeas = stepOpenedSeas;
      const openedCoast = openedSeas.length > 0 &&
        (card.type === 'expand' || card.type === 'create');
      const fullRefresh = capturedCity;
      const refreshCountryWasEmpty = countryWasEmpty;
      let newFrontier = new ContourArea();
      if (card.type === 'create' || (card.type === 'expand' && mode === 'respect')) {
        const changedArea = ContourArea.pixels(changed);
        if (card.type === 'expand') paintedTerritoryArea = paintedTerritoryArea.union(changedArea);
        newFrontier = changedArea.neighbourhood8()
          .intersect(paintArea)
          .subtract(card.type === 'create' ? createdCountryArea : paintedTerritoryArea);
      } else if (card.type !== 'expand' || mode !== 'repeat') {
        const changedBounds = this.changedBounds(changed);
        const refreshBounds = fullRefresh
          ? bounds
          : {
            x0: Math.max(0, changedBounds.x0 - 2),
            y0: Math.max(0, changedBounds.y0 - 2),
            x1: Math.min(MAP_WIDTH - 1, changedBounds.x1 + 2),
            y1: Math.min(MAP_HEIGHT - 1, changedBounds.y1 + 2),
          };
        const refreshed = this.makePlan(refreshBounds, mode);
        newFrontier = refreshed.start;
        if (fullRefresh) paintArea = refreshed.paint;
      }
      if (refreshCountryWasEmpty) {
        available = newFrontier;
        createCandidatesByKey?.clear();
      } else {
        available = available.union(newFrontier);
      }
      if (card.type === 'create' && openedCoast) {
        const newCoast = openedSeas.reduce(
          (area, sea) => area.union(this.painter.strategyCoastArea(sea)),
          new ContourArea(),
        ).intersect(paintArea).subtract(createdCountryArea);
        available = available.union(newCoast);
        newFrontier = newFrontier.union(newCoast);
      } else if (card.type === 'expand' && openedCoast) {
        const newCoast = openedSeas.reduce(
          (area, sea) => area.union(this.painter.strategyCoastArea(sea)),
          new ContourArea(),
        ).intersect(paintArea).subtract(paintedTerritoryArea);
        available = available.union(newCoast);
        newFrontier = newFrontier.union(newCoast);
      }
      let incrementalScoringMs = 0;
      if (createCandidatesByKey && createMetricsByKey && newFrontier.size > 0) {
        const incrementalScoringStarted = this.onMeasure ? performance.now() : 0;
        const changedRegions = world.contours.climateIntersections(newFrontier);
        for (const region of changedRegions) {
          const key = `${region.humidity}:${region.temperature}:${region.drainage}`;
          const existing = createCandidatesByKey.get(key);
          if (existing) {
            const accessible = existing.accessible.union(region.area);
            const metrics = createMetricsByKey.get(key) ?? existing;
            createCandidatesByKey.set(key, {
              ...existing,
              accessible,
              score: metrics.efficiency * Math.min(
                accessible.size,
                card.ink / metrics.averageCost,
              ),
            });
            continue;
          }
          const [sampled] = this.scoreCandidates(region.area, paintArea, [region]);
          if (!sampled) continue;
          let metrics = createMetricsByKey.get(key);
          if (!metrics) {
            metrics = {
              efficiency: sampled.efficiency,
              averageCost: sampled.averageCost,
            };
            createMetricsByKey.set(key, metrics);
          }
          createCandidatesByKey.set(key, {
            ...sampled,
            efficiency: metrics.efficiency,
            averageCost: metrics.averageCost,
            score: metrics.efficiency * Math.min(
              region.area.size,
              card.ink / metrics.averageCost,
            ),
          });
        }
        if (this.onMeasure) {
          incrementalScoringMs = performance.now() - incrementalScoringStarted;
          this.onMeasure('оценка новых контуров', incrementalScoringMs);
        }
      }
      if (this.onMeasure) {
        frontierMs += Math.max(0, performance.now() - frontierStarted - incrementalScoringMs);
      }
    }
    this.onMeasure?.('заливка климатических контуров', paintingMs);
    this.onMeasure?.('локальное обновление границы', frontierMs);
    const endStrokeStarted = this.onMeasure ? performance.now() : 0;
    this.actions.endStroke();
    if (this.onMeasure) {
      this.onMeasure('завершение общего мазка', performance.now() - endStrokeStarted);
    }
  }

  private makePlan(
    bounds: { x0: number; y0: number; x1: number; y1: number },
    mode: string,
  ): { paint: ContourArea; start: ContourArea } {
    if (this.painter.card.type === 'expand' && mode === 'repeat') {
      const area = this.painter.strategyRepeatGrowthArea(bounds);
      return { paint: area, start: area };
    }
    const { paint, start } = this.painter.strategyStrokeContours(bounds, this.onMeasure);
    return { paint, start };
  }

  private topCreateCandidates(
    candidates: Iterable<TerritoryCandidate>,
    ink: number,
    limit: number,
  ): TerritoryCandidate[] {
    const top: Array<{ candidate: TerritoryCandidate; score: number }> = [];
    for (const candidate of candidates) {
      const score = candidate.efficiency * Math.min(
        candidate.accessible.size,
        ink / candidate.averageCost,
      );
      let index = 0;
      while (index < top.length) {
        const current = top[index];
        const order = current.score === score
          ? candidate.efficiency - current.candidate.efficiency
          : score - current.score;
        if (order > 0 || (order === 0 && candidate.pixel < current.candidate.pixel)) break;
        index += 1;
      }
      if (index >= limit) continue;
      top.splice(index, 0, { candidate, score });
      if (top.length > limit) top.pop();
    }
    return top.map(({ candidate, score }) => ({ ...candidate, score }));
  }

  private assessPlan(
    mode: 'respect' | 'repeat',
    bounds: { x0: number; y0: number; x1: number; y1: number },
  ): TerritoryPlanAssessment {
    this.painter.setStrategyMode(mode);
    const plan = this.makePlan(bounds, mode);
    const candidates = this.scoreCandidates(plan.start, plan.paint);
    const eligible = mode === 'respect' ? candidates.filter((candidate) => candidate.safe) : candidates;
    const ranked = eligible.sort((a, b) => this.compareCandidates(a, b));
    return {
      plan,
      candidates: ranked,
      score: this.selectCompetitiveCandidate(ranked)?.candidate.score ?? 0,
    };
  }

  private scoreCandidates(
    available: ContourArea,
    paintArea: ContourArea,
    knownRegions?: readonly ClimateContour[],
  ): TerritoryCandidate[] {
    const { world, card } = this.painter;
    const started = this.onMeasure ? performance.now() : 0;
    const regions = knownRegions ?? world.contours.climateIntersections(available);
    const byKey = new Map(regions.map((region) => [
      `${region.humidity}:${region.temperature}:${region.drainage}`,
      region,
    ]));
    let paintAreaByKey = this.paintAreaClimateCache.get(paintArea);
    if (!paintAreaByKey) {
      const paintRegions = available === paintArea
        ? regions
        : world.contours.climateIntersections(paintArea);
      paintAreaByKey = new Map(paintRegions.map((region) => [
        `${region.humidity}:${region.temperature}:${region.drainage}`,
        region.area,
      ]));
      this.paintAreaClimateCache.set(paintArea, paintAreaByKey);
    }
    const stats = new Map<string, {
      h: number;
      t: number;
      d: number;
      value: number;
      cost: number;
      weight: number;
      pixel: number;
      bestEfficiency: number;
      safe: boolean;
      enemyDistance: number;
      foreignTarget: boolean;
    }>();
    const sampleBuildStarted = this.onMeasure ? performance.now() : 0;
    const samples = this.regionSamples(regions);
    if (this.onMeasure) {
      this.onMeasure('построение климатических выборок', performance.now() - sampleBuildStarted);
    }
    const sampleScoringStarted = this.onMeasure ? performance.now() : 0;
    for (const sample of samples) {
      const key = `${sample.humidity}:${sample.temperature}:${sample.drainage}`;
      if (!byKey.has(key)) continue;
      const impact = this.painter.strategyImpactAt(sample.pixel);
      if (!(impact > 0)) continue;
      const cost = this.painter.strategyInkCostAt(sample.pixel, impact);
      if (!(cost > 0)) continue;
      const climateScored = card.type === 'create' || card.type === 'expand' ||
        card.type === 'colonization' || card.type === 'nomadExpand';
      const fit = climateScored
        ? this.painter.strategyClimateFit(
          sample.temperature, sample.humidity, sample.drainage,
        ) / 100
        : 1;
      const adjustedImpact = impact * fit;
      const baseEfficiency = this.painter.strategyBaseEfficiencyAt(
        sample.pixel, adjustedImpact, cost,
      );
      if (!(baseEfficiency > 0)) continue;
      const countryId = this.painter.workingCountryId();
      const owner = world.owner[sample.pixel];
      const isNewLand = card.type === 'expand' && owner === 0;
      const projectedDensity = isNewLand
        ? impact * fit
        : world.density[sample.pixel] + impact * fit;
      const threat = countryId === null ? 0 : this.maxNeighborOpponentDensity(sample.pixel, countryId);
      const safe = !isNewLand && card.type !== 'expand' ? true : projectedDensity > threat;
      const current = stats.get(key) ?? {
        h: sample.humidity,
        t: sample.temperature,
        d: sample.drainage,
        value: 0,
        cost: 0,
        weight: 0,
        pixel: sample.pixel,
        bestEfficiency: -1,
        safe: true,
        enemyDistance: Infinity,
        foreignTarget: false,
      };
      current.value += baseEfficiency * sample.weight;
      current.cost += cost * sample.weight;
      current.weight += sample.weight;
      current.safe &&= safe;
      if (baseEfficiency > current.bestEfficiency ||
        (baseEfficiency === current.bestEfficiency && sample.pixel < current.pixel)) {
        current.pixel = sample.pixel;
        current.bestEfficiency = baseEfficiency;
        current.enemyDistance = card.type === 'expand'
          ? this.nearestOpponentCityDistance(sample.pixel, countryId)
          : Infinity;
        current.foreignTarget = card.type === 'colonization' &&
          owner > 0 && owner !== (countryId ?? -1) + 1;
      }
      stats.set(key, current);
    }
    if (this.onMeasure) {
      this.onMeasure('оценка точек климатических контуров', performance.now() - sampleScoringStarted);
    }
    const enemyCityPoints = card.type === 'colonization'
      ? this.painter.strategyOpponentCityPoints()
      : new ContourArea();
    const candidates: TerritoryCandidate[] = [];
    for (const [key, measure] of stats) {
      const region = byKey.get(key)!;
      const area = paintAreaByKey.get(key) ?? new ContourArea();
      if (!area.size) continue;
      const efficiency = measure.weight > 0 ? measure.value / measure.weight : 0;
      const averageCost = measure.weight > 0 ? measure.cost / measure.weight : Infinity;
      const affordableArea = averageCost > 0
        ? Math.min(region.area.size, card.ink / averageCost)
        : 0;
      let citySeed = -1;
      if (card.type === 'colonization') {
        for (const pixel of enemyCityPoints.intersect(area)) {
          if (this.painter.strategyImpactAt(pixel) > 0) {
            citySeed = pixel;
            break;
          }
        }
      }
      const capturesCity = citySeed >= 0;
      candidates.push({
        key,
        pixel: capturesCity ? citySeed : measure.pixel,
        score: efficiency * affordableArea,
        efficiency,
        averageCost,
        safe: measure.safe,
        enemyDistance: measure.enemyDistance,
        foreignTarget: measure.foreignTarget,
        capturesCity,
        accessible: region.area,
        area,
      });
    }
    if (this.onMeasure) this.onMeasure('оценка климатических контуров', performance.now() - started);
    return candidates;
  }

  private limitCandidateToCompetition(
    candidate: TerritoryCandidate,
    competitor: TerritoryCandidate | null,
  ): TerritoryCandidate | null {
    const type = this.painter.card.type;
    if (type !== 'expand' && type !== 'colonization') return candidate;
    if (!competitor) return candidate;
    const distance = this.painter.strategyDistanceLimit(
      candidate.efficiency,
      competitor.efficiency,
    );
    if (!Number.isFinite(distance)) return candidate;
    const area = this.painter.strategyDistanceReachableAreaWithin(candidate.area, distance);
    const accessible = candidate.accessible.intersect(area);
    if (!accessible.size) return null;
    const competitionLimited = accessible.size < candidate.accessible.size;
    const region = this.painter.world.contours.climateIntersections(accessible)
      .find((entry) => `${entry.humidity}:${entry.temperature}:${entry.drainage}` === candidate.key);
    if (!region) return null;
    const [rescored] = this.scoreCandidates(accessible, area, [region]);
    if (!rescored) return null;
    return { ...rescored, area, accessible, competitionLimited };
  }

  private selectCompetitiveCandidate(
    candidates: readonly TerritoryCandidate[],
    requestedSampleSize = 2,
  ): CompetitiveSelection | null {
    return selectCompetitiveContour(
      candidates,
      requestedSampleSize,
      (candidate, competitor) => this.limitCandidateToCompetition(candidate, competitor),
      (left, right) => this.compareCandidates(left, right),
    );
  }

  private compareCandidates(
    a: { score: number; efficiency: number; safe: boolean; capturesCity: boolean; enemyDistance: number; foreignTarget: boolean; pixel: number },
    b: { score: number; efficiency: number; safe: boolean; capturesCity: boolean; enemyDistance: number; foreignTarget: boolean; pixel: number },
  ): number {
    if (this.painter.card.type === 'expand' && a.safe !== b.safe) return a.safe ? -1 : 1;
    if (this.painter.card.type === 'colonization' && a.capturesCity !== b.capturesCity) {
      return a.capturesCity ? -1 : 1;
    }
    if (this.painter.card.type === 'colonization' && a.foreignTarget !== b.foreignTarget) {
      return a.foreignTarget ? -1 : 1;
    }
    return b.score - a.score ||
      (this.painter.card.type === 'expand' ? a.enemyDistance - b.enemyDistance : 0) ||
      b.efficiency - a.efficiency || a.pixel - b.pixel;
  }

  private maxNeighborOpponentDensity(pixel: number, countryId: number): number {
    let maximum = 0;
    forEachNeighbour(pixel, (neighbor) => {
      if (this.painter.world.owner[neighbor] > 0 &&
        this.painter.world.owner[neighbor] !== countryId + 1) {
        maximum = Math.max(maximum, this.painter.world.density[neighbor]);
      }
    });
    return maximum;
  }

  private nearestOpponentCityDistance(pixel: number, countryId: number | null): number {
    if (countryId === null) return Infinity;
    const x = pixel % MAP_WIDTH;
    const y = Math.floor(pixel / MAP_WIDTH);
    let nearest = Infinity;
    for (const city of this.painter.world.cities) {
      if (city.countryId === countryId) continue;
      nearest = Math.min(nearest, Math.hypot(
        city.pixel % MAP_WIDTH - x,
        Math.floor(city.pixel / MAP_WIDTH) - y,
      ));
    }
    return nearest;
  }

  private changedBounds(pixels: readonly number[]): { x0: number; y0: number; x1: number; y1: number } {
    let x0 = MAP_WIDTH, y0 = MAP_HEIGHT, x1 = -1, y1 = -1;
    for (const pixel of pixels) {
      const x = pixel % MAP_WIDTH;
      const y = Math.floor(pixel / MAP_WIDTH);
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    return { x0, y0, x1, y1 };
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
    const territorial = card.type === 'create' || card.type === 'expand' ||
      card.type === 'split' || card.type === 'nomadExpand';
    const canStartWithoutHint = card.type === 'create' || card.type === 'expand' ||
      card.type === 'colonization' || card.type === 'nomadExpand';
    if (card.hint < 0 && !canStartWithoutHint) return;
    if (territorial || card.type === 'colonization') {
      if (!this.actions.contour) {
        throw new Error('Для территориальной кисти ИИ требуется общий инструмент контурной заливки.');
      }
      new ContourTerritoryStrategy(this.painter, this.actions, this.onMeasure).run();
      return;
    }
    const radius = 16;
    const needsLandEndpoints = climateBrushNeedsLandEndpoints(card.type);
    this.paintOtherCards(radius, needsLandEndpoints);
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

  private paintOtherCards(radius: number, needsLandEndpoints: boolean): void {
    const { painter, actions, onMeasure } = this;
    const { card, world } = painter;
    const scoringStarted = onMeasure ? performance.now() : 0;
    const candidates = this.rankCandidates(radius);
    onMeasure?.('оценка центров карты слоя', performance.now() - scoringStarted);
    const selected: number[] = [];
    const spacing = radius * 1.6;
    const spacingSquared = spacing * spacing;
    const spacingStarted = onMeasure ? performance.now() : 0;
    for (const candidate of candidates) {
      if (selected.length >= MAX_SCORE_CENTERS) break;
      const x = candidate.pixel % MAP_WIDTH, y = Math.floor(candidate.pixel / MAP_WIDTH);
      if (selected.some((pixel) =>
        (pixel % MAP_WIDTH - x) ** 2 + (Math.floor(pixel / MAP_WIDTH) - y) ** 2 < spacingSquared,
      )) continue;
      selected.push(candidate.pixel);
    }
    onMeasure?.('расстановка центров карты слоя', performance.now() - spacingStarted);

    let strokeStart = needsLandEndpoints
      ? selected.find((pixel) => painter.climateStrokeEndpointAllowed(pixel)) ?? -1
      : -1;
    if (needsLandEndpoints && strokeStart < 0 &&
      painter.climateStrokeEndpointAllowed(card.hint)) strokeStart = card.hint;
    if (needsLandEndpoints && strokeStart < 0) {
      const firstStart = painter.strategyStrokeContours({
        x0: 0, y0: 0, x1: MAP_WIDTH - 1, y1: MAP_HEIGHT - 1,
      }).start.spans[0];
      if (firstStart) strokeStart = firstStart.y * MAP_WIDTH + firstStart.start;
    }
    if (strokeStart >= 0) {
      actions.beginStroke((strokeStart % MAP_WIDTH) + 0.5, Math.floor(strokeStart / MAP_WIDTH) + 0.5);
    }
    const centers = selected.filter((pixel) => !needsLandEndpoints || pixel !== strokeStart);
    let batchedLayerPaint = false;
    const areaStarted = onMeasure ? performance.now() : 0;
    if (this.candidates.isLayerCard() && actions.contours) {
      // Сначала идут лучшие центры, затем остаток целевого слоя; один пакет
      // сохраняет этот приоритет и пересчитывает границы только после всей кисти.
      const areas: ContourArea[] = [];
      if (centers.length && card.ink > 0) {
        const first = centers[0];
        let centerArea = ContourArea.circle(
          (first % MAP_WIDTH) + 0.5,
          Math.floor(first / MAP_WIDTH) + 0.5,
          radius,
        );
        for (const pixel of centers.slice(1)) {
          centerArea = centerArea.union(ContourArea.circle(
            (pixel % MAP_WIDTH) + 0.5,
            Math.floor(pixel / MAP_WIDTH) + 0.5,
            radius,
          ));
        }
        areas.push(centerArea);
      }
      if (card.ink > 0) {
        areas.push(painter.strategyLayerTargetArea({
          x0: 0, y0: 0, x1: MAP_WIDTH - 1, y1: MAP_HEIGHT - 1,
        }));
      }
      onMeasure?.('подготовка контуров карты слоя', performance.now() - areaStarted);
      const paintingStarted = onMeasure ? performance.now() : 0;
      actions.contours(areas);
      onMeasure?.('заливка контуров карты слоя', performance.now() - paintingStarted);
      batchedLayerPaint = true;
    } else if (actions.contour && centers.length && card.ink > 0) {
      const first = centers[0];
      let area = ContourArea.circle(
        (first % MAP_WIDTH) + 0.5,
        Math.floor(first / MAP_WIDTH) + 0.5,
        radius,
      );
      for (const pixel of centers.slice(1)) {
        area = area.union(ContourArea.circle(
          (pixel % MAP_WIDTH) + 0.5,
          Math.floor(pixel / MAP_WIDTH) + 0.5,
          radius,
        ));
      }
      // Объединённый мазок меняет те же пиксели центров, но обновляет контуры
      // и производные слои один раз, а не после каждого центра отдельно.
      onMeasure?.('подготовка контуров карты слоя', performance.now() - areaStarted);
      const paintingStarted = onMeasure ? performance.now() : 0;
      actions.contour(area);
      onMeasure?.('заливка контуров карты слоя', performance.now() - paintingStarted);
    } else {
      onMeasure?.('подготовка контуров карты слоя', performance.now() - areaStarted);
      const paintingStarted = onMeasure ? performance.now() : 0;
      for (const pixel of centers) {
        if (card.ink <= 0) break;
        actions.dab((pixel % MAP_WIDTH) + 0.5, Math.floor(pixel / MAP_WIDTH) + 0.5, radius);
      }
      onMeasure?.('заливка контуров карты слоя', performance.now() - paintingStarted);
    }
    if (!batchedLayerPaint && this.candidates.isLayerCard() && card.ink > 0) {
      this.paintRemainingLayerTargets(needsLandEndpoints, strokeStart);
    }
    if (needsLandEndpoints && strokeStart >= 0) {
      const x = (strokeStart % MAP_WIDTH) + 0.5;
      const y = Math.floor(strokeStart / MAP_WIDTH) + 0.5;
      const lineStarted = onMeasure ? performance.now() : 0;
      actions.line(x, y, x, y, radius);
      onMeasure?.('завершение климатического мазка', performance.now() - lineStarted);
    }
  }

  private paintRemainingLayerTargets(needsLandEndpoints: boolean, strokeStart: number): void {
    const { painter, actions } = this;
    const { card, world } = painter;
    if (actions.contour) {
      const bounds = { x0: 0, y0: 0, x1: MAP_WIDTH - 1, y1: MAP_HEIGHT - 1 };
      const area = painter.strategyLayerTargetArea(bounds);
      if (needsLandEndpoints && strokeStart < 0) {
        const start = painter.strategyStrokeContours(bounds).start.spans[0];
        if (start) {
          const pixel = start.y * MAP_WIDTH + start.start;
          strokeStart = pixel;
          actions.beginStroke((pixel % MAP_WIDTH) + 0.5, Math.floor(pixel / MAP_WIDTH) + 0.5);
        }
      }
      // Заполняем остаток одной пакетной операцией: контурный проход сохраняет
      // валидатор и порядок растровых целей, не создавая тысячи мелких мазков.
      actions.contour(area);
      return;
    }
    const legalTargets: number[] = [];
    for (let pixel = 0; pixel < world.land.length; pixel += 1) {
      if (painter.strategyInkCostAt(pixel) > 0) legalTargets.push(pixel);
    }
    if (needsLandEndpoints && strokeStart < 0 && legalTargets.length) {
      const start = painter.strategyStrokeContours({
        x0: 0, y0: 0, x1: MAP_WIDTH - 1, y1: MAP_HEIGHT - 1,
      }).start.spans[0];
      const startPixel = start ? start.y * MAP_WIDTH + start.start : undefined;
      if (startPixel !== undefined) {
        actions.beginStroke((startPixel % MAP_WIDTH) + 0.5, Math.floor(startPixel / MAP_WIDTH) + 0.5);
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
