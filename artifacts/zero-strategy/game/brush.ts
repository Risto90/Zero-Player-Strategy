import {
  CLIMATE_DELTA,
  CULTURE_CONVERSION,
  FAITH_CONVERSION,
  MAX_TEMPERATURE_C,
  MAP_HEIGHT,
  MAP_PIXELS,
  MAP_WIDTH,
  MIN_TEMPERATURE_C,
  RANK_AREA_BY_NAME,
} from './config';
import { forEachNeighbour } from './geography';
import { type Country, type GeographyObjectKind, type NomadCell, type World } from './world';
import type { GovernmentId, GovernmentModifierId, Person } from './government';
import { GOVERNMENTS } from './government';
import {
  ColonizationDonorHeap,
  colonizationPlan,
  expansionCoastRoutePoints,
  transferColonizationPopulation,
} from './colonization';
import { applyDensityGrowth, changeCityPopulation, CityInfluenceIndex, cityInfluenceRadius, ensureCityPopulationGroups, populationAtPixel } from './settlements';
import { demography } from './demography';
import { ContourArea, type ContourBounds, type ContourLayerName } from './contours';
import {
  ancestryProfileId,
  climateSuitability,
  combineHumanOriginTableMixes,
  defaultHumanOriginMix,
  humanOriginIndex,
  humanOriginMixFromTable,
  randomHumanOriginId,
} from './human';
import {
  climateAdjustedPopulationCohorts,
  convertPopulationCohortCulture,
  convertPopulationCohortReligion,
  expectedExpansionPopulationCohorts,
  internPopulationCohorts,
  populationCohortsFromMixes,
  setPopulationCohortsAtPixel,
} from './populationCohorts';
import { vector } from '../kernel/geometry';
import { MAP_POINT_AREA_KM2, densityToResidents } from './populationUnits';

export type CardType = 'create' | 'expand' | 'colonization' | 'split' | 'buildCity' | 'upgradeCity' | 'waneCity' | 'moveCapital' | 'nomadExpand' | 'nameGeography' | 'drought' | 'rain' | 'desertification' | 'swamping' | 'warmCurrent' | 'coldCurrent' | 'warmWind' | 'coldWind' | 'faith' | 'culture' | 'government' | 'succession' | 'election' | 'marriage' | 'birth' | 'death' | 'trait' | 'revolt' | 'union';
export interface CardChoice {
  label: string;
  detail: string;
  government?: GovernmentId;
  modifier?: GovernmentModifierId;
  removeModifier?: GovernmentModifierId;
  ruler?: Person;
  person?: Person;
  seatId?: number;
  termYears?: number;
  maxTerms?: number;
  consulCount?: number;
  cityId?: number;
  violent?: boolean;
  closeConsulateSeat?: boolean;
}
export interface CharacterEvent {
  kind: 'marriage' | 'birth' | 'death' | 'trait';
  personIds: number[];
  trait?: string;
  deathCause?: 'random' | 'oldAge';
}
/** «respect»: точка меняется не более одного раза за карту; «repeat»: каждый новый мазок действует повторно. */
export type BrushMode = 'respect' | 'repeat';
export type BrushOption = 'density' | 'repeat' | null;

export interface Card {
  type: CardType;
  title: string;
  detail: string;
  /** Ранг именно кисти; не связан с площадным рангом страны. */
  brushRank?: string | null;
  /** Случайный шаг температурной карты, заданный при её розыгрыше и сохраняемый в игре. */
  temperatureStepC?: number;
  /** Источник события для оформления записи летописи после завершения карты. */
  chronicleScope?: 'world' | 'country';
  chronicleCountryId?: number;
  ink: number;
  inkTotal: number;
  /** Государство, которому принадлежит карта, или на которое она действует. */
  targetCountryId: number | null;
  /** Сущности, созданные картой. */
  newCountryId: number | null;
  newCultureId: number | null;
  newReligionId: number | null;
  sourceCultureId: number | null;
  splitCultureId?: number;
  splitReligionId?: number;
  newGovernmentId: GovernmentId | null;
  newRuler: Person | null;
  choices: CardChoice[] | null;
  selectedChoice: number;
  characterEvent: CharacterEvent | null;
  /** Точная квота суши для одной части раздела при наследовании. */
  splitRequiredPixels?: number;
  /** Оставшиеся части ручного раздела наследства; сохраняются вместе с активной картой. */
  splitBatch?: {
    sourceCountryId: number;
    destinationIds: number[];
    quotas: number[];
    baselinePixels: number[];
    nextIndex: number;
  };
  splitBaselinePixels?: number;
  violentReform?: boolean;
  developmentOnly?: boolean;
  cityPlaced?: boolean;
  /** Выбор судьбы кочевья после основания города. */
  nomadSettlementChoice?: 'revive' | 'new';
  /** Государство, в которое перешло кочевье после основания города. */
  nomadSettledCountryId?: number;
  nomadDensityOnly?: boolean;
  geographyTarget?: { kind: GeographyObjectKind; id: number };
  /** Точка, где карта точно применима; используется при автоматическом розыгрыше. */
  hint: number;
}

