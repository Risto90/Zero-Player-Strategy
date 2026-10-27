import { CLIMATE_DELTA, CULTURE_CONVERSION, FAITH_CONVERSION, MAP_HEIGHT, MAP_PIXELS, MAP_WIDTH, RANKS } from './config';
import { forEachNeighbour } from './geography';
import { type Country, type GeographyObjectKind, type NomadCell, type World } from './world';
import type { GovernmentId, GovernmentModifierId, Person } from './government';
import { GOVERNMENTS } from './government';
import { ColonizationDonorHeap, colonizationPlan, transferColonizationPopulation } from './colonization';
import { applyDensityGrowth, changeCityPopulation, CityInfluenceIndex, cityInfluenceRadius, ensureCityPopulationGroups, populationAtPixel } from './settlements';
import { demography } from './demography';
import { ContourArea, type ContourBounds, type ContourLayerName } from './contours';
import {
  climateSuitability,
  combineHumanOriginTableMixes,
  defaultHumanOriginMix,
  expectedOriginsForPopulation,
  humanOriginIndex,
  humanOriginMixFromTable,
  humanOriginMixToTable,
  originForHabitat,
  randomHumanOriginId,
} from './human';

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
const BRUSH_SCALING_CACHE_BLOCK = 64;

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
  private strokeClimateChanges: { p: number; value: number; cost: number; wasInCard: boolean }[] = [];
  private strokeChangedStart = 0;
  private readonly religionForNewLand: number;
  readonly colonizationMask: Uint8Array | null;
  readonly colonizationAnchors: Uint8Array | null;
  readonly colonizationBounds: ContourBounds | null;
  private readonly colonizationConnected: Uint8Array | null;
  private readonly colonizationDonors: ColonizationDonorHeap | null;
  private readonly cityInfluence: CityInfluenceIndex | null;
  private readonly splitBrush: PartitionBrush | null;
  private readonly brushScalingCache = new Map<number, { cost: Float64Array; strength: Float64Array }>();
  private lastStrategyScalingPixel = -1;
  private lastStrategyScalingCost = 0;
  private originScoreMix: ReturnType<typeof defaultHumanOriginMix> | null = null;
  private forbiddenCreationArea: ContourArea | null = null;
  private colonizationTargetArea: ContourArea | null = null;
  private readonly influenceCache = new Map<number, ReturnType<CityInfluenceIndex['at']>>();
  private readonly climateGainCache = new Map<number, number>();
  private nomadMode: 'range' | 'density' | 'inactive' = 'range';
  private readonly nomadRange = new Set<number>();
  private readonly nomadCells = new Map<number, NomadCell>();
  readonly extraDirty: Rect[] = [];
  private readonly dirtyTileKeys = new Set<number>();
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
    this.cityInfluence = influenceCountryId !== null
      ? new CityInfluenceIndex(world, influenceCountryId, card.type === 'colonization', colonization?.anchors)
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
      : isWind(card.type) && card.targetCountryId !== null
        ? world.countries[card.targetCountryId]
        : null;
    if (country && isWind(card.type)) world.forEachCountryPixel(country, (p) => world.seasOfPixel(p, this.seas));
    this.religionForNewLand =
      country && country.religionId !== null ? world.religionTable.single(country.religionId, 60) : 0;
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
          : (nomad.cells ?? []).reduce((sum, cell) => sum + cell.population, 0) /
            Math.max(1, nomad.range?.length ?? 0);
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
        return valid && donor >= 0 ? world.density[donor] * 0.1 : 0;
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
      if (card.type === 'warmWind' || card.type === 'coldWind') {
        if (onLand && world.owner[pixel] !== targetTag) return 0;
        if (!onLand && !this.seas.has(world.water.bodyOf[pixel])) return 0;
      } else if (card.targetCountryId !== null && world.owner[pixel] !== targetTag) return 0;
      const city = world.cityAt(pixel);
      const groups = city ? ensureCityPopulationGroups(world, city) : null;
      const population = city
        ? groups!.reduce((sum, group) => sum + group.population, 0)
        : populationAtPixel(world, pixel);
      if (population <= 0) return 0;
      const temperature = world.temperature[pixel];
      const humidity = world.humidity[pixel];
      const nextTemperature = card.type === 'warmCurrent' || card.type === 'warmWind'
        ? Math.min(100, temperature + CLIMATE_DELTA)
        : card.type === 'coldCurrent' || card.type === 'coldWind'
          ? Math.max(0, temperature - CLIMATE_DELTA)
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
        return population * this.climateGain(mixedOrigins, temperature, humidity, nextTemperature, nextHumidity);
      }
      return population * this.climateGain(world.humanOrigins[pixel], temperature, humidity, nextTemperature, nextHumidity);
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

    // Дренаж не имеет заданного прямого влияния на население или климатический комфорт.
    // Не следует придумывать ему эффект: оставить показатель неизменным лучше, чем менять произвольно.
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
      if (card.type === 'warmWind' || card.type === 'coldWind') {
        if (onLand && world.owner[pixel] !== targetTag) return 0;
        if (!onLand && !this.seas.has(world.water.bodyOf[pixel])) return 0;
      } else if (card.type === 'warmCurrent' || card.type === 'coldCurrent') {
        // Течения влияют на сушу и воду по всему миру.
        if (!onLand && world.water.bodyOf[pixel] < 0) return 0;
      } else if (!onLand || (card.targetCountryId !== null && world.owner[pixel] !== targetTag)) {
        return 0;
      }
      const temperatureCard = card.type === 'warmCurrent' || card.type === 'coldCurrent' ||
        card.type === 'warmWind' || card.type === 'coldWind';
      const value = temperatureCard ? world.temperature[pixel] : card.type === 'rain' || card.type === 'drought'
        ? world.humidity[pixel] : world.drainage[pixel];
      const canIncrease = card.type === 'rain' || card.type === 'desertification' ||
        card.type === 'warmCurrent' || card.type === 'warmWind';
      const canChange = canIncrease ? value < 100 : value > 0;
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
          const cityPixels = ContourArea.pixels(world.cities.map((city) => city.pixel));
          this.colonizationTargetArea = this.colonizationTargetArea.subtract(
            cityPixels.union(influence.foreign.subtract(influence.own)),
          );
        } else if (this.colonizationMask) {
          this.colonizationTargetArea = ContourArea.fromMask(
            this.colonizationMask,
            this.colonizationBounds ?? { x0: 0, y0: 0, x1: -1, y1: -1 },
            (_value, pixel) => this.canColonizePixel(pixel),
          );
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
      const start = paint.intersect(anchors.union(connected.border()));
      return { paint, start, stop: paint };
    }
    if (isWind(type)) {
      const own = world.contours.layer('owner').select((value) => value === (this.card.targetCountryId ?? -1) + 1, bounds);
      const water = world.contours.layer('water').select((value) => this.seas.has(value), bounds);
      return { paint: own.intersect(land).union(water), start: own.intersect(land), stop: own.intersect(land) };
    }
    if (isCurrent(type)) {
      const water = world.contours.layer('water').select((value) => value >= 0, bounds);
      return { paint: land.union(water), start: land.union(water), stop: land.union(water) };
    }
    const paint = this.strategyCandidateArea(bounds);
    if (type !== 'create' && type !== 'expand') return { paint, start: paint, stop: paint };
    const country = world.countries[this.workingCountryId() ?? -1];
    if (!country || country.pixels === 0) return { paint, start: paint, stop: paint };
    const owned = world.contours.layer('owner').select((value) => value === country.id + 1,
      { x0: 0, y0: 0, x1: MAP_WIDTH - 1, y1: MAP_HEIGHT - 1 }, `country:${country.id}`);
    let frontier = owned.border();
    for (const sea of this.seas) frontier = frontier.union(ContourArea.pixels(world.water.coastsOf[sea]));
    const start = paint.intersect(frontier);
    return { paint, start, stop: paint };
  }

  strategyClimateFit(temperature: number, humidity: number): number {
    if (!this.originScoreMix) {
      const country = this.world.countries[this.workingCountryId() ?? -1];
      const foundingOrigin = this.card.type === 'create'
        ? this.world.cultures[this.card.newCultureId ?? -1]?.foundingRaceId : null;
      this.originScoreMix = foundingOrigin
        ? { ids: [foundingOrigin], shares: [100] }
        : country ? demography(this.world, country).humanOrigin : defaultHumanOriginMix();
    }
    return climateSuitability(this.originScoreMix, temperature, humidity);
  }

  strategySeaBodies(): ReadonlySet<number> {
    return this.seas;
  }

  /**
   * Общий инструмент заполнения контура: те же эффекты, связность и расход чернил, что у мазка.
   * Контур должен оставаться геометрическим объектом до общего шага нанесения кисти.
   */
  paintContour(area: ContourArea, seed?: number): number {
    return this.paintContours([area], seed);
  }

  /** Несколько областей одного события обрабатываются за одну синхронизацию и инвалидацию слоёв. */
  paintContours(areas: readonly ContourArea[], seed?: number): number {
    this.world.contours.synchronize();
    if (!areas.some((area) => area.size > 0) || this.card.ink <= 0) return 0;
    const before = this.card.ink;
    const touchedStart = this.strokeTouched.length;
    if (['create', 'expand', 'colonization', 'split', 'nomadExpand'].includes(this.card.type)) {
      const pixels: number[] = [];
      for (const area of areas) {
        area.forEachPixel((pixel) => {
          if (this.world.land[pixel] || (isCurrent(this.card.type) && this.world.water.bodyOf[pixel] >= 0) ||
            (isWind(this.card.type) && this.seas.has(this.world.water.bodyOf[pixel]))) pixels.push(pixel);
        });
      }
      if (seed !== undefined) {
        const index = pixels.indexOf(seed);
        if (index > 0) { pixels.splice(index, 1); pixels.unshift(seed); }
      }
      if (!pixels.length) return 0;
      this.paintTerritory(pixels);
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
        if (onLand || (isCurrent(this.card.type) && this.world.water.bodyOf[pixel] >= 0) ||
          (isWind(this.card.type) && this.seas.has(this.world.water.bodyOf[pixel]))) {
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
    if (this.world.owner[pixel] > 0) maximum = Math.min(maximum, targetDensity);
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

  clearExtraDirtyTiles(): void {
    this.dirtyTileKeys.clear();
  }

  /** Отменяет мазок ветра, если палец отпущен над водой вместо территории государства. */
  cancelStroke(): void {
    for (const change of this.strokeClimateChanges) {
      this.world.temperature[change.p] = change.value;
      this.card.ink += change.cost;
      this.cardMask[change.p] = change.wasInCard ? 1 : 0;
      const x = change.p % MAP_WIDTH, y = Math.floor(change.p / MAP_WIDTH);
      this.markDirty(x - 1, y - 1, x + 1, y + 1);
    }
    this.changed.length = this.strokeChangedStart;
    for (const p of this.strokeTouched) this.strokeMask[p] = 0;
    this.strokeTouched = [];
    this.strokeClimateChanges = [];
    this.message = 'Ветер можно закончить только на суше своей страны. Проведите мазок от своего берега к своему берегу.';
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

  private distanceAlongLine(from: number, to: number, waterDivisor: number): number {
    const fromX = from % MAP_WIDTH, fromY = Math.floor(from / MAP_WIDTH);
    const toX = to % MAP_WIDTH, toY = Math.floor(to / MAP_WIDTH);
    const distance = Math.hypot(toX - fromX, toY - fromY);
    const steps = Math.max(1, Math.ceil(distance));
    const step = distance / steps;
    let result = 0;
    for (let i = 1; i <= steps; i += 1) {
      const x = Math.round(fromX + (toX - fromX) * i / steps);
      const y = Math.round(fromY + (toY - fromY) * i / steps);
      const p = y * MAP_WIDTH + x;
      result += step * (this.world.land[p] ? 1 : 1 / waterDivisor);
    }
    return result;
  }

  /** Сферы городов меняют расход чернил и силу населения кисти, не меняя её базовую стоимость. */
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

  private canColonizePixel(pixel: number): boolean {
    const countryId = this.card.targetCountryId;
    if (this.card.type !== 'colonization' || countryId === null || pixel < 0 || pixel >= MAP_PIXELS ||
      this.colonizationMask?.[pixel] !== 1 || this.world.owner[pixel] === countryId + 1 ||
      this.world.cityAt(pixel)) return false;
    const influence = this.influenceAt(pixel);
    return !(influence && influence.foreignRankSum > 0 && influence.ownRankSum === 0);
  }

  /** Одинаковое сочетание происхождения и климата имеет одинаковый эффект на одного жителя. */
  private climateGain(mixId: number, temperature: number, humidity: number,
    nextTemperature: number, nextHumidity: number): number {
    const key = mixId * 10201 + temperature * 101 + humidity;
    let gain = this.climateGainCache.get(key);
    if (gain === undefined) {
      const entry = this.world.humanOriginTable.entries[mixId];
      const mix = entry?.total === 100
        ? humanOriginMixFromTable(entry.ids, entry.shares) : defaultHumanOriginMix();
      gain = climateSuitability(mix, nextTemperature, nextHumidity) - climateSuitability(mix, temperature, humidity);
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
    const duchyRadius = Math.sqrt(RANKS[2].ink / Math.PI);
    if (card.type === 'expand') {
      const cityPixel = influence.nearestOwnCityPixel;
      let distance = influence.nearestOwnDistance;
      if (cityPixel !== null) {
        distance = Math.max(0, this.distanceAlongLine(cityPixel, pixel, 3) - influence.nearestOwnRadius);
      }
      let penalty = distance / duchyRadius;
      if (influence.ownRankSum === 0 && influence.foreignRankSum > 0) penalty *= influence.foreignRankSum;
      const distanceFactor = 1 + penalty;
      const multipleCityFactor = Math.max(1, influence.ownRankSum - influence.ownLargestRank);
      const strength = multipleCityFactor / distanceFactor;
      return { cost: 1 / strength, strength };
    }
    const anchor = influence.nearestOwnAnchorPixel;
    const cityPixel = influence.nearestOwnCityPixel;
    const distance = anchor !== null
      ? this.distanceAlongLine(anchor, pixel, 5)
      : cityPixel !== null
        ? Math.max(0, this.distanceAlongLine(cityPixel, pixel, 5) - influence.nearestOwnRadius)
        : influence.nearestOwnAnchorDistance;
    let distanceFactor = 1 + distance / duchyRadius;
    if (influence.ownRankSum === 0 && influence.foreignRankSum > 0) {
      distanceFactor = 1 + (distance / duchyRadius) * influence.foreignRankSum;
    }
    const ownCityBonus = 1 + influence.ownRankSum;
    const foreignCityPenalty = 1 + influence.foreignRankSum;
    const cost = distanceFactor * foreignCityPenalty / ownCityBonus;
    return { cost: Math.max(0.05, cost), strength: 1 / Math.max(0.05, cost) };
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

  private paintTerritory(pixels: number[]): void {
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

    // Дополнительное население на уже принадлежащей государству земле — кисть плотности.
    if (card.type !== 'split' && card.type !== 'colonization' && this.mode === 'repeat') {
      for (const p of pixels) {
        if (card.ink <= 0) break;
        if (world.owner[p] !== tag || this.strokeMask[p]) continue;
        const { cost, strength } = this.brushScaling(p);
        applyDensityGrowth(world, p, strength, this.cityInfluence?.citiesAt(p));
        card.ink = Math.max(0, card.ink - cost);
        this.touch(p);
      }
    }

    // Рост возможен только от существующей территории: по суше или от побережья моря, которого уже касается государство.
    for (const p of pixels) this.dabMask[p] = 1;
    const queue: number[] = [];
    const enqueue = (p: number) => {
      if (this.dabMask[p] === 1) {
        this.dabMask[p] = 2;
        queue.push(p);
      }
    };
    const first = card.type !== 'colonization' && working.pixels === 0;
    const originSource = working.pixels > 0 ? demography(world, working) : null;
    const constantOriginMix = card.type === 'create'
      ? { ids: [world.cultures[card.newCultureId as number].foundingRaceId!], shares: [100] }
      : originSource ? expectedOriginsForPopulation(originSource.humanOrigin, originSource.population) : null;
    let constantOriginId: number | null = null;
    let cultureIndex: number | null = null;
    for (const p of pixels) {
      if (!canTake(p)) continue;
      let linked = first;
      if (card.type === 'colonization') {
        linked = this.colonizationAnchors?.[p] === 1;
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
        const transfer = transferColonizationPopulation(world, donor, p, card.ink / cost);
        if (!transfer) {
          this.message = 'На этом участке нельзя переселить население без превышения плотности донора.';
          break;
        }
        this.colonizationDonors?.refreshTop(donor);
        world.setOwner(p, tag);
        this.colonizationDonors?.add(p);
        if (this.colonizationConnected) this.colonizationConnected[p] = 1;
        this.colonistsMoved += transfer.amount;
        card.ink = Math.max(0, card.ink - transfer.ink * cost);
        this.touch(p);
        this.changed.push(p);
        this.markDirtyPixel(donor);
        forEachNeighbour(p, (n) => {
          if (this.dabMask[n] && canTake(n)) enqueue(n);
        });
        continue;
      }
      if (card.type === 'split') {
        if (!this.splitBrush?.paint(p)) continue;
      } else world.setOwner(p, tag);
      if (card.type !== 'split') {
        const { cost, strength } = this.brushScaling(p);
        world.density[p] = working.density * strength;
        cultureIndex ??= world.cultureTable.single(working.cultureId, 100);
        world.culture[p] = cultureIndex;
        world.religion[p] = this.religionForNewLand;
        const originMix = constantOriginMix ??
          { ids: [originForHabitat(world.temperature[p], world.humidity[p])], shares: [100] };
        if (constantOriginMix) {
          constantOriginId ??= world.humanOriginTable.intern(humanOriginMixToTable(originMix));
          world.humanOrigins[p] = constantOriginId;
        } else world.humanOrigins[p] = world.humanOriginTable.intern(humanOriginMixToTable(originMix));
        if (working.pixels === 1) working.ruler.humanOrigin = originMix;
        card.ink = Math.max(0, card.ink - cost);
      } else {
        card.ink -= 1;
      }
      this.touch(p);
      this.changed.push(p);
      if (card.type !== 'split' && world.water.coastsOf.length > 0) world.seasOfPixel(p, this.seas);
      forEachNeighbour(p, (n) => {
        if (this.dabMask[n] && canTake(n)) enqueue(n);
      });
    }
    for (const p of pixels) this.dabMask[p] = 0;
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
    const humanOriginMix = world.humanOriginTable.intern(
      humanOriginMixToTable(demography(world, nomad).humanOrigin),
    );
    const population = cells.reduce((sum, cell) => sum + cell.population, 0);
    const baseDensity = Number.isFinite(nomad.density)
      ? nomad.density
      : population / Math.max(1, range.length);
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
        range.push(pixel);
        this.nomadRange.add(pixel);
        rangeExpanded = true;
        let cell = this.nomadCells.get(pixel);
        if (!cell) {
          cell = { pixel, population: 0, cultureMix, religionMix, humanOriginMix };
          this.nomadCells.set(pixel, cell);
          cells.push(cell);
        }
        cell.population += baseDensity * strength;
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
        let cell = this.nomadCells.get(pixel);
        if (!cell) {
          cell = {
            pixel,
            population: 0,
            cultureMix,
            religionMix,
            humanOriginMix,
          };
          this.nomadCells.set(pixel, cell);
          cells.push(cell);
        }
        cell.population += strength;
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
        totals.set(entry.ids[index], (totals.get(entry.ids[index]) ?? 0) + cell.population * entry.shares[index] / 100);
      }
      population += cell.population;
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
        totals.set(entry.ids[index], (totals.get(entry.ids[index]) ?? 0) + cell.population * entry.shares[index] / 100);
      }
      population += cell.population;
    }
    if (population <= 0) {
      return nomad.religionId === null ? 0 : this.world.religionTable.single(nomad.religionId, 100);
    }
    return this.world.religionTable.intern(
      new Map([...totals].map(([id, amount]) => [id, amount * 100 / population])),
    );
  }

  private markDirtyPixel(p: number): void {
    const tileCols = 8, tileRows = 16;
    const tileWidth = MAP_WIDTH / tileCols, tileHeight = MAP_HEIGHT / tileRows;
    const x = p % MAP_WIDTH, y = Math.floor(p / MAP_WIDTH);
    this.world.contours.changed({ x0: x, y0: y, x1: x, y1: y },
      ['density', 'culture', 'religion', 'humanOrigins']);
    const col = Math.floor(x / tileWidth), row = Math.floor(y / tileHeight);
    const key = row * tileCols + col;
    if (this.dirtyTileKeys.has(key)) return;
    this.dirtyTileKeys.add(key);
    this.extraDirty.push({
      x0: Math.floor(col * tileWidth), y0: Math.floor(row * tileHeight),
      x1: Math.floor((col + 1) * tileWidth) - 1, y1: Math.floor((row + 1) * tileHeight) - 1,
    });
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
      if (isWind(card.type)) {
        if (onLand && world.owner[p] !== targetTag) { outside += 1; continue; }
        if (!onLand && !this.seas.has(world.water.bodyOf[p])) continue;
      } else if (targetTag > 0 && world.owner[p] !== targetTag) {
        outside += 1;
        continue;
      }
      if (card.type === 'drought' || card.type === 'rain') {
        const value = world.humidity[p];
        const next = card.type === 'rain' ? Math.min(100, value + CLIMATE_DELTA) : Math.max(0, value - CLIMATE_DELTA);
        if (next === value) continue;
        world.humidity[p] = next;
      } else if (card.type === 'desertification' || card.type === 'swamping') {
        const value = world.drainage[p];
        const next = card.type === 'desertification' ? Math.min(100, value + CLIMATE_DELTA) : Math.max(0, value - CLIMATE_DELTA);
        if (next === value) continue;
        world.drainage[p] = next;
      } else if (isTemperatureCard(card.type)) {
        const value = world.temperature[p];
        const next = card.type === 'warmCurrent' || card.type === 'warmWind'
          ? Math.min(100, value + CLIMATE_DELTA)
          : Math.max(0, value - CLIMATE_DELTA);
        if (next === value) continue;
        const cost = isWind(card.type) && !onLand ? 0.5 : 1;
        if (isWind(card.type)) this.strokeClimateChanges.push({ p, value, cost, wasInCard: this.cardMask[p] === 1 });
        world.temperature[p] = next;
        card.ink = Math.max(0, card.ink - cost);
        this.touch(p);
        this.changed.push(p);
        continue;
      } else if (card.type === 'faith') {
        if (world.owner[p] === 0) continue;
        const next = world.religionTable.convert(world.religion[p], card.newReligionId as number, FAITH_CONVERSION, null);
        if (next === world.religion[p]) continue;
        world.religion[p] = next;
      } else {
        if (world.owner[p] === 0) continue;
        const next = world.cultureTable.convert(world.culture[p], card.newCultureId as number, CULTURE_CONVERSION, card.sourceCultureId);
        if (next === world.culture[p]) continue;
        world.culture[p] = next;
      }
      card.ink = Math.max(0, card.ink - 1);
      this.touch(p);
      this.changed.push(p);
    }
    if (outside > 0 && this.changed.length === 0) this.message = 'Эта карта действует только на территории выбранной страны.';
  }
}