export function brushOptionFor(card: Card | null): BrushOption {
  if (!card) return null;
  if (card.type === 'create' || card.type === 'expand' || card.type === 'nomadExpand') return 'density';
  if (['drought', 'rain', 'desertification', 'swamping', 'warmCurrent', 'coldCurrent', 'warmWind', 'coldWind', 'faith', 'culture'].includes(card.type)) return 'repeat';
  return null;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface CardPainterState {
  /** Точки, уже обработанные картой, включая повторные применения в changed. */
  cardTouched: Int32Array;
  changed: Int32Array;
  colonistsMoved: number;
}

const isCurrent = (type: CardType) => type === 'warmCurrent' || type === 'coldCurrent';
const isWind = (type: CardType) => type === 'warmWind' || type === 'coldWind';
const isTemperatureCard = (type: CardType) => isCurrent(type) || isWind(type);
const isHumidityCard = (type: CardType) => type === 'rain' || type === 'drought';
const isCountrySeaClimateCard = (type: CardType) => isHumidityCard(type) || isWind(type);

/** Климатические карты, кроме изменения дренажа, могут менять воду внутри мазка. */
export function climateBrushAffectsSea(type: CardType): boolean {
  return isHumidityCard(type) || isTemperatureCard(type);
}

export function climateBrushNeedsLandEndpoints(type: CardType): boolean {
  return climateBrushAffectsSea(type);
}
const BRUSH_SCALING_CACHE_BLOCK = 64;

function temperatureAfterCard(card: Card, value: number): number {
  const step = card.temperatureStepC;
  if (typeof step !== 'number' || !Number.isFinite(step) || step <= 0) {
    throw new Error('У температурной карты отсутствует заданный шаг в °C.');
  }
  const direction = card.type === 'warmCurrent' || card.type === 'warmWind' ? 1 : -1;
  return Math.max(MIN_TEMPERATURE_C, Math.min(MAX_TEMPERATURE_C, value + direction * step));
}

export interface SplitTerritoryValidation {
  valid: boolean;
  reason: string;
}

/** Общая проверка переноса для карт, наследования и ручной или автоматической кисти раздела. */
export function canAssignSplitPixel(
  world: World,
  sourceCountryId: number,
  destinationCountryId: number,
  pixel: number,
  requiredPixels?: number,
  baselinePixels = 0,
): boolean {
  const source = world.countries[sourceCountryId];
  const destination = world.countries[destinationCountryId];
  if (!source || !destination || !world.land[pixel] ||
    world.owner[pixel] !== sourceCountryId + 1 || world.cityAt(pixel)?.capital) return false;
  if (requiredPixels !== undefined && destination.pixels - baselinePixels >= requiredPixels) return false;
  return true;
}

/** Единый инструмент раздела для мазков игрока и автоматической кисти наследования. */
export class PartitionBrush {
  private readonly baselinePixels: number;

  constructor(
    private readonly world: World,
    readonly sourceCountryId: number,
    readonly destinationCountryId: number,
    readonly requiredPixels?: number,
    baselinePixels?: number,
  ) {
    this.baselinePixels = baselinePixels ?? world.countries[destinationCountryId]?.pixels ?? 0;
  }

  get paintedPixels(): number {
    return (this.world.countries[this.destinationCountryId]?.pixels ?? 0) - this.baselinePixels;
  }

  canPaint(pixel: number): boolean {
    if (!canAssignSplitPixel(this.world, this.sourceCountryId, this.destinationCountryId,
      pixel, this.requiredPixels, this.baselinePixels)) return false;
    const destinationTag = this.destinationCountryId + 1;
    let linked = false;
    forEachNeighbour(pixel, (next) => {
      if (this.world.owner[next] === destinationTag) linked = true;
    });
    if (linked) return true;
    if (this.paintedPixels > 0 || this.baselinePixels > 0) return false;
    return !!this.world.cityAt(pixel);
  }

  paint(pixel: number): boolean {
    if (!this.canPaint(pixel)) return false;
    this.world.setOwner(pixel, this.destinationCountryId + 1);
    return true;
  }
}

/** Проверяет готовую территорию независимо от способа закрашивания. */
export function validateSplitTerritory(
  world: World,
  sourceCountryId: number,
  destinationCountryId: number,
  requiredPixels?: number,
  baselinePixels = 0,
): SplitTerritoryValidation {
  const source = world.countries[sourceCountryId];
  const destination = world.countries[destinationCountryId];
  if (!source || !destination) return { valid: false, reason: 'Не найдена исходная или новая страна.' };
  if (destination.pixels === 0) return { valid: false, reason: 'Выделите территорию новой страны кистью.' };
  if (requiredPixels !== undefined && destination.pixels - baselinePixels !== requiredPixels) {
    return { valid: false, reason: `Нужно выделить ровно ${requiredPixels} участков по наследственной квоте.` };
  }
  const capital = world.cities.find((city) => city.countryId === sourceCountryId && city.capital);
  if (!capital) return { valid: false, reason: 'У исходной страны не найдена столица.' };
  if (world.owner[capital.pixel] !== sourceCountryId + 1) {
    return { valid: false, reason: 'Столица исходной страны должна остаться в ней.' };
  }
  const hasCity = world.cities.some((city) => world.owner[city.pixel] === destinationCountryId + 1);
  if (!hasCity) return { valid: false, reason: 'В отделяемой территории должен находиться хотя бы один город.' };

  let start = -1;
  for (const pixel of world.landIndex) {
    if (world.owner[pixel] === destinationCountryId + 1) { start = pixel; break; }
  }
  if (start < 0) return { valid: false, reason: 'Выделите территорию новой страны кистью.' };
  const seen = new Uint8Array(MAP_PIXELS);
  const queue = [start];
  seen[start] = 1;
  for (let head = 0; head < queue.length; head += 1) {
    forEachNeighbour(queue[head], (next) => {
      if (!seen[next] && world.owner[next] === destinationCountryId + 1) {
        seen[next] = 1;
        queue.push(next);
      }
    });
  }
  if (queue.length !== destination.pixels) {
    return { valid: false, reason: 'Отделяемая территория должна быть связной.' };
  }
  return { valid: true, reason: '' };
}

export function validateSplitPartition(
  world: World,
  sourceCountryId: number,
  destinationIds: number[],
  quotas?: number[],
  baselinePixels: number[] = [],
): SplitTerritoryValidation {
  const source = world.countries[sourceCountryId];
  if (!source || source.pixels <= 0) return { valid: false, reason: 'Исходная страна должна сохранить территорию.' };
  const capital = world.cities.find((city) => city.countryId === sourceCountryId && city.capital);
  if (!capital) return { valid: false, reason: 'У исходной страны не найдена столица.' };
  if (world.owner[capital.pixel] !== sourceCountryId + 1) {
    return { valid: false, reason: 'Столица исходной страны должна остаться в ней.' };
  }
  if (!world.cities.some((city) => world.owner[city.pixel] === sourceCountryId + 1)) {
    return { valid: false, reason: 'В исходной стране должен остаться город.' };
  }
  for (let index = 0; index < destinationIds.length; index += 1) {
    const result = validateSplitTerritory(world, sourceCountryId, destinationIds[index], quotas?.[index],
      baselinePixels[index] ?? 0);
    if (!result.valid) return result;
  }
  return { valid: true, reason: '' };
}

/** Передаёт города новым владельцам и назначает столицей нового государства его крупнейший город. */
export function finalizeSplitCities(world: World, destinationCountryId: number): void {
  const cities = world.cities.filter((city) => world.owner[city.pixel] === destinationCountryId + 1);
  for (const city of cities) {
    city.countryId = destinationCountryId;
    city.capital = false;
  }
  const capital = [...cities].sort((a, b) => b.rank - a.rank || b.population - a.population || a.pixel - b.pixel)[0];
  if (capital) capital.capital = true;
}

/** Применяет одну карту к миру мазок за мазком и расходует её чернила. */
export class CardPainter {
  /** Точки, изменённые картой; используются автоматическим розыгрышем и летописью. */
  readonly changed: number[] = [];
  private readonly cardMask = new Uint8Array(MAP_PIXELS);
  private readonly strokeMask = new Uint8Array(MAP_PIXELS);
  private readonly dabMask = new Uint8Array(MAP_PIXELS);
  /** Общее население, перемещённое картой колонизации. */
  colonistsMoved = 0;
  private readonly cardTouched: number[] = [];
  private strokeTouched: number[] = [];
  private readonly seas = new Set<number>();
  private strokeClimateChanges: {
    p: number;
    layer: 'humidity' | 'temperature';
    value: number;
    cost: number;
    wasInCard: boolean;
  }[] = [];
  private strokeChangedStart = 0;
  colonizationMask: Uint8Array | null;
  colonizationAnchors: Uint8Array | null;
  colonizationBounds: ContourBounds | null;
  private colonizationConnected: Uint8Array | null;
  private readonly colonizationDonors: ColonizationDonorHeap | null;
  private cityInfluence: CityInfluenceIndex | null;
  private readonly splitBrush: PartitionBrush | null;
  private readonly brushScalingCache = new Map<number, { cost: Float64Array; strength: Float64Array }>();
  private readonly distanceFactorCache = new Map<number, number>();
  private lastStrategyScalingPixel = -1;
  private lastStrategyScalingCost = 0;
  private originScoreMix: ReturnType<typeof defaultHumanOriginMix> | null = null;
  private forbiddenCreationArea: ContourArea | null = null;
  private colonizationTargetArea: ContourArea | null = null;
  private readonly influenceCache = new Map<number, ReturnType<CityInfluenceIndex['at']>>();
  private readonly climateGainCache = new Map<string, number>();
  private nomadMode: 'range' | 'density' | 'inactive' = 'range';
  private readonly nomadRange = new Set<number>();
  private readonly nomadCells = new Map<number, NomadCell>();
  private readonly strategyCoastAreas = new Map<number, ContourArea>();
  dirty: Rect | null = null;
  message = '';

  constructor(
    readonly world: World,
    readonly card: Card,
    public mode: BrushMode,
    state?: CardPainterState | null,
  ) {
    const working = this.workingCountryId();
    if (card.type === 'create') {
      const culture = world.cultures[card.newCultureId ?? -1];
      if (!culture) throw new Error('A country creation card must reference its new culture.');
      // Старое сохранение может содержать карту основания, созданную до сохранения расы основателей.
      culture.foundingRaceId ??= randomHumanOriginId();
    }
    if (card.type === 'nomadExpand' && card.targetCountryId !== null) {
      const nomad = world.countries[card.targetCountryId];
      if (nomad) {
        for (const pixel of nomad.range ?? []) this.nomadRange.add(pixel);
        for (const cell of nomad.cells ?? []) this.nomadCells.set(cell.pixel, cell);
      }
    }
    const colonizationCountry = card.type === 'colonization' && card.targetCountryId !== null
      ? world.countries[card.targetCountryId]
      : null;
    const colonization = colonizationCountry ? colonizationPlan(world, colonizationCountry) : null;
    this.colonizationMask = colonization?.targets ?? null;
    this.colonizationAnchors = colonization?.anchors ?? null;
    this.colonizationBounds = colonization?.targetBounds ?? null;
    this.colonizationConnected = colonization?.connectedTerritory.slice() ?? null;
    this.colonizationDonors = colonization ? new ColonizationDonorHeap(world, colonization.donors) : null;
    const influenceCountryId = card.type === 'create' || card.type === 'nomadExpand' ? -1
      : card.type === 'expand' || card.type === 'colonization' ? card.targetCountryId
        : null;
    const influenceCountry = influenceCountryId !== null && influenceCountryId >= 0
      ? world.countries[influenceCountryId] ?? null
      : null;
    const expansionRoutes = card.type === 'expand' && influenceCountry
      ? expansionCoastRoutePoints(world, influenceCountry)
      : [];
    this.cityInfluence = influenceCountryId !== null
      ? new CityInfluenceIndex(
          world,
          influenceCountryId,
          card.type === 'colonization',
          colonization?.anchors,
          colonization?.routePoints ?? expansionRoutes,
          colonization?.cityInfluenceAreas,
        )
      : null;
    this.splitBrush = card.type === 'split' && card.targetCountryId !== null && card.newCountryId !== null
      ? new PartitionBrush(world, card.targetCountryId, card.newCountryId, card.splitRequiredPixels, card.splitBaselinePixels)
      : null;
    if (working !== null && (card.type === 'expand' || card.type === 'split')) {
      const source = world.countries[card.type === 'split' ? (card.targetCountryId as number) : working];
      if (card.type === 'expand') {
        world.forEachCountryPixel(source, (p) => world.seasOfPixel(p, this.seas));
      }
    }
    const country = working !== null
      ? world.countries[working]
      : isCountrySeaClimateCard(card.type) && card.targetCountryId !== null
        ? world.countries[card.targetCountryId]
        : null;
    if (country && isCountrySeaClimateCard(card.type)) {
      world.forEachCountryPixel(country, (p) => world.seasOfPixel(p, this.seas));
    }
    if (state) {
      for (const pixel of state.cardTouched) {
        if (pixel >= 0 && pixel < MAP_PIXELS && !this.cardMask[pixel]) {
          this.cardMask[pixel] = 1;
          this.cardTouched.push(pixel);
        }
      }
      for (const pixel of state.changed) this.changed.push(pixel);
      this.colonistsMoved = state.colonistsMoved;
    }
  }

  snapshotState(): CardPainterState {
    return {
      cardTouched: Int32Array.from(this.cardTouched),
      changed: Int32Array.from(this.changed),
      colonistsMoved: this.colonistsMoved,
    };
  }

  /** Государство, чья территория растёт: новое при основании или разделе, владелец при расширении. */
  workingCountryId(): number | null {
    const card = this.card;
    if (card.type === 'create' || card.type === 'split') return card.newCountryId;
    if (card.type === 'expand' || card.type === 'colonization') return card.targetCountryId;
    return null;
  }

  strategyNomadRangeContains(pixel: number): boolean {
    return this.nomadRange.has(pixel);
  }

  /** Проверяет допустимую сушу и море для текущей климатической карты. */
  private climatePixelInScope(pixel: number): boolean {
    if (pixel < 0 || pixel >= MAP_PIXELS) return false;
    const type = this.card.type;
    const onLand = this.world.land[pixel] === 1;
    if (type === 'desertification' || type === 'swamping') {
      return onLand && (this.card.targetCountryId === null ||
        this.world.owner[pixel] === this.card.targetCountryId + 1);
    }
    if (isCurrent(type)) return onLand || this.world.water.bodyOf[pixel] >= 0;
    if (!isHumidityCard(type) && !isWind(type)) return false;
    if (onLand) {
      return this.card.targetCountryId === null ||
        this.world.owner[pixel] === this.card.targetCountryId + 1;
    }
    const sea = this.world.water.bodyOf[pixel];
    if (sea < 0) return false;
    return this.card.targetCountryId === null || this.seas.has(sea);
  }

  /** Море допустимо внутри климатического мазка, только если оба конца лежат на суше. */
  climateStrokeEndpointAllowed(pixel: number): boolean {
    if (!climateBrushNeedsLandEndpoints(this.card.type)) return true;
    if (pixel < 0 || pixel >= MAP_PIXELS || this.world.land[pixel] !== 1) return false;
    if (isCurrent(this.card.type) || this.card.targetCountryId === null) return true;
    return this.world.owner[pixel] === this.card.targetCountryId + 1;
  }

  /**
   * Оценивает немедленную пользу изменения точки до нормирования на расход чернил.
   * Метод только читает данные и повторяет реальное влияние карты на население и климат.
   */
  strategyImpactAt(pixel: number): number {
    const card = this.card;
    const world = this.world;
    if (pixel < 0 || pixel >= MAP_PIXELS || card.ink <= 0 ||
      this.strokeMask[pixel] || (this.mode === 'respect' && this.cardMask[pixel])) return 0;

    const onLand = world.land[pixel] === 1;
    const targetTag = card.targetCountryId === null ? -1 : card.targetCountryId + 1;
    const { cost, strength } = this.brushScaling(pixel);
    this.lastStrategyScalingPixel = pixel;
    this.lastStrategyScalingCost = cost;
    if (!(cost > 0) || !Number.isFinite(cost)) return 0;

    if (card.type === 'create' || card.type === 'expand' || card.type === 'colonization' ||
      card.type === 'split' || card.type === 'nomadExpand') {
      if (!onLand) return 0;
      if (card.type === 'nomadExpand') {
        const nomad = card.targetCountryId === null ? null : world.countries[card.targetCountryId];
        if (!nomad || this.nomadMode === 'inactive') return 0;
        if (this.nomadMode === 'density') {
            return this.nomadRange.has(pixel) ? strength : 0;
        }
        if (this.nomadRange.has(pixel)) return 0;
        let linked = false;
        forEachNeighbour(pixel, (neighbor) => { if (this.nomadRange.has(neighbor)) linked = true; });
        if (!linked) return 0;
        const population = Number.isFinite(nomad.density)
          ? nomad.density
          : (nomad.cells ?? []).reduce((sum, cell) => sum + densityToResidents(cell.density), 0) /
            (Math.max(1, nomad.range?.length ?? 0) * MAP_POINT_AREA_KM2);
        return population * strength;
      }

      const workingId = this.workingCountryId();
      if (workingId === null) return 0;
      const working = world.countries[workingId];
      if (!working) return 0;
      if (card.type === 'split') {
        if (!this.splitBrush?.canPaint(pixel)) return 0;
        return world.cityAt(pixel)?.population ?? 1;
      }
      if (card.type === 'colonization') {
        const valid = this.canColonizePixel(pixel);
        const donor = this.colonizationDonors?.peek() ?? -1;
        if (!valid || donor < 0) return 0;
        const donorDensity = world.density[donor];
        const targetDensity = world.owner[pixel] > 0 ? world.density[pixel] : 0;
        const ideal = donorDensity * 0.1;
        const domestic = world.owner[pixel] === targetTag;
        let moved = Math.min(ideal, donorDensity - targetDensity);
        if (world.owner[pixel] > 0 && !domestic) moved = Math.min(moved, targetDensity);
        return Math.max(0, moved);
      }

      const owner = world.owner[pixel];
      if (card.type === 'expand' && owner === workingId + 1 && this.mode === 'repeat') {
        return strength;
      }
      if (owner !== 0) return 0;
      if (card.type === 'create' && (this.influenceAt(pixel)?.foreignRankSum ?? 0) > 0) return 0;
      let linked = working.pixels === 0 && card.type === 'create';
      forEachNeighbour(pixel, (neighbor) => {
        if (world.owner[neighbor] === workingId + 1) linked = true;
        else if (card.type !== 'split' && this.seas.size > 0 &&
          world.water.bodyOf[neighbor] >= 0 && this.seas.has(world.water.bodyOf[neighbor])) linked = true;
      });
      if (!linked) return 0;
      return Math.max(0, working.density * strength);
    }

    if (card.type === 'drought' || card.type === 'rain' || card.type === 'warmCurrent' ||
      card.type === 'coldCurrent' || card.type === 'warmWind' || card.type === 'coldWind') {
      if (!this.climatePixelInScope(pixel)) return 0;
      const city = world.cityAt(pixel);
      const groups = city ? ensureCityPopulationGroups(world, city) : null;
      const population = city
        ? groups!.reduce((sum, group) => sum + group.population, 0)
        : populationAtPixel(world, pixel);
      if (population <= 0) return 0;
      const temperature = world.temperature[pixel];
      const humidity = world.humidity[pixel];
      const drainage = world.drainage[pixel];
      const nextTemperature = isTemperatureCard(card.type)
        ? temperatureAfterCard(card, temperature)
        : temperature;
      const nextHumidity = card.type === 'rain'
        ? Math.min(100, humidity + CLIMATE_DELTA)
        : card.type === 'drought'
          ? Math.max(0, humidity - CLIMATE_DELTA)
          : humidity;
      if (nextTemperature === temperature && nextHumidity === humidity) return 0;
      if (groups) {
        const mixedOrigins = combineHumanOriginTableMixes(
          world.humanOriginTable,
          groups.map((group) => ({ id: group.humanOriginMix, weight: group.population })),
        );
        return population * this.climateGain(
          mixedOrigins, temperature, humidity, drainage, nextTemperature, nextHumidity,
        );
      }
      return population * this.climateGain(
        world.humanOrigins[pixel], temperature, humidity, drainage, nextTemperature, nextHumidity,
      );
    }

    if (card.type === 'faith' || card.type === 'culture') {
      if (!onLand || world.owner[pixel] === 0 ||
        (card.targetCountryId !== null && world.owner[pixel] !== targetTag)) return 0;
      const population = world.density[pixel];
      if (population <= 0) return 0;
      if (card.type === 'faith') {
        const current = world.religionTable.shareOf(world.religion[pixel], card.newReligionId as number);
        return population * (100 - current) / 100 * FAITH_CONVERSION;
      }
      const source = world.cultureTable.shareOf(world.culture[pixel], card.sourceCultureId as number);
      const target = world.cultureTable.shareOf(world.culture[pixel], card.newCultureId as number);
      return population * Math.max(0, source - target) / 100 * CULTURE_CONVERSION;
    }

    // Неизвестный тип карты сам по себе не меняет население. Дренаж при этом
    // учитывается в климатической пригодности создаваемых групп через climateGain.
    return 0;
  }

  /** Фактически потраченные чернила за допустимое изменение растра, включая пустые климатические точки. */
  strategyInkCostAt(pixel: number, knownImpact?: number): number {
    const card = this.card;
    const world = this.world;
    if (pixel < 0 || pixel >= MAP_PIXELS || card.ink <= 0 ||
      this.strokeMask[pixel] || (this.mode === 'respect' && this.cardMask[pixel])) return 0;
    const onLand = world.land[pixel] === 1;
    const targetTag = card.targetCountryId === null ? -1 : card.targetCountryId + 1;

    if (card.type === 'drought' || card.type === 'rain' || card.type === 'desertification' ||
      card.type === 'swamping' || card.type === 'warmCurrent' || card.type === 'coldCurrent' ||
      card.type === 'warmWind' || card.type === 'coldWind') {
      if (!this.climatePixelInScope(pixel)) return 0;
      const temperatureCard = card.type === 'warmCurrent' || card.type === 'coldCurrent' ||
        card.type === 'warmWind' || card.type === 'coldWind';
      const value = temperatureCard ? world.temperature[pixel] : card.type === 'rain' || card.type === 'drought'
        ? world.humidity[pixel] : world.drainage[pixel];
      const canIncrease = card.type === 'rain' || card.type === 'desertification' ||
        card.type === 'warmCurrent' || card.type === 'warmWind';
      const canChange = temperatureCard
        ? canIncrease ? value < MAX_TEMPERATURE_C : value > MIN_TEMPERATURE_C
        : canIncrease ? value < 100 : value > 0;
      if (!canChange) return 0;
      const cost = (card.type === 'warmWind' || card.type === 'coldWind') && !onLand ? 0.5 : 1;
      return cost <= card.ink + 1e-9 ? cost : 0;
    }

    if (card.type === 'faith' || card.type === 'culture') {
      if (!onLand || world.owner[pixel] === 0 ||
        (card.targetCountryId !== null && world.owner[pixel] !== targetTag)) return 0;
      if (card.type === 'faith') {
        const next = world.religionTable.convert(world.religion[pixel], card.newReligionId as number, FAITH_CONVERSION, null);
        return next === world.religion[pixel] ? 0 : 1;
      }
      const next = world.cultureTable.convert(
        world.culture[pixel],
        card.newCultureId as number,
        CULTURE_CONVERSION,
        card.sourceCultureId,
      );
      return next === world.culture[pixel] ? 0 : 1;
    }

    const impact = knownImpact ?? this.strategyImpactAt(pixel);
    if (!(impact > 0)) return 0;
    return this.lastStrategyScalingPixel === pixel
      ? this.lastStrategyScalingCost
      : this.brushScaling(pixel).cost;
  }

  /** Стоимость закрашивания допустимой точки территории. */
  strategyTerritoryInkCostAt(pixel: number): number {
    if (pixel < 0 || pixel >= MAP_PIXELS || !this.world.land[pixel]) return 0;
    return this.brushScaling(pixel).cost;
  }

  /**
   * Геометрия пригодных целей хранится как объединение/пересечение контуров слоёв.
   * Это только ограничение области: стоимость, плотность и эффект применяет общий CardPainter.
   */
  strategyCandidateArea(
    bounds: ContourBounds,
    onMeasure?: (stage: string, durationMs: number) => void,
  ): ContourArea {
    const world = this.world;
    let area = world.contours.layer('land').select((value) => value === 1, bounds, 'land');
    const type = this.card.type;
    if (type === 'nomadExpand') {
      const range = ContourArea.pixels([...this.nomadRange]).clip(bounds);
      if (this.nomadMode === 'inactive') return new ContourArea();
      return this.nomadMode === 'density'
        ? area.intersect(range)
        : area.subtract(range);
    }
    if (type === 'create' || type === 'expand' || type === 'split') {
      const tag = type === 'split' ? (this.card.targetCountryId ?? -1) + 1 : 0;
      const ownTag = (this.workingCountryId() ?? -1) + 1;
      area = area.intersect(world.contours.layer('owner').select(
        (value) => value === tag || (type === 'expand' && this.mode === 'repeat' && value === ownTag),
        bounds, `${type}:${tag}:${ownTag}:${this.mode}`));
    }
    if (type === 'colonization') {
      if (!this.colonizationTargetArea) {
        const started = onMeasure ? performance.now() : 0;
        this.colonizationTargetArea = this.colonizationMask
          ? ContourArea.fromBinaryMask(
              this.colonizationMask,
              this.colonizationBounds ?? { x0: 0, y0: 0, x1: -1, y1: -1 },
            )
          : new ContourArea();
        if (this.cityInfluence && this.colonizationMask) {
          const influence = this.cityInfluence.colonizationInfluenceAreas();
          this.colonizationTargetArea = this.colonizationTargetArea.subtract(
            influence.foreign.subtract(influence.own),
          );
        } else if (this.colonizationMask) {
          this.colonizationTargetArea = ContourArea.fromMask(
            this.colonizationMask,
            this.colonizationBounds ?? { x0: 0, y0: 0, x1: -1, y1: -1 },
            (_value, pixel) => this.canColonizePixel(pixel),
          );
        }
        if (this.mode === 'repeat' && this.workingCountryId() !== null) {
          const donor = this.colonizationDonors?.peek() ?? -1;
          if (donor >= 0) {
            const bounds = { x0: 0, y0: 0, x1: MAP_WIDTH - 1, y1: MAP_HEIGHT - 1 };
            const own = world.contours.layer('owner').select(
              (value) => value === (this.workingCountryId() as number) + 1,
              bounds,
            );
            const lessDense = world.contours.layer('density').select(
              (value) => value < world.density[donor],
              bounds,
            );
            this.colonizationTargetArea = this.colonizationTargetArea.union(own.intersect(lessDense));
          }
        }
        if (onMeasure) onMeasure('контур допустимых целей колонизации', performance.now() - started);
      }
      area = area.intersect(this.colonizationTargetArea);
    }
    if (type === 'create') {
      if (!this.forbiddenCreationArea) {
        const spans = world.cities.flatMap((city) => ContourArea.circle(city.pixel % MAP_WIDTH + 0.5,
          Math.floor(city.pixel / MAP_WIDTH) + 0.5, cityInfluenceRadius(world, city)).spans);
        this.forbiddenCreationArea = new ContourArea(spans);
      }
      area = area.subtract(this.forbiddenCreationArea);
    }
    return area;
  }

  /** Область действия климатической/демографической карты, собранная из контуров слоя. */
  strategyLayerTargetArea(bounds: ContourBounds): ContourArea {
    const world = this.world;
    const land = world.contours.layer('land').select((value) => value === 1, bounds, 'land');
    const owners = world.contours.layer('owner');
    const type = this.card.type;

    if (isCurrent(type)) {
      const water = world.contours.layer('water').select((value) => value >= 0, bounds);
      return land.union(water);
    }
    if (isWind(type)) {
      const own = owners.select((value) => value === (this.card.targetCountryId ?? -1) + 1, bounds);
      const water = world.contours.layer('water').select((value) => this.seas.has(value), bounds);
      return own.intersect(land).union(water);
    }
    if (isHumidityCard(type)) {
      const ownLand = this.card.targetCountryId === null
        ? land
        : land.intersect(owners.select((value) => value === this.card.targetCountryId! + 1, bounds));
      const water = world.contours.layer('water').select(
        (value) => value >= 0 && (this.card.targetCountryId === null || this.seas.has(value)),
        bounds,
      );
      return ownLand.union(water);
    }
    if (type === 'faith' || type === 'culture') {
      const inhabited = owners.select((value) => value > 0, bounds);
      const scope = this.card.targetCountryId === null
        ? inhabited
        : inhabited.intersect(owners.select((value) => value === this.card.targetCountryId! + 1, bounds));
      return scope.intersect(land);
    }
    if (this.card.targetCountryId !== null) {
      return land.intersect(owners.select((value) => value === this.card.targetCountryId! + 1, bounds));
    }
    return land;
  }

  /**
   * Контуры начала, прохода и окончания задаются раздельно для проверки ручного мазка.
   * ИИ использует эти же области и ту же кисть; не заменять правила пиксельным обходом или отдельной логикой.
   */
  strategyStrokeContours(
    bounds: ContourBounds,
    onMeasure?: (stage: string, durationMs: number) => void,
  ): { paint: ContourArea; start: ContourArea; stop: ContourArea } {
    const world = this.world;
    const type = this.card.type;
    const land = world.contours.layer('land').select((value) => value === 1, bounds, 'land');
    if (type === 'colonization') {
      const paint = this.strategyCandidateArea(bounds, onMeasure);
      const targetBounds = this.colonizationBounds ?? { x0: 0, y0: 0, x1: -1, y1: -1 };
      let started = onMeasure ? performance.now() : 0;
      const anchors = this.colonizationAnchors
        ? ContourArea.fromBinaryMask(this.colonizationAnchors, targetBounds)
        : new ContourArea();
      if (onMeasure) {
        onMeasure('контур речных и береговых якорей', performance.now() - started);
        started = performance.now();
      }
      const connected = this.colonizationConnected
        ? ContourArea.fromBinaryMask(this.colonizationConnected, {
            x0: Math.max(0, targetBounds.x0 - 1),
            y0: Math.max(0, targetBounds.y0 - 1),
            x1: Math.min(MAP_WIDTH - 1, targetBounds.x1 + 1),
            y1: Math.min(MAP_HEIGHT - 1, targetBounds.y1 + 1),
          })
        : new ContourArea();
      if (onMeasure) onMeasure('контур связанной территории', performance.now() - started);
      const domesticStart = this.mode === 'repeat'
        ? world.contours.layer('owner').select(
            (value) => value === (this.workingCountryId() ?? -1) + 1,
            bounds,
          ).intersect(land)
        : new ContourArea();
      const start = paint.intersect(anchors.union(connected.border()).union(domesticStart));
      return { paint, start, stop: paint };
    }
    if (isWind(type)) {
      const own = world.contours.layer('owner').select((value) => value === (this.card.targetCountryId ?? -1) + 1, bounds);
      const water = world.contours.layer('water').select((value) => this.seas.has(value), bounds);
      return { paint: own.intersect(land).union(water), start: own.intersect(land), stop: own.intersect(land) };
    }
    if (isCurrent(type)) {
      const water = world.contours.layer('water').select((value) => value >= 0, bounds);
      return { paint: land.union(water), start: land, stop: land };
    }
    if (isHumidityCard(type)) {
      const paint = this.strategyLayerTargetArea(bounds);
      const start = this.card.targetCountryId === null
        ? land
        : land.intersect(world.contours.layer('owner').select(
            (value) => value === this.card.targetCountryId! + 1,
            bounds,
          ));
      return { paint, start, stop: start };
    }
    if (type === 'split') {
      const paint = this.strategyCandidateArea(bounds, onMeasure);
      const newCountryId = this.card.newCountryId;
      if (newCountryId === null) return { paint, start: new ContourArea(), stop: paint };
      const owners = world.contours.layer('owner');
      const destination = owners.select((value) => value === newCountryId + 1, bounds);
      const start = destination.size
        ? paint.intersect(destination.neighbourhood8())
        : this.card.hint >= 0
          ? paint.intersect(ContourArea.pixels([this.card.hint]))
          : new ContourArea();
      return { paint, start, stop: paint };
    }
    if (type === 'nomadExpand') {
      const paint = this.strategyCandidateArea(bounds, onMeasure);
      const range = ContourArea.pixels([...this.nomadRange]).clip(bounds);
      const start = this.nomadMode === 'density'
        ? paint.intersect(range)
        : paint.intersect(range.neighbourhood8());
      return { paint, start, stop: paint };
    }
    const paint = this.strategyCandidateArea(bounds);
    if (type !== 'create' && type !== 'expand') return { paint, start: paint, stop: paint };
    const country = world.countries[this.workingCountryId() ?? -1];
    if (!country || country.pixels === 0) return { paint, start: paint, stop: paint };
    const owners = world.contours.layer('owner');
    const owned = owners.select((value) => value === country.id + 1, bounds, `country:${country.id}`);
    const unownedLand = owners.select((value) => value === 0, bounds).intersect(land);
    let frontier = owned.neighbourhood8().intersect(unownedLand);
    for (const sea of this.seas) {
      frontier = frontier.union(this.strategyCoastArea(sea).clip(bounds).intersect(unownedLand));
    }
    let start = paint.intersect(frontier);
    if (type === 'expand' && this.mode === 'repeat') {
      const ownedLand = owners.select((value) => value === country.id + 1, bounds)
        .intersect(land);
      start = start.union(paint.intersect(ownedLand).intersect(this.strategyOwnCityZones()));
    }
    return { paint, start, stop: paint };
  }

  strategyClimateFit(temperature: number, humidity: number, drainage = 50): number {
    if (!this.originScoreMix) {
      const countryId = this.card.type === 'nomadExpand'
        ? this.card.targetCountryId
        : this.workingCountryId();
      const country = this.world.countries[countryId ?? -1];
      const foundingOrigin = this.card.type === 'create'
        ? this.world.cultures[this.card.newCultureId ?? -1]?.foundingRaceId : null;
      if (foundingOrigin) this.originScoreMix = { ids: [foundingOrigin], shares: [100] };
      else if (country) {
        const mix = demography(this.world, country).humanOrigin;
        let leader = 0;
        for (let index = 1; index < mix.shares.length; index += 1) {
          if (mix.shares[index] > mix.shares[leader]) leader = index;
        }
        this.originScoreMix = mix.ids.length
          ? { ids: [mix.ids[leader]], shares: [100] }
          : defaultHumanOriginMix();
      } else this.originScoreMix = defaultHumanOriginMix();
    }
    return climateSuitability(this.originScoreMix, temperature, humidity, drainage);
  }

  strategySeaBodies(): ReadonlySet<number> {
    return this.seas;
  }

  strategyCoastArea(sea: number): ContourArea {
    let area = this.strategyCoastAreas.get(sea);
    if (!area) {
      area = ContourArea.pixels(this.world.water.coastsOf[sea] ?? []);
      this.strategyCoastAreas.set(sea, area);
    }
    return area;
  }

  setStrategyMode(mode: BrushMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    // Масштаб кисти зависит от городов и геометрии, а не от режима мазка.
    // Кэши сбрасываются при изменении самих зон влияния, не при выборе стратегии.
    this.colonizationTargetArea = null;
  }

  strategyOwnCityZones(): ContourArea {
    return this.cityInfluence?.colonizationInfluenceAreas().own ?? new ContourArea();
  }

  strategyRepeatGrowthArea(bounds: ContourBounds): ContourArea {
    const countryId = this.workingCountryId();
    if (countryId === null) return new ContourArea();
    const tag = countryId + 1;
    const land = this.world.contours.layer('land').select((value) => value === 1, bounds, 'land');
    const owners = this.world.contours.layer('owner');
    const own = owners.select((value) => value === tag, bounds).intersect(land);
    const hostile = owners.select((value) => value > 0 && value !== tag, bounds);
    const threatenedBorder = own.intersect(hostile.neighbourhood8());
    return own.intersect(this.strategyOwnCityZones().union(threatenedBorder));
  }

  strategyDistanceReachableArea(distance: number): ContourArea {
    return this.cityInfluence?.distanceReachableArea(distance) ?? new ContourArea();
  }

  strategyDistanceReachableAreaWithin(area: ContourArea, distance: number): ContourArea {
    return this.cityInfluence?.distanceReachableAreaWithin(area, distance) ?? new ContourArea();
  }

  strategyDistanceBands(area: ContourArea, step: number, maximumDistance: number): ContourArea[] {
    return this.cityInfluence?.distanceBands(area, step, maximumDistance) ?? [];
  }

  strategyDistanceFactorAt(pixel: number): number {
    if (this.card.type !== 'expand' && this.card.type !== 'colonization') return 1;
    const influence = this.influenceAt(pixel);
    return influence ? this.distanceFactorAt(pixel, influence) : 1;
  }

  /** Возвращает отдачу в точке после исключения линейного штрафа дистанции. */
  strategyBaseEfficiencyAt(pixel: number, impact: number, cost: number): number {
    if (!(impact > 0) || !(cost > 0)) return 0;
    const factor = this.strategyDistanceFactorAt(pixel);
    if (!Number.isFinite(factor)) return 0;
    const exponent = this.card.type === 'expand' ? 2 : this.card.type === 'colonization' ? 1 : 0;
    return impact / cost * factor ** exponent;
  }

  /** Находит предел расстояния, до которого текущая кисть выгоднее конкурента. */
  strategyDistanceLimit(currentEfficiency: number, competingEfficiency: number): number {
    const exponent = this.card.type === 'expand' ? 2 : this.card.type === 'colonization' ? 1 : 0;
    if (exponent === 0 || competingEfficiency <= 0) return Infinity;
    if (!Number.isFinite(currentEfficiency) || currentEfficiency <= competingEfficiency) return 0;
    const distanceScale = Math.sqrt(RANK_AREA_BY_NAME['Герцогство'] / Math.PI);
    return distanceScale * ((currentEfficiency / competingEfficiency) ** (1 / exponent) - 1);
  }

  strategyMaximumRouteExtraDistance(): number {
    return this.cityInfluence?.maximumRouteExtraDistance() ?? 0;
  }

  strategyOpponentCityPoints(): ContourArea {
    const countryId = this.workingCountryId();
    if (countryId === null) return new ContourArea();
    return ContourArea.pixels(this.world.cities
      .filter((city) => city.countryId !== countryId)
      .map((city) => city.pixel));
  }

  /**
   * Общий инструмент заполнения контура: те же эффекты, связность и расход чернил, что у мазка.
   * Контур должен оставаться геометрическим объектом до общего шага нанесения кисти.
   */
  paintContour(area: ContourArea, seed?: number): number {
    return this.paintContours([area], seed);
  }

  /** Несколько областей одного события обрабатываются за одну синхронизацию и инвалидацию слоёв. */
  paintContours(
    areas: readonly ContourArea[],
    seedOrSeeds?: number | readonly (number | undefined)[],
  ): number {
    this.world.contours.synchronize();
    if (!areas.some((area) => area.size > 0) || this.card.ink <= 0) return 0;
    const before = this.card.ink;
    const touchedStart = this.strokeTouched.length;
    const seedAt = (index: number) => typeof seedOrSeeds === 'number'
      ? index === 0 ? seedOrSeeds : undefined
      : seedOrSeeds?.[index];
    if (['create', 'expand', 'colonization', 'split', 'nomadExpand'].includes(this.card.type)) {
      if (this.card.type === 'expand' && this.mode !== 'repeat') {
        const area = areas.reduce((combined, current) => combined.union(current), new ContourArea());
        if (!area.size) return 0;
        this.paintTerritory([], area, seedAt(0));
      } else {
        const pixelsForArea = (areaIndex: number, pixels: number[]) => {
          const startIndex = pixels.length;
          const area = areas[areaIndex];
          area.forEachPixel((pixel) => {
            if (this.world.land[pixel] ||
              (climateBrushAffectsSea(this.card.type) && this.climatePixelInScope(pixel))) pixels.push(pixel);
          });
          const seed = seedAt(areaIndex);
          if (seed !== undefined) {
            const index = pixels.indexOf(seed, startIndex);
            if (index > startIndex) {
              pixels.splice(index, 1);
              pixels.splice(startIndex, 0, seed);
            }
          }
        };
        if (this.card.type === 'create') {
          for (let areaIndex = 0; areaIndex < areas.length; areaIndex += 1) {
            const pixels: number[] = [];
            pixelsForArea(areaIndex, pixels);
            if (pixels.length) this.paintTerritory(pixels);
          }
        } else {
          const pixels: number[] = [];
          for (let areaIndex = 0; areaIndex < areas.length; areaIndex += 1) {
            pixelsForArea(areaIndex, pixels);
          }
          if (!pixels.length) return 0;
          this.paintTerritory(pixels);
        }
      }
    } else {
      // Слой обрабатывается потоково: когда чернила заканчиваются, перебор
      // останавливается без создания массива всех пикселей большого контура.
      this.paintLayer(this.layerPixels(areas));
    }
    const spent = before - this.card.ink;
    if (spent > 0) {
      this.world.version += 1;
      let x0 = MAP_WIDTH, y0 = MAP_HEIGHT, x1 = -1, y1 = -1;
      for (let index = touchedStart; index < this.strokeTouched.length; index += 1) {
        const pixel = this.strokeTouched[index], x = pixel % MAP_WIDTH, y = Math.floor(pixel / MAP_WIDTH);
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      const fallbackBounds = areas.reduce((bounds, area) => {
        const current = area.bounds;
        return {
          x0: Math.min(bounds.x0, current.x0),
          y0: Math.min(bounds.y0, current.y0),
          x1: Math.max(bounds.x1, current.x1),
          y1: Math.max(bounds.y1, current.y1),
        };
      }, { x0: MAP_WIDTH, y0: MAP_HEIGHT, x1: -1, y1: -1 });
      const dirty = x1 >= x0 ? { x0, y0, x1, y1 } : fallbackBounds;
      this.markDirty(dirty.x0 - 1, dirty.y0 - 1, dirty.x1 + 1, dirty.y1 + 1);
      const names: ContourLayerName[] = ['owner', 'density', 'culture', 'religion', 'humanOrigins'];
      if (['rain', 'drought'].includes(this.card.type)) names.push('humidity');
      if (['swamping', 'desertification'].includes(this.card.type)) names.push('drainage');
      if (isTemperatureCard(this.card.type)) names.push('temperature');
      this.world.contours.changed(dirty, names);
    }
    return spent;
  }

  private *layerPixels(areas: readonly ContourArea[]): Generator<number> {
    for (const area of areas) {
      for (const pixel of area) {
        const onLand = this.world.land[pixel] === 1;
        if (onLand ||
          (climateBrushAffectsSea(this.card.type) && this.climatePixelInScope(pixel))) {
          yield pixel;
        }
      }
    }
  }

  /** Максимум чернил для одной точки колонизации с учётом ограничения населения. */
  strategyColonizationInkCapacityAt(pixel: number, sourceDensity?: number): number {
    const countryId = this.card.targetCountryId;
    if (this.card.type !== 'colonization' || countryId === null || !this.canColonizePixel(pixel)) return 0;
    const donor = sourceDensity === undefined ? this.colonizationDonors?.peek() ?? -1 : -1;
    const density = sourceDensity ?? (donor < 0 ? 0 : this.world.density[donor]);
      const targetDensity = this.world.owner[pixel] > 0 ? this.world.density[pixel] : 0;
    const ideal = density * 0.1;
    if (ideal <= 0) return 0;
    let maximum = Math.min(ideal, density - targetDensity);
      const domestic = this.world.owner[pixel] === countryId + 1;
      if (this.world.owner[pixel] > 0 && !domestic) maximum = Math.min(maximum, targetDensity);
    if (maximum <= 1e-9) return 0;
    return maximum / ideal * this.brushScaling(pixel).cost;
  }

  setNomadMode(mode: 'range' | 'density' | 'inactive'): void {
    this.nomadMode = mode;
  }

  endStroke(): void {
    for (const p of this.strokeTouched) this.strokeMask[p] = 0;
    this.strokeTouched = [];
    this.strokeClimateChanges = [];
    this.strokeChangedStart = this.changed.length;
  }

  /** Отменяет климатический мазок, если его конечная точка не лежит на суше. */
  cancelStroke(): void {
    let x0 = MAP_WIDTH, y0 = MAP_HEIGHT, x1 = -1, y1 = -1;
    let humidityChanged = false;
    let temperatureChanged = false;
    for (const change of this.strokeClimateChanges) {
      if (change.layer === 'temperature') {
        this.world.temperature[change.p] = change.value;
        temperatureChanged = true;
      } else {
        this.world.humidity[change.p] = change.value;
        humidityChanged = true;
      }
      this.card.ink += change.cost;
      this.cardMask[change.p] = change.wasInCard ? 1 : 0;
      const x = change.p % MAP_WIDTH, y = Math.floor(change.p / MAP_WIDTH);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
      this.markDirty(x - 1, y - 1, x + 1, y + 1);
    }
    if (x1 >= x0 && y1 >= y0) {
      const layers: ContourLayerName[] = [];
      if (humidityChanged) layers.push('humidity');
      if (temperatureChanged) layers.push('temperature');
      if (layers.length) this.world.contours.changed({ x0, y0, x1, y1 }, layers);
    }
    this.changed.length = this.strokeChangedStart;
    for (const p of this.strokeTouched) this.strokeMask[p] = 0;
    this.strokeTouched = [];
    this.strokeClimateChanges = [];
    this.message = 'Климатический мазок нужно начать и закончить на допустимой суше; изменения отменены.';
  }

  /** Очищает временные буферы после завершения карты. */
  dispose(): void {
    this.endStroke();
    for (const p of this.cardTouched) this.cardMask[p] = 0;
    this.cardTouched.length = 0;
  }

  private touch(p: number): void {
    if (!this.strokeMask[p]) {
      this.strokeMask[p] = 1;
      this.strokeTouched.push(p);
    }
    if (!this.cardMask[p]) {
      this.cardMask[p] = 1;
      this.cardTouched.push(p);
    }
  }

  private markDirty(x0: number, y0: number, x1: number, y1: number): void {
    if (!this.dirty) this.dirty = { x0, y0, x1, y1 };
    else {
      this.dirty.x0 = Math.min(this.dirty.x0, x0);
      this.dirty.y0 = Math.min(this.dirty.y0, y0);
      this.dirty.x1 = Math.max(this.dirty.x1, x1);
      this.dirty.y1 = Math.max(this.dirty.y1, y1);
    }
  }

  /** Городские правила задаются движком; ядро используется только для геометрии и расстояний. */
  private brushScaling(pixel: number): { cost: number; strength: number } {
    const cardType = this.card.type;
    if (cardType === 'expand' || cardType === 'colonization' || cardType === 'nomadExpand') {
      const x = pixel % MAP_WIDTH;
      const y = Math.floor(pixel / MAP_WIDTH);
      const blockColumns = Math.ceil(MAP_WIDTH / BRUSH_SCALING_CACHE_BLOCK);
      const blockIndex = Math.floor(y / BRUSH_SCALING_CACHE_BLOCK) * blockColumns +
        Math.floor(x / BRUSH_SCALING_CACHE_BLOCK);
      let block = this.brushScalingCache.get(blockIndex);
      if (!block) {
        block = {
          cost: new Float64Array(BRUSH_SCALING_CACHE_BLOCK * BRUSH_SCALING_CACHE_BLOCK),
          strength: new Float64Array(BRUSH_SCALING_CACHE_BLOCK * BRUSH_SCALING_CACHE_BLOCK),
        };
        this.brushScalingCache.set(blockIndex, block);
      }
      const offset = (y % BRUSH_SCALING_CACHE_BLOCK) * BRUSH_SCALING_CACHE_BLOCK +
        (x % BRUSH_SCALING_CACHE_BLOCK);
      const cachedCost = block.cost[offset];
      if (cachedCost > 0) return { cost: cachedCost, strength: block.strength[offset] };
      const scaling = this.computeBrushScaling(pixel);
      if (scaling.cost > 0 && Number.isFinite(scaling.cost) && Number.isFinite(scaling.strength)) {
        block.cost[offset] = scaling.cost;
        block.strength[offset] = scaling.strength;
      }
      return scaling;
    }
    return this.computeBrushScaling(pixel);
  }

  /** Влияние городов неизменно до завершения карты, даже когда границы страны растут. */
  private influenceAt(pixel: number): ReturnType<CityInfluenceIndex['at']> | undefined {
    if (!this.cityInfluence) return undefined;
    let influence = this.influenceCache.get(pixel);
    if (!influence) {
      influence = this.cityInfluence.at(pixel, this.card.type === 'colonization');
      this.influenceCache.set(pixel, influence);
    }
    return influence;
  }

  private refreshExpansionCoastRoutes(): void {
    const countryId = this.card.targetCountryId;
    const country = countryId === null ? null : this.world.countries[countryId] ?? null;
    if (this.card.type !== 'expand' || countryId === null || !country) return;
    const routes = expansionCoastRoutePoints(this.world, country);
    this.cityInfluence = new CityInfluenceIndex(this.world, countryId, false, undefined, routes);
    this.brushScalingCache.clear();
    this.distanceFactorCache.clear();
    this.lastStrategyScalingPixel = -1;
    this.lastStrategyScalingCost = 0;
  }

  private canColonizePixel(pixel: number): boolean {
    const countryId = this.card.targetCountryId;
    if (this.card.type !== 'colonization' || countryId === null || pixel < 0 || pixel >= MAP_PIXELS) return false;
    const domestic = this.world.owner[pixel] === countryId + 1;
    const internalTransfer = domestic && this.mode === 'repeat';
    if (!internalTransfer &&
      (this.colonizationMask?.[pixel] !== 1 || domestic)) return false;
    if (!this.world.land[pixel] || this.world.density[pixel] <= 0) return false;
    const donor = this.colonizationDonors?.peek() ?? -1;
    if (internalTransfer && (donor < 0 || this.world.density[pixel] >= this.world.density[donor])) return false;
    const influence = this.influenceAt(pixel);
    return !(influence && influence.foreignRankSum > 0 && influence.ownRankSum === 0);
  }

  /** Одинаковое сочетание происхождения и климата имеет одинаковый эффект на одного жителя. */
  private climateGain(
    mixId: number,
    temperature: number,
    humidity: number,
    drainage: number,
    nextTemperature: number,
    nextHumidity: number,
  ): number {
    const key = `${mixId}:${temperature}:${humidity}:${drainage}:${nextTemperature}:${nextHumidity}`;
    let gain = this.climateGainCache.get(key);
    if (gain === undefined) {
      const entry = this.world.humanOriginTable.entries[mixId];
      const mix = entry?.total === 100
        ? humanOriginMixFromTable(entry.ids, entry.shares) : defaultHumanOriginMix();
      gain = climateSuitability(mix, nextTemperature, nextHumidity, drainage) -
        climateSuitability(mix, temperature, humidity, drainage);
      this.climateGainCache.set(key, gain);
    }
    return gain;
  }

  private computeBrushScaling(pixel: number): { cost: number; strength: number } {
    const card = this.card;
    const influence = this.influenceAt(pixel);
    if (card.type === 'nomadExpand') {
      const foreignFactor = influence?.foreignRankSum ?? 0;
      return foreignFactor > 0
        ? { cost: foreignFactor, strength: 1 / foreignFactor }
        : { cost: 1, strength: 1 };
    }
    if (!influence ||
      (card.type !== 'expand' && card.type !== 'colonization')) return { cost: 1, strength: 1 };
    const distanceFactor = this.distanceFactorAt(pixel, influence);
    if (!Number.isFinite(distanceFactor)) return { cost: 0, strength: 0 };
    const ratio = influence.ownModifier / influence.foreignModifier;
    const lower = influence.foreignLargestRank > 0 ? 1 / influence.foreignLargestRank : 0;
    const upper = influence.ownLargestRank > 0 ? influence.ownLargestRank : 1;
    if (card.type === 'expand') {
      const modifier = Math.max(lower, Math.min(upper, ratio));
      const strength = modifier / distanceFactor;
      return { cost: strength > 0 ? 1 / strength : 0, strength };
    }
    if (influence.ownRankSum === 0 && influence.foreignRankSum > 0) {
      return { cost: 0, strength: 0 };
    }
    const strength = ratio / distanceFactor;
    const cityCost = influence.foreignRankSum > 0
      ? Math.min(1, 1 / Math.max(Number.EPSILON, ratio))
      : 1;
    return { cost: distanceFactor * cityCost, strength };
  }

  private distanceFactorAt(
    pixel: number,
    influence: ReturnType<CityInfluenceIndex['at']>,
  ): number {
    const cached = this.distanceFactorCache.get(pixel);
    if (cached !== undefined) return cached;
    const routeDistance = this.cityInfluence?.nearestRouteDistance(
      pixel,
      influence.nearestOwnDistance,
    ) ?? Infinity;
    const distance = Math.min(influence.nearestOwnDistance, routeDistance);
    const distanceScale = Math.sqrt(RANK_AREA_BY_NAME['Герцогство'] / Math.PI);
    const factor = Number.isFinite(distance) ? 1 + distance / distanceScale : Infinity;
    this.distanceFactorCache.set(pixel, factor);
    return factor;
  }

  /** Рисует линию мазков от (ax, ay) до (bx, by) и возвращает расход чернил. */
  line(ax: number, ay: number, bx: number, by: number, radius: number): number {
    const distance = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius * 0.5)));
    let spent = 0;
    for (let i = 1; i <= steps; i += 1) {
      spent += this.dab(ax + ((bx - ax) * i) / steps, ay + ((by - ay) * i) / steps, radius);
      if (this.card.ink <= 0) break;
    }
    return spent;
  }

  /** Применяет карту внутри круга и возвращает расход чернил. */
  dab(cx: number, cy: number, radius: number): number {
    const card = this.card;
    if (card.ink <= 0) {
      this.message = 'Чернила этой карты закончились.';
      return 0;
    }
    return this.paintContour(ContourArea.circle(cx, cy, Math.max(1, radius)));
  }

  private paintTerritory(pixels: number[], targetArea?: ContourArea, seed?: number): void {
    const world = this.world;
    const card = this.card;
    if (card.type === 'nomadExpand') {
      this.paintNomad(pixels);
      return;
    }
    const workingId = this.workingCountryId();
    if (workingId === null) return;
    const working = world.countries[workingId];
    const tag = workingId + 1;
    const sourceTag = card.type === 'split' ? (card.targetCountryId as number) + 1 : 0;
    const canTake = (p: number) => {
      if (card.type === 'colonization') return this.canColonizePixel(p);
      if (!world.land[p]) return false;
      if (card.type === 'create' && (this.influenceAt(p)?.foreignRankSum ?? 0) > 0) return false;
      if (card.type === 'split' && !this.splitBrush?.canPaint(p)) return false;
      if (card.type !== 'split' && world.owner[p] !== sourceTag) return false;
      if (card.type !== 'split' || (card.splitCultureId === undefined && card.splitReligionId === undefined)) return true;
      const cultureMatch = card.splitCultureId !== undefined && world.cultureTable.shareOf(world.culture[p], card.splitCultureId) > 0;
      const faithShare = card.splitReligionId === -1 ? 100 - world.religionTable.entries[world.religion[p]].total :
        card.splitReligionId !== undefined ? world.religionTable.shareOf(world.religion[p], card.splitReligionId) : 0;
      const faithMatch = faithShare > 0;
      return cultureMatch || faithMatch;
    };
    const first = card.type !== 'colonization' && working.pixels === 0;
    const originSource = working.pixels > 0 ? demography(world, working) : null;
    const foundingRaceId = card.type === 'create'
      ? world.cultures[card.newCultureId as number].foundingRaceId!
      : null;
    const foundingOriginMix = foundingRaceId === null ? null : { ids: [foundingRaceId], shares: [100] };
    const fallbackOriginId = ancestryProfileId(defaultHumanOriginMix());
    const growthWeights = card.type === 'create' && foundingOriginMix
      ? [{
        cultureId: card.newCultureId as number,
        religionId: null,
        originProfileId: ancestryProfileId(foundingOriginMix),
        weight: 1,
      }]
      : originSource
        ? expectedExpansionPopulationCohorts(
          originSource.populationGroups,
          originSource.religions,
          world.cultures,
        )
        : [{
          cultureId: working.cultureId,
          religionId: null,
          originProfileId: fallbackOriginId,
          weight: 1,
        }];
    const cohortComposition = internPopulationCohorts(world, growthWeights);
    const growthComposition = {
      cultureMix: cohortComposition.cultureMixId,
      religionMix: cohortComposition.religionMixId,
      humanOriginMix: cohortComposition.originMixId,
      populationCohorts: cohortComposition.groups,
    };
    const climateGrowthCache = new Map<string, {
      growthFactor: number;
      composition: typeof growthComposition;
    }>();
    const growthAt = (pixel: number) => {
      const temperature = world.temperature[pixel];
      const humidity = world.humidity[pixel];
      const drainage = world.drainage[pixel];
      const key = `${temperature}:${humidity}:${drainage}`;
      let result = climateGrowthCache.get(key);
      if (!result) {
        const adjusted = climateAdjustedPopulationCohorts(
          growthWeights,
          temperature,
          humidity,
          drainage,
        );
        const composition = internPopulationCohorts(world, adjusted.groups);
        result = {
          growthFactor: adjusted.growthFactor,
          composition: {
            cultureMix: composition.cultureMixId,
            religionMix: composition.religionMixId,
            humanOriginMix: composition.originMixId,
            populationCohorts: composition.groups,
          },
        };
        climateGrowthCache.set(key, result);
      }
      return result;
    };

    // Дополнительное население на уже принадлежащей государству земле — кисть плотности.
    if (card.type !== 'split' && card.type !== 'colonization' && this.mode === 'repeat') {
      for (const p of pixels) {
        if (card.ink <= 0) break;
        if (world.owner[p] !== tag || this.strokeMask[p]) continue;
        const { cost, strength } = this.brushScaling(p);
        const climate = growthAt(p);
        applyDensityGrowth(
          world,
          p,
          strength * climate.growthFactor,
          this.cityInfluence?.citiesAt(p),
          climate.composition,
        );
        card.ink = Math.max(0, card.ink - cost);
        this.touch(p);
      }
    }

    // Рост возможен только от существующей территории: по суше или от побережья моря, которого уже касается государство.
    if (!targetArea) for (const p of pixels) this.dabMask[p] = 1;
    const queue: number[] = [];
    const enqueue = (p: number) => {
      if (targetArea) {
        if (!targetArea.contains(p) || this.dabMask[p] !== 0 || !canTake(p)) return;
        this.dabMask[p] = 2;
        queue.push(p);
      } else if (this.dabMask[p] === 1) {
        this.dabMask[p] = 2;
        queue.push(p);
      }
    };
    if (targetArea) {
      const [x0, y0, x1, y1] = working.box;
      const owned = world.contours.layer('owner').select(
        (value) => value === tag,
        { x0, y0, x1, y1 },
      );
      const neighbours = owned.neighbourhood8();
      const bounds = neighbours.bounds;
      const freeLand = world.contours.layer('owner').select(
        (value) => value === 0,
        bounds,
      ).intersect(world.contours.layer('land').select(
        (value) => value === 1,
        bounds,
        'land',
      ));
      const starts = new Set<number>();
      neighbours.intersect(freeLand).intersect(targetArea).forEachPixel((pixel) => {
        if (canTake(pixel)) starts.add(pixel);
      });
      for (const sea of this.seas) {
        for (const pixel of world.water.coastsOf[sea] ?? []) {
          if (targetArea.contains(pixel) && canTake(pixel)) starts.add(pixel);
        }
      }
      const orderedStarts = [...starts].sort((a, b) => a - b);
      if (seed !== undefined && starts.has(seed)) enqueue(seed);
      for (const pixel of orderedStarts) if (pixel !== seed) enqueue(pixel);
    } else {
      for (const p of pixels) {
        if (!canTake(p)) continue;
        let linked = first;
        if (card.type === 'colonization') {
          linked = this.colonizationAnchors?.[p] === 1;
          if (world.owner[p] === tag && this.mode === 'repeat') linked = true;
          if (!linked) {
            forEachNeighbour(p, (n) => {
              if (this.colonizationConnected?.[n]) linked = true;
            });
          }
        } else if (!linked) {
          forEachNeighbour(p, (n) => {
            if (world.owner[n] === tag) linked = true;
            else if (card.type !== 'split' && this.seas.size > 0 && world.water.bodyOf[n] >= 0 && this.seas.has(world.water.bodyOf[n])) linked = true;
          });
        }
        if (linked) {
          enqueue(p);
          if (first) break;
        }
      }
    }
    if (queue.length === 0 && !first) {
      this.message =
          card.type === 'split'
          ? 'Раскол рисуется внутри исходной страны, продолжая уже выделенную часть.'
            : card.type === 'colonization'
              ? 'Начните колонию у побережья или реки либо продолжайте от уже связанной с ними территории.'
          : 'Продолжайте от своей территории — по суше или через то же море.';
    }
    for (let head = 0; head < queue.length; head += 1) {
      if (card.ink <= 0) break;
      const p = queue[head];
      if (!canTake(p)) continue;
      if (card.type === 'split' && world.countries[card.targetCountryId as number].pixels <= 1) break;
      if (card.type === 'colonization') {
        const donor = this.colonizationDonors?.peek() ?? -1;
        if (donor < 0) {
          this.message = 'У страны больше нет населения для переселения.';
          break;
        }
        const { cost } = this.brushScaling(p);
        const city = world.cityAt(p);
        const previousCityCountry = city?.countryId ?? null;
        const transfer = transferColonizationPopulation(
          world, donor, p, card.ink / cost, world.owner[p] === tag,
        );
        if (!transfer) {
          this.message = 'На этом участке нельзя переселить население без превышения плотности донора.';
          break;
        }
        this.colonizationDonors?.refreshTop(donor);
        world.setOwner(p, tag);
        if (city && previousCityCountry !== city.countryId) {
          const targetCountry = world.countries[this.card.targetCountryId ?? -1];
          if (!targetCountry) throw new Error('The colonization target country no longer exists.');
          const updatedPlan = colonizationPlan(world, targetCountry);
          this.colonizationMask = updatedPlan.targets;
          this.colonizationAnchors = updatedPlan.anchors;
          this.colonizationBounds = updatedPlan.targetBounds;
          this.colonizationConnected = updatedPlan.connectedTerritory.slice();
          this.cityInfluence = new CityInfluenceIndex(
            world,
            this.card.targetCountryId ?? -1,
            true,
            updatedPlan.anchors,
            updatedPlan.routePoints,
            updatedPlan.cityInfluenceAreas,
          );
          this.influenceCache.clear();
          this.distanceFactorCache.clear();
          this.brushScalingCache.clear();
          this.colonizationTargetArea = null;
        }
        this.colonizationDonors?.add(p);
        if (this.colonizationConnected) this.colonizationConnected[p] = 1;
        this.colonistsMoved += densityToResidents(transfer.amount);
        card.ink = Math.max(0, card.ink - transfer.ink * cost);
        this.touch(p);
        this.changed.push(p);
        this.markDirtyPixel(donor);
        forEachNeighbour(p, (n) => {
          if (this.dabMask[n] && canTake(n)) enqueue(n);
        });
        continue;
      }
      let newlyOwnedCoast = false;
      if (card.type === 'split') {
        if (!this.splitBrush?.paint(p)) continue;
      } else {
        const wasOwned = world.owner[p] === tag;
        world.setOwner(p, tag);
        newlyOwnedCoast = card.type === 'expand' && !wasOwned && world.isCoastal(p);
      }
      if (card.type !== 'split') {
        const { cost, strength } = this.brushScaling(p);
        const climate = growthAt(p);
        const densityGrowth = working.density * strength * climate.growthFactor;
        if (card.type === 'expand') {
          applyDensityGrowth(world, p, densityGrowth, this.cityInfluence?.citiesAt(p), climate.composition);
        } else {
          world.density[p] = densityGrowth;
          setPopulationCohortsAtPixel(world, p, climate.composition.populationCohorts.map((group) => ({
            cultureId: group.cultureId,
            religionId: group.religionId,
            originProfileId: group.originProfileId,
            weight: group.share,
          })));
        }
        if (card.type === 'create' && working.pixels === 1 && foundingOriginMix) {
          working.ruler.humanOrigin = foundingOriginMix;
        }
        card.ink = Math.max(0, card.ink - cost);
        if (newlyOwnedCoast) this.refreshExpansionCoastRoutes();
      } else {
        card.ink -= 1;
      }
      this.touch(p);
      this.changed.push(p);
      if (card.type !== 'split' && world.water.coastsOf.length > 0) world.seasOfPixel(p, this.seas);
      forEachNeighbour(p, (n) => {
        if (targetArea) enqueue(n);
        else if (this.dabMask[n] && canTake(n)) enqueue(n);
      });
    }
    if (targetArea) for (const p of queue) this.dabMask[p] = 0;
    else for (const p of pixels) this.dabMask[p] = 0;
    if (card.type === 'split' && world.countries[card.targetCountryId as number].pixels <= 1) {
      this.message = 'Исходная страна должна сохранить хотя бы часть земель.';
    }
  }

  private paintNomad(pixels: number[]): void {
    const world = this.world;
    const nomad = this.card.targetCountryId === null
      ? null
      : world.countries[this.card.targetCountryId];
    if (!nomad || nomad.type !== 'nomadic') return;
    if (this.nomadMode === 'inactive') {
      this.message = 'Для расширения кочевья выберите карту «Страны» или «Население».';
      return;
    }
    let changed = false;
    let rangeExpanded = false;
    const cells = nomad.cells ?? (nomad.cells = []);
    const range = nomad.range ?? (nomad.range = []);
    const cultureMix = this.nomadCultureMix(nomad);
    const religionMix = this.nomadReligionMix(nomad);
    const humanOriginMix = this.nomadHumanOriginMix(nomad);
    const population = cells.reduce((sum, cell) => sum + densityToResidents(cell.density), 0);
    const baseDensity = Number.isFinite(nomad.density)
      ? nomad.density
      : population / (Math.max(1, range.length) * MAP_POINT_AREA_KM2);
    const populationWeights = cells.flatMap((cell) => {
      const residents = densityToResidents(cell.density);
      if (!(residents > 0)) return [];
      if (cell.populationGroups?.length) {
        return cell.populationGroups.map((group) => ({
          cultureId: group.cultureId,
          religionId: group.religionId,
          originProfileId: group.originProfileId,
          weight: residents * group.share / 100,
        }));
      }
      return populationCohortsFromMixes(
        world,
        cell.cultureMix,
        cell.religionMix,
        cell.humanOriginMix,
        residents,
      );
    });
    const climateCache = new Map<string, {
      growthFactor: number;
      groups: ReturnType<typeof climateAdjustedPopulationCohorts>['groups'];
    }>();
    const growthAt = (pixel: number) => {
      const key = `${world.temperature[pixel]}:${world.humidity[pixel]}:${world.drainage[pixel]}`;
      let growth = climateCache.get(key);
      if (!growth) {
        const adjusted = climateAdjustedPopulationCohorts(
          populationWeights,
          world.temperature[pixel],
          world.humidity[pixel],
          world.drainage[pixel],
        );
        growth = { growthFactor: adjusted.growthFactor, groups: adjusted.groups };
        climateCache.set(key, growth);
      }
      return growth;
    };
    const addNomadPopulation = (
      cell: NomadCell,
      density: number,
      groups: ReturnType<typeof climateAdjustedPopulationCohorts>['groups'],
    ) => {
      if (!(density > 0)) return;
      const oldResidents = densityToResidents(cell.density);
      const addedResidents = densityToResidents(density);
      const oldGroups = cell.populationGroups?.length
        ? cell.populationGroups.map((group) => ({
          cultureId: group.cultureId,
          religionId: group.religionId,
          originProfileId: group.originProfileId,
          weight: oldResidents * group.share / 100,
        }))
        : populationCohortsFromMixes(
          world,
          cell.cultureMix,
          cell.religionMix,
          cell.humanOriginMix,
          oldResidents,
        );
      const addedWeight = groups.reduce((sum, group) => sum + group.weight, 0);
      const addedGroups = addedWeight > 0
        ? groups.map((group) => ({ ...group, weight: addedResidents * group.weight / addedWeight }))
        : [];
      const composition = internPopulationCohorts(world, [...oldGroups, ...addedGroups]);
      cell.density += density;
      if (composition.groups.length) {
        cell.populationGroups = composition.groups;
        cell.cultureMix = composition.cultureMixId;
        cell.religionMix = composition.religionMixId;
        cell.humanOriginMix = composition.originMixId;
      }
    };
    if (this.nomadMode === 'range') {
      const queue: number[] = [];
      const queued = new Set<number>();
      const enqueue = (pixel: number) => {
        if (!queued.has(pixel)) { queued.add(pixel); queue.push(pixel); }
      };
      for (const pixel of pixels) this.dabMask[pixel] = 1;
      for (const pixel of pixels) {
        if (!world.land[pixel] || this.nomadRange.has(pixel) || this.strokeMask[pixel] ||
          (this.mode === 'respect' && this.cardMask[pixel])) continue;
        let connected = false;
        forEachNeighbour(pixel, (neighbor) => { if (this.nomadRange.has(neighbor)) connected = true; });
        if (connected) enqueue(pixel);
      }
      for (let head = 0; head < queue.length && this.card.ink > 0; head += 1) {
        const pixel = queue[head];
        if (!world.land[pixel] || this.nomadRange.has(pixel) || this.strokeMask[pixel] ||
          (this.mode === 'respect' && this.cardMask[pixel])) continue;
        const { cost, strength } = this.brushScaling(pixel);
        const climate = growthAt(pixel);
        if (!(climate.growthFactor > 0)) continue;
        range.push(pixel);
        this.nomadRange.add(pixel);
        rangeExpanded = true;
        let cell = this.nomadCells.get(pixel);
        if (!cell) {
          cell = { pixel, density: 0, cultureMix, religionMix, humanOriginMix };
          this.nomadCells.set(pixel, cell);
          cells.push(cell);
        }
        addNomadPopulation(cell, baseDensity * strength * climate.growthFactor, climate.groups);
        this.card.ink = Math.max(0, this.card.ink - cost);
        this.touch(pixel);
        this.changed.push(pixel);
        this.markDirtyPixel(pixel);
        changed = true;
        forEachNeighbour(pixel, (neighbor) => {
          if (this.dabMask[neighbor] && !this.nomadRange.has(neighbor)) enqueue(neighbor);
        });
      }
      for (const pixel of pixels) this.dabMask[pixel] = 0;
    } else {
      for (const pixel of pixels) {
        if (this.card.ink <= 0) break;
        if (!world.land[pixel] || !this.nomadRange.has(pixel) || this.strokeMask[pixel] ||
          (this.mode === 'respect' && this.cardMask[pixel])) continue;
        const { cost, strength } = this.brushScaling(pixel);
        if (!this.nomadRange.has(pixel)) continue;
        const climate = growthAt(pixel);
        if (!(climate.growthFactor > 0)) continue;
        let cell = this.nomadCells.get(pixel);
        if (!cell) {
          cell = {
            pixel,
            density: 0,
            cultureMix,
            religionMix,
            humanOriginMix,
          };
          this.nomadCells.set(pixel, cell);
          cells.push(cell);
        }
        addNomadPopulation(cell, strength * climate.growthFactor, climate.groups);
        this.card.ink = Math.max(0, this.card.ink - cost);
        this.touch(pixel);
        this.changed.push(pixel);
        this.markDirtyPixel(pixel);
        changed = true;
      }
    }
    if (changed) {
      world.version += 1;
      if (rangeExpanded) world.markNomadicRangeExpanded();
      this.message = this.nomadMode === 'range' ? 'Ареал кочевья расширен.' : 'Плотность кочевого населения увеличена.';
    }
  }

  private nomadCultureMix(nomad: Country): number {
    const totals = new Map<number, number>();
    let population = 0;
    for (const cell of nomad.cells ?? []) {
      const entry = this.world.cultureTable.entries[cell.cultureMix];
      for (let index = 0; index < entry.ids.length; index += 1) {
      totals.set(entry.ids[index], (totals.get(entry.ids[index]) ?? 0) +
        densityToResidents(cell.density) * entry.shares[index] / 100);
      }
      population += densityToResidents(cell.density);
    }
    if (population <= 0) return this.world.cultureTable.single(nomad.cultureId, 100);
    return this.world.cultureTable.intern(
      new Map([...totals].map(([id, amount]) => [id, amount * 100 / population])),
    );
  }

  private nomadReligionMix(nomad: Country): number {
    const totals = new Map<number, number>();
    let population = 0;
    for (const cell of nomad.cells ?? []) {
      const entry = this.world.religionTable.entries[cell.religionMix];
      for (let index = 0; index < entry.ids.length; index += 1) {
      totals.set(entry.ids[index], (totals.get(entry.ids[index]) ?? 0) +
        densityToResidents(cell.density) * entry.shares[index] / 100);
      }
      population += densityToResidents(cell.density);
    }
    if (population <= 0) {
      return nomad.religionId === null ? 0 : this.world.religionTable.single(nomad.religionId, 100);
    }
    return this.world.religionTable.intern(
      new Map([...totals].map(([id, amount]) => [id, amount * 100 / population])),
    );
  }

  private nomadHumanOriginMix(nomad: Country): number {
    const totals = new Map<number, number>();
    let population = 0;
    for (const cell of nomad.cells ?? []) {
      const residents = densityToResidents(cell.density);
      const entry = this.world.humanOriginTable.entries[cell.humanOriginMix];
      if (!entry?.total) continue;
      for (let index = 0; index < entry.ids.length; index += 1) {
        const id = entry.ids[index];
        totals.set(id, (totals.get(id) ?? 0) + residents * entry.shares[index] / entry.total);
      }
      population += residents;
    }
    if (population <= 0) return this.world.humanOriginTable.single(0, 100);
    return this.world.humanOriginTable.intern(
      new Map([...totals].map(([id, amount]) => [id, amount * 100 / population])),
    );
  }

  private markDirtyPixel(p: number): void {
    const x = p % MAP_WIDTH, y = Math.floor(p / MAP_WIDTH);
    this.world.contours.changed({ x0: x, y0: y, x1: x, y1: y },
      ['density', 'culture', 'religion', 'humanOrigins']);
  }

  private paintLayer(pixels: Iterable<number>): void {
    const world = this.world;
    const card = this.card;
    const targetTag = card.targetCountryId !== null ? card.targetCountryId + 1 : -1;
    let outside = 0;
    for (const p of pixels) {
      if (card.ink <= 0) break;
      if (this.strokeMask[p] || (this.mode === 'respect' && this.cardMask[p])) continue;
      const onLand = world.land[p] === 1;
      const climateInkCost = isWind(card.type) && !onLand ? 0.5 :
        card.type === 'drought' || card.type === 'rain' || card.type === 'desertification' ||
        card.type === 'swamping' || isTemperatureCard(card.type) ? 1 : 0;
      if (climateInkCost > card.ink + 1e-9) continue;
      if (climateBrushAffectsSea(card.type)) {
        if (!this.climatePixelInScope(p)) {
          if (onLand && targetTag > 0 && world.owner[p] !== targetTag) outside += 1;
          continue;
        }
      } else if ((card.type === 'desertification' || card.type === 'swamping') && !onLand) {
        continue;
      } else if (targetTag > 0 && world.owner[p] !== targetTag) {
        outside += 1;
        continue;
      }
      if (card.type === 'drought' || card.type === 'rain') {
        const value = world.humidity[p];
        const next = card.type === 'rain' ? Math.min(100, value + CLIMATE_DELTA) : Math.max(0, value - CLIMATE_DELTA);
        if (next === value) continue;
        this.strokeClimateChanges.push({
          p,
          layer: 'humidity',
          value,
          cost: climateInkCost,
          wasInCard: this.cardMask[p] === 1,
        });
        world.humidity[p] = next;
      } else if (card.type === 'desertification' || card.type === 'swamping') {
        const value = world.drainage[p];
        const next = card.type === 'desertification' ? Math.min(100, value + CLIMATE_DELTA) : Math.max(0, value - CLIMATE_DELTA);
        if (next === value) continue;
        world.drainage[p] = next;
      } else if (isTemperatureCard(card.type)) {
        const value = world.temperature[p];
        const next = temperatureAfterCard(card, value);
        if (next === value) continue;
        const cost = isWind(card.type) && !onLand ? 0.5 : 1;
        this.strokeClimateChanges.push({
          p,
          layer: 'temperature',
          value,
          cost,
          wasInCard: this.cardMask[p] === 1,
        });
        world.temperature[p] = next;
        card.ink = Math.max(0, card.ink - cost);
        this.touch(p);
        this.changed.push(p);
        continue;
      } else if (card.type === 'faith') {
        if (world.owner[p] === 0) continue;
        const next = world.religionTable.convert(world.religion[p], card.newReligionId as number, FAITH_CONVERSION, null);
        if (next === world.religion[p]) continue;
        convertPopulationCohortReligion(world, p, card.newReligionId as number, FAITH_CONVERSION);
      } else {
        if (world.owner[p] === 0) continue;
        const next = world.cultureTable.convert(world.culture[p], card.newCultureId as number, CULTURE_CONVERSION, card.sourceCultureId);
        if (next === world.culture[p]) continue;
        convertPopulationCohortCulture(
          world,
          p,
          card.newCultureId as number,
          CULTURE_CONVERSION,
          card.sourceCultureId,
        );
      }
      card.ink = Math.max(0, card.ink - 1);
      this.touch(p);
      this.changed.push(p);
    }
    if (outside > 0 && this.changed.length === 0) this.message = 'Эта карта действует только на территории выбранной страны.';
  }
}
