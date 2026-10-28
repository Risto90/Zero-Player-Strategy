import { buildFlagField, generateFlagBandWeights, isFlagG09ChoiceFeasible, type FlagFieldOperator, type FlagFieldResult } from './flagField';
import { FLAG_FIELD_CONFIG } from './flagFieldConfig';
import { FLAG_EMBLEM_CONFIG } from './flagEmblemConfig';
import { calculateFlagEmblemCost, validateFlagEmblem, type EmblemNode, type EmblemPrimitive } from './flagEmblems';
import { FLAG_GENERATOR_CONFIG } from './flagGeneratorConfig';
import { createFlagColorProfile, solveFlagPalette, type FlagSlotRaster } from './flagColors';
import { FLAG_OUTLINE_CONFIG, type OutlineType } from './flagOutlineConfig';
import { buildFlagOutline } from './flagOutlines';
import { buildFlagOrdinaryLayers, type FlagOrdinarySpec, type FlagOrdinaryType } from './flagOrdinaries';
import { FLAG_ORDINARY_CONFIG } from './flagOrdinaryConfig';
import { stampFlagHashes } from './flagNovelty';
import {
  chooseFlagProfileMode,
  chooseFlagProfileWeight,
  chooseHybridProfile,
  getFlagProfile,
  mixHybridProfileProperties,
} from './flagProfiles';
import {
  FLAG_PLACEMENT_CONFIG,
  expandSymmetricPlacements,
  maximumChargeSizeClearOfObstaclesAtPoint,
  createMaximumSafeChargeSizeEvaluator,
  maximumSafeChargeSizeAtPoint,
  resolveChargeGroupPlacements,
  snapChargeSize,
  type FlagChargeAnchor,
  type FlagSymmetryClass,
  type PlacementReferences,
} from './flagPlacement';
import {
  FlagGenerationAttemptError,
  generateFlag,
  type FlagGenerationContext,
  type FlagGenerationDiagnostic,
  type FlagGenerationHooks,
  type FlagGenerationStage,
} from './flagGenerator';
import { renderFlagSpec } from './flagRenderer';
import { assertValidFlagSpec, type FlagLayer, type FlagNode, type FlagSpec, type JsonObject } from './flagSpec';
import { FLAG_PROFILE_DEFAULTS, type FlagProfileConfig, type FlagProfileWeights } from './flagProfileConfig';
import {
  rasterizeFlagPolygonMask,
  rasterizeFlagReference,
  type FlagRasterLayerInput,
  type FlagRasterShape,
} from './flagReferenceRaster';
import { validateFlag, type FlagValidationEvidence, type FlagValidationRule } from './flagValidation';
import { FLAG_VALIDATION_CONFIG } from './flagValidationConfig';

const CANVAS_HEIGHT = 1200;
const SYMBOLIC_SLOTS = ['s1', 's2', 's3', 's4', 's5'];
const MODULE_IDS: Record<string, string> = {
  DISC: 'M01', RING: 'M02', STAR: 'M03', POLYGON: 'M04', RHOMBUS: 'M05', CRESCENT: 'M06',
  SUN: 'M07', WHEEL: 'M08', GEAR: 'M08', CROSS_EMB: 'M09', CHEVRON: 'M10', LENS: 'M11', LILY: 'M12',
  TOWER: 'M13', CROWN: 'M14', KEY: 'M15', SWORD: 'M16', SPEAR: 'M17', ANCHOR: 'M18',
  TREE: 'M19', MOUNTAIN: 'M20', WAVES: 'M21', SHIP: 'M22', WINGED: 'M23', GLYPH: 'M24',
  SWIRL: 'M25', FOIL: 'M26', FLAME: 'M27', SHIELD: 'M28', BOW_ARROW: 'M29', BAR_STACK: 'M30',
};
const ORDINARY_TYPES: Record<string, FlagOrdinaryType> = {
  CROSS: 'O01', SALTIRE: 'O02', BAND: 'O03', BEND: 'O03', CHEVRON: 'O04',
  PALL: 'O05', PILE: 'O06', BORDURE: 'O07', CANTON: 'O08', PINWHEEL: 'O09',
};
const FIELD_OPERATORS: Record<string, FlagFieldOperator> = {
  SOLID: 'G01', BANDS: 'G02', PALY: 'G02', BENDY: 'G02',
  GYRONNY: 'G08', SALTIRE_DIV: 'G06', DIAG_BANDS: 'G03', PALL_DIV: 'G07', SPLIT2: 'G04', QUARTERLY: 'G05',
  CHECKY: 'G09', LOZENGY: 'G10', CHEVRONNY: 'G11', CONCENTRIC: 'G12',
  WG_COMP: 'G02', WG_ACCENT: 'G02',
};

interface SampledCharge {
  id: string;
  node: EmblemNode;
  moduleId: string;
  size: number;
  placementSize: number;
  anchor: FlagChargeAnchor;
  slot: string;
  innerSlot: string;
  centers: { x: number; y: number; rotation: number; mirror: boolean }[];
  cost: number;
  primitives: EmblemPrimitive[];
}

interface ChosenModuleOption {
  moduleName: string;
  anchor?: FlagChargeAnchor;
  composer?: string;
  composerParams?: Record<string, unknown>;
  sizeRange?: readonly [number, number];
}

interface PreparedChargeCandidate {
  moduleOption: ChosenModuleOption;
  moduleName: string;
  module: string;
  composer: string;
  node: EmblemNode;
  built: ReturnType<typeof validateFlagEmblem>;
  minimumDiameterUnits: number;
  extentFactor: number;
  availableWeights: Record<string, number>;
  virtualCantonSize?: { w: number; h: number };
  a5Geometry: ReturnType<typeof a5RegionReferences>;
  maximumSizeByAnchor: Map<FlagChargeAnchor, number>;
  a2FitOptions: Map<FlagChargeAnchor, {
    references: Partial<GeneratorPlacementReferences>;
    maximumSize: number;
  }[]>;
  a6FitOptions: Map<FlagChargeAnchor, {
    references: Partial<GeneratorPlacementReferences>;
    maximumSize: number;
  }[]>;
  a10FitOptions: Map<FlagChargeAnchor, {
    references: Partial<GeneratorPlacementReferences>;
    maximumSize: number;
  }[]>;
  anchor: FlagChargeAnchor;
}

const PROFILE_INSCRIBE_MODULES: Record<string, readonly string[]> = {
  P13: [
    'DISC', 'RING', 'STAR', 'POLYGON', 'RHOMBUS', 'SUN', 'WHEEL', 'CROSS_EMB',
    'CHEVRON', 'LENS', 'TOWER', 'KEY', 'SWORD', 'SPEAR', 'ANCHOR', 'TREE',
    'MOUNTAIN', 'WAVES', 'SHIP', 'GLYPH', 'SWIRL', 'FOIL', 'FLAME', 'BOW_ARROW',
  ],
  P15: [
    'DISC', 'RING', 'STAR', 'POLYGON', 'RHOMBUS', 'SUN', 'WHEEL', 'CROSS_EMB',
    'CHEVRON', 'LENS', 'TOWER', 'KEY', 'SWORD', 'SPEAR', 'TREE', 'MOUNTAIN',
    'GLYPH', 'SWIRL', 'FOIL', 'FLAME', 'BOW_ARROW',
  ],
};

function chooseUniform<T>(items: readonly T[], random: () => number): T {
  if (!items.length) throw new RangeError('Пул допустимых вариантов пуст');
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

interface ProfiledDraft {
  seed: string | number;
  era: number;
  profile: FlagProfileConfig;
  fieldProfile: FlagProfileConfig;
  chargeProfile: FlagProfileConfig;
  chargeSourceProfileId: string;
  secondProfileId: string | null;
  isFallback: boolean;
  outlineType?: OutlineType;
  aspect?: number;
  outlineParams?: Record<string, unknown>;
  outline?: ReturnType<typeof buildFlagOutline>;
  fieldOperator?: FlagFieldOperator;
  fieldDescriptor?: string;
  fieldParams?: Record<string, unknown>;
  fieldSlots?: string[];
  symmetry?: FlagSymmetryClass;
  field?: FlagFieldResult;
  ordinaryCount: number;
  chargeCount: number;
  ordinarySpecs: FlagOrdinarySpec[];
  ordinaryDescriptors: Record<string, string>;
  ordinaryPaint?: ReturnType<typeof buildFlagOrdinaryLayers>;
  charges: SampledCharge[];
  spec?: FlagSpec;
  validationEvidence?: FlagValidationEvidence;
  fallbackCount: number;
}

function weighted<T extends string>(weights: FlagProfileWeights | null, random: () => number): T {
  if (!weights) throw new Error('Для равномерного выбора не задан список допустимых вариантов');
  const entries = Object.entries(weights);
  if (!entries.length) throw new Error('Для равномерного выбора не задан список допустимых вариантов');
  const explicit = entries
    .map(([, weight]) => weight)
    .filter((weight): weight is number => weight !== null && Number.isFinite(weight) && weight > 0);
  const unspecifiedWeight = explicit.length
    ? explicit.reduce((sum, weight) => sum + weight, 0) / explicit.length
    : 1;
  const resolved = Object.fromEntries(entries.map(([value, weight]) => [
    value,
    weight === null ? unspecifiedWeight : weight,
  ]));
  return chooseFlagProfileWeight<T>(resolved, random);
}

function expandModuleCandidateWeights(weights: FlagProfileWeights): Record<string, number> {
  const entries = Object.entries(weights);
  const explicit = entries
    .map(([, weight]) => weight)
    .filter((weight): weight is number => weight !== null && Number.isFinite(weight) && weight > 0);
  const unspecifiedWeight = explicit.length
    ? explicit.reduce((sum, weight) => sum + weight, 0) / explicit.length
    : 1;
  const expanded: Record<string, number> = {};
  for (const [key, weight] of entries) {
    const resolvedWeight = weight === null ? unspecifiedWeight : weight;
    if (!Number.isFinite(resolvedWeight) || resolvedWeight <= 0) continue;
    const separator = key.indexOf(':');
    const prefix = separator < 0 ? '' : key.slice(0, separator).toUpperCase();
    if (['SMALL', 'SMALL_HOIST', 'ONE_MODULE'].includes(prefix)) {
      const alternatives = key.slice(separator + 1).split('|').map((item) => item.trim()).filter(Boolean);
      if (alternatives.length) {
        for (const alternative of alternatives) {
          const candidate = `${prefix}:${alternative}`;
          expanded[candidate] = (expanded[candidate] ?? 0) + resolvedWeight / alternatives.length;
        }
        continue;
      }
    }
    expanded[key] = (expanded[key] ?? 0) + resolvedWeight;
  }
  return expanded;
}

function chooseNumber(weights: FlagProfileWeights, random: () => number): number {
  return Number(weighted<string>(weights, random));
}

function chooseCount(weights: FlagProfileWeights, random: () => number): number {
  return Math.max(0, Math.round(chooseNumber(weights, random)));
}

function splitRange(value: string, random: () => number): number {
  const [first, second] = value.split('-').map(Number);
  if (!Number.isFinite(first)) throw new TypeError(`Не удалось разобрать диапазон «${value}»`);
  if (!Number.isFinite(second)) return first;
  return first + Math.floor(random() * (second - first + 1));
}

function profilePair(profile: FlagProfileConfig, era: number, random: () => number) {
  const mode = chooseFlagProfileMode(random, FLAG_PROFILE_DEFAULTS.purity);
  const donor = mode === 'hybrid' ? chooseHybridProfile(profile, era, random) : null;
  if (!donor) return {
    fieldProfile: profile,
    chargeProfile: profile,
    chargeSourceProfileId: profile.id,
    secondProfileId: null,
  };
  const mixed = mixHybridProfileProperties(profile, donor, random);
  const fieldSourceProfile = mixed.fieldAndOrdinaries.sourceProfileId === donor.id ? donor : profile;
  const fieldProfile = {
    ...profile,
    GND: mixed.fieldAndOrdinaries.GND,
    ORD: mixed.fieldAndOrdinaries.ORD,
    GEN: mixed.fieldAndOrdinaries.sourceProfileId === donor.id ? donor.GEN : profile.GEN,
    SPECIAL: fieldSourceProfile.SPECIAL,
  };
  const chargeProfile = { ...profile, CHG: mixed.charges.CHG };
  return {
    fieldProfile,
    chargeProfile,
    chargeSourceProfileId: mixed.charges.sourceProfileId,
    secondProfileId: donor.id,
  };
}

function makeDraft(
  profileId: string,
  era: number,
  seed: string | number,
  random: () => number,
  isFallback = false,
): ProfiledDraft {
  const profile = getFlagProfile(profileId);
  if (!profile) throw new RangeError(`Неизвестный профиль флага: ${profileId}`);
  if (!profile.eras.includes(era) && !isFallback) throw new RangeError(`Профиль ${profileId} недоступен в эпохе ${era}`);
  const pair = isFallback
    ? {
      fieldProfile: profile,
      chargeProfile: profile,
      chargeSourceProfileId: profile.id,
      secondProfileId: null,
    }
    : profilePair(profile, era, random);
  return {
    seed, era, profile, ...pair, isFallback,
    ordinaryCount: 0, chargeCount: 0, ordinarySpecs: [], ordinaryDescriptors: {},
    charges: [], fallbackCount: 0,
  };
}

function parseOutlineType(key: string): { type: OutlineType; variant?: string } {
  const [rawType, ...rest] = key.split(':');
  const type = rawType.toUpperCase() as OutlineType;
  if (!Object.hasOwn(FLAG_OUTLINE_CONFIG.types, type)) throw new RangeError(`Неизвестный тип контура: ${rawType}`);
  const variant = rest.join(':');
  return { type, ...(variant && !Number.isFinite(Number(variant)) ? { variant } : {}) };
}

type WeightedAspect = { aspect: number; weight: number };

function aspectCandidates(profile: FlagProfileConfig, type: OutlineType): WeightedAspect[] {
  if (type === 'SWALLOW' || type === 'PENNANT' || type === 'DOUBLE_PENNANT') {
    const [minimum, maximum] = FLAG_OUTLINE_CONFIG.types[type].aspect;
    const span = maximum - minimum;
    if (span <= 0) return [{ aspect: minimum, weight: 1 }];
    const choices = new Map<number, number>();
    const firstStep = Math.floor(minimum * 20 - 0.5) - 1;
    const lastStep = Math.ceil(maximum * 20 + 0.5) + 1;
    for (let step = firstStep; step <= lastStep; step += 1) {
      const lower = Math.max(0, ((step - 0.5) / 20 - minimum) / span);
      const upper = Math.min(1, ((step + 0.5) / 20 - minimum) / span);
      if (upper <= lower) continue;
      const aspect = Math.max(minimum, Math.min(maximum, step / 20));
      choices.set(aspect, (choices.get(aspect) ?? 0) + upper - lower);
    }
    return [...choices].map(([aspect, weight]) => ({ aspect, weight }));
  }

  const choices = new Map<number, number>();
  for (const [key, weight] of Object.entries(profile.ASP ?? {})) {
    const [entryType, rawValues = ''] = key.split(':', 2);
    if (entryType.toUpperCase() !== type) continue;
    for (const raw of rawValues.split('|')) {
      const aspect = Number(raw);
      if (!Number.isFinite(aspect)) continue;
      choices.set(aspect, (choices.get(aspect) ?? 0) + (weight ?? 1));
    }
  }
  return [...choices].map(([aspect, weight]) => ({ aspect, weight }));
}

function chooseAspect(
  profile: FlagProfileConfig,
  type: OutlineType,
  random: () => number,
  isFeasible?: (aspect: number) => boolean,
): number {
  if (!isFeasible && (type === 'SWALLOW' || type === 'PENNANT' || type === 'DOUBLE_PENNANT')) {
    const range = FLAG_OUTLINE_CONFIG.types[type].aspect;
    const draw = random();
    if (!Number.isFinite(draw) || draw < 0 || draw > 1) {
      throw new RangeError('Случайное значение для аспекта должно быть в диапазоне [0, 1]');
    }
    const aspect = Math.round((range[0] + draw * (range[1] - range[0])) * 20) / 20;
    return Math.max(range[0], Math.min(range[1], aspect));
  }
  const candidates = aspectCandidates(profile, type)
    .filter(({ aspect }) => !isFeasible || isFeasible(aspect));
  if (!candidates.length) throw new RangeError(`Для профиля ${profile.id} нет допустимого аспекта контура ${type}`);
  const optionWeights: FlagProfileWeights = Object.fromEntries(
    candidates.map(({ aspect, weight }) => [String(aspect), weight]),
  );
  return Number(weighted<string>(optionWeights, random));
}

const outlineAnchorFitCache = new Map<string, boolean>();

function outlineSupportsAnchors(
  draft: ProfiledDraft,
  type: OutlineType,
  aspect: number,
  variant: string | undefined,
  anchors: readonly FlagChargeAnchor[],
): boolean {
  if (anchors.some((anchor) => anchor !== 'A1' && anchor !== 'A2')) return true;
  const cacheKey = `${draft.chargeProfile.id}|${type}|${aspect}|${variant ?? ''}|${anchors.join(',')}`;
  const cached = outlineAnchorFitCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const params: Record<string, unknown> = {};
  if (type === 'BANNER' && variant) params.lowerEdge = variant;
  const outline = buildFlagOutline({ type, aspect, params: params as any });
  const frame = { w: aspect, h: 1 };
  const fits = anchors.some((anchor) => {
    const [minimum, maximum] = anchorSizeBounds(anchor, draft);
    const points = anchor === 'A1'
      ? [{ u: 0.5, v: 0.5 }]
      : type === 'BANNER'
        ? FLAG_PLACEMENT_CONFIG.anchors.bannerA2YValues.map((v) => ({ u: 0.5, v }))
        : (draft.chargeProfile.id === 'P22'
          ? [FLAG_PLACEMENT_CONFIG.anchors.p22HoistCenterX]
          : FLAG_PLACEMENT_CONFIG.anchors.hoistCenterXValues).map((u) => ({ u, v: 0.5 }));
    return points.some((point) =>
      Math.min(maximum, maximumSafeChargeSizeAtPoint(point, frame, outline.safe_area, CANVAS_HEIGHT)) >= minimum,
    );
  });
  if (outlineAnchorFitCache.size > 2048) outlineAnchorFitCache.clear();
  outlineAnchorFitCache.set(cacheKey, fits);
  return fits;
}

function makeOutline(
  draft: ProfiledDraft,
  random: () => number,
  fitAnchors?: readonly FlagChargeAnchor[],
): void {
  const outlineWeights = draft.profile.OUT ?? Object.fromEntries(
    [...new Set(Object.keys(draft.profile.ASP ?? {}).map((key) => key.split(':', 1)[0].toUpperCase()))]
      .map((type) => [type, 1]),
  );
  const feasibleOutlineWeights: FlagProfileWeights = fitAnchors?.length
    ? Object.fromEntries(Object.entries(outlineWeights).filter(([key]) => {
      const selected = parseOutlineType(key);
      return aspectCandidates(draft.profile, selected.type)
        .some(({ aspect }) => outlineSupportsAnchors(draft, selected.type, aspect, selected.variant, fitAnchors));
    }))
    : outlineWeights;
  if (!Object.keys(feasibleOutlineWeights).length) {
    throw new FlagGenerationAttemptError('S2_OUTLINE', `Для профиля ${draft.profile.id} нет контура с допустимым диапазоном размера эмблемы`);
  }
  const rawKey = weighted<string>(feasibleOutlineWeights, random);
  const selected = parseOutlineType(rawKey);
  const aspect = chooseAspect(
    draft.profile,
    selected.type,
    random,
    fitAnchors?.length
      ? (candidate) => outlineSupportsAnchors(draft, selected.type, candidate, selected.variant, fitAnchors)
      : undefined,
  );
  const params: Record<string, unknown> = {};
  if (selected.type === 'BANNER' && selected.variant) params.lowerEdge = selected.variant;
  const outline = buildFlagOutline({ type: selected.type, aspect, params: params as any });
  draft.outlineType = selected.type;
  draft.aspect = aspect;
  draft.outlineParams = outline.params;
  draft.outline = outline;
}

function resolveFieldOperator(descriptor: string): FlagFieldOperator {
  const prefix = descriptor.split(':', 1)[0].toUpperCase();
  const operator = FIELD_OPERATORS[prefix];
  if (!operator) throw new RangeError(`Неизвестный оператор поля профиля: ${descriptor}`);
  return operator;
}

type G02WeightKind = 'equal' | 'symmetric' | 'five' | 'comp' | 'accent';
type G02Pattern = 'CYC' | 'MIRROR' | 'TRIAD' | 'SEP' | 'DISTINCT';

function rangeValues(minimum: number, maximum: number): number[] {
  if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || maximum < minimum) return [];
  return Array.from({ length: maximum - minimum + 1 }, (_, index) => minimum + index);
}

function parseBandCountToken(token: string): number[] | null {
  const match = /^(\d+)(?:-(\d+))?$/.exec(token);
  if (!match) return null;
  return rangeValues(Number(match[1]), Number(match[2] ?? match[1]));
}

function normalizeG02WeightKind(value: string): G02WeightKind | null {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (normalized === 'EQUAL' || normalized === 'WGEQUAL') return 'equal';
  if (normalized === 'SYM' || normalized === 'SYMMETRIC' || normalized === 'WGSYM') return 'symmetric';
  if (normalized === '5' || normalized === 'WG5') return 'five';
  if (normalized === 'COMP' || normalized === 'WGCOMP') return 'comp';
  if (normalized === 'ACCENT' || normalized === 'WGACCENT') return 'accent';
  return null;
}

function normalizeG02Pattern(value: string): G02Pattern | null {
  const normalized = value.toUpperCase();
  if (normalized === 'CYC' || normalized === 'CYC_2') return 'CYC';
  if (['MIRROR', 'TRIAD', 'SEP', 'DISTINCT'].includes(normalized)) return normalized as G02Pattern;
  return null;
}

function configuredChoiceWeights(value: unknown): FlagProfileWeights | null {
  if (Array.isArray(value)) {
    const choices = value.filter((item): item is string => typeof item === 'string');
    return choices.length ? Object.fromEntries(choices.map((choice) => [choice, 1])) : null;
  }
  if (!value || typeof value !== 'object') return null;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > 0);
  return entries.length ? Object.fromEntries(entries) : null;
}

function g02PatternFits(pattern: G02Pattern, count: number): boolean {
  if (pattern === 'CYC') return count >= 2;
  if (pattern === 'MIRROR') return count === 3 || count === 5;
  if (pattern === 'TRIAD') return count >= 3;
  if (pattern === 'SEP') return count >= 3 && count % 2 === 1;
  return count >= 2 && count <= 5;
}

function g02WeightFits(kind: G02WeightKind, count: number): boolean {
  if (kind === 'equal') return count >= 2;
  if (kind === 'symmetric' || kind === 'accent') return count === 3 || (kind === 'symmetric' && count === 5);
  if (kind === 'five') return count === 5;
  return count >= 3;
}

function polygonMeetsMinimumAngle(points: readonly { x: number; y: number }[]): boolean {
  const unique: { x: number; y: number }[] = [];
  for (const point of points) {
    const previous = unique.at(-1);
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > 1e-9) unique.push(point);
  }
  if (unique.length > 1 &&
    Math.hypot(unique[0].x - unique.at(-1)!.x, unique[0].y - unique.at(-1)!.y) <= 1e-9) {
    unique.pop();
  }
  if (unique.length < 3) return false;
  const area = unique.reduce((sum, point, index) => {
    const next = unique[(index + 1) % unique.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
  if (Math.abs(area) < 1e-9) return false;
  const minimumAngle = FLAG_VALIDATION_CONFIG.sharpAngles.minimumPolygonDegrees;
  for (let index = 0; index < unique.length; index += 1) {
    const previous = unique[(index + unique.length - 1) % unique.length];
    const current = unique[index];
    const next = unique[(index + 1) % unique.length];
    const firstLength = Math.hypot(previous.x - current.x, previous.y - current.y);
    const secondLength = Math.hypot(next.x - current.x, next.y - current.y);
    if (!firstLength || !secondLength) return false;
    const dot = (previous.x - current.x) * (next.x - current.x) +
      (previous.y - current.y) * (next.y - current.y);
    const convexAngle = Math.acos(Math.max(-1, Math.min(1, dot / (firstLength * secondLength)))) * 180 / Math.PI;
    const turn = (current.x - previous.x) * (next.y - current.y) -
      (current.y - previous.y) * (next.x - current.x);
    const interiorAngle = turn * area >= 0 ? convexAngle : 360 - convexAngle;
    if (interiorAngle < minimumAngle) return false;
  }
  return true;
}

function fieldMeetsMinimumPolygonAngle(
  operator: FlagFieldOperator,
  params: Record<string, unknown>,
  aspect: number,
  outline: ReturnType<typeof buildFlagOutline> | undefined,
  slots: readonly string[],
): boolean {
  const field = buildFlagField(
    { op: operator, params },
    { x0: 0, y0: 0, w: CANVAS_HEIGHT * aspect, h: CANVAS_HEIGHT },
    {
      canvasHeight: CANVAS_HEIGHT,
      clipChain: outline ? [[outline.boundary]] : [],
      slots: [...slots],
      random: () => 0.5,
    },
  );
  return field.regions.every((region) =>
    [...region.polygons, ...region.visiblePolygons].every(polygonMeetsMinimumAngle),
  );
}

function fieldParameters(
  descriptor: string,
  operator: FlagFieldOperator,
  random: () => number,
  special: Record<string, unknown> | null = null,
  aspect = 1.5,
  outline?: ReturnType<typeof buildFlagOutline>,
  slots: readonly string[] = SYMBOLIC_SLOTS,
): Record<string, unknown> {
  const parts = descriptor.split(':').map((part) => part.trim());
  const suffix = parts.slice(1);
  const params: Record<string, unknown> = {};
  if (operator === 'G02') {
    const tokens = suffix.flatMap((part) => part.split('|')).map((part) => part.trim().toUpperCase()).filter(Boolean);
    const axisOptions = tokens.filter((token): token is 'H' | 'V' => token === 'H' || token === 'V');
    const explicitPatterns = tokens.map(normalizeG02Pattern).filter((pattern): pattern is G02Pattern => pattern !== null);
    const countEntries = tokens.flatMap((token) => {
      const match = /^(\d+(?:-\d+)?)(?:_(.+))?$/.exec(token);
      if (!match) return [];
      const counts = parseBandCountToken(match[1]);
      if (!counts) return [];
      return [{ counts, weight: match[2] ? normalizeG02WeightKind(match[2]) : null }];
    });
    const bundledEntries = countEntries.filter((entry) => entry.weight !== null);
    const selectedBundle = bundledEntries.length ? chooseUniform(bundledEntries, random) : null;
    const explicitCount = countEntries.length > 0;
    const explicitWeightKinds = selectedBundle
      ? [selectedBundle.weight!]
      : tokens.map(normalizeG02WeightKind).filter((kind): kind is G02WeightKind => kind !== null);
    const bandCountWeights = configuredChoiceWeights(special?.bandCountWeights);
    const specialBands = Array.isArray(special?.bands) && special.bands.length === 2
      ? rangeValues(Number(special.bands[0]), Number(special.bands[1]))
      : [];
    const countCandidates = selectedBundle
      ? selectedBundle.counts
      : explicitCount
        ? countEntries.flatMap((entry) => entry.counts)
        : bandCountWeights
          ? Object.keys(bandCountWeights).map(Number).filter(Number.isInteger)
          : specialBands.length
            ? specialBands
            : rangeValues(...FLAG_FIELD_CONFIG.operators.G02.bands);
    const configuredPatterns = configuredChoiceWeights(special?.slotPattern);
    const configuredWeightKinds = configuredChoiceWeights(special?.bandWeighting);
    const patternsForCount = (count: number): G02Pattern[] => {
      const choices = explicitPatterns.length
        ? explicitPatterns
        : configuredPatterns
          ? Object.keys(configuredPatterns).map(normalizeG02Pattern).filter((pattern): pattern is G02Pattern => pattern !== null)
          : ['CYC', 'MIRROR', 'TRIAD', 'SEP', 'DISTINCT'] as G02Pattern[];
      return choices.filter((pattern) => g02PatternFits(pattern, count));
    };
    const weightsForCount = (count: number): G02WeightKind[] => {
      const choices = explicitWeightKinds.length
        ? explicitWeightKinds
        : configuredWeightKinds
          ? Object.keys(configuredWeightKinds).map(normalizeG02WeightKind).filter((kind): kind is G02WeightKind => kind !== null)
          : ['equal', 'symmetric', 'five', 'comp', 'accent'] as G02WeightKind[];
      return choices.filter((kind) => g02WeightFits(kind, count));
    };
    const validCounts = [...new Set(countCandidates)].filter((count) =>
      patternsForCount(count).length > 0 && weightsForCount(count).length > 0);
    if (!validCounts.length) throw new RangeError('В описании полос нет допустимого сочетания числа, шаблона и весов');
    let count: number;
    if (!explicitCount && bandCountWeights) {
      const validCountWeights = Object.fromEntries(validCounts
        .map((value) => [String(value), bandCountWeights[String(value)] ?? 0])
        .filter(([, weight]) => typeof weight === 'number' && weight > 0)) as FlagProfileWeights;
      count = Number(weighted<string>(validCountWeights, random));
    } else {
      count = chooseUniform(validCounts, random);
    }
    const pattern = explicitPatterns.length
      ? chooseUniform(patternsForCount(count), random)
      : configuredPatterns
        ? weighted<string>(
          Object.fromEntries(patternsForCount(count)
            .map((value) => [value, configuredPatterns[value.toLowerCase()] ?? configuredPatterns[value] ?? 0])) as FlagProfileWeights,
          random,
        ) as G02Pattern
        : chooseUniform(patternsForCount(count), random);
    const weightKind = explicitWeightKinds.length
      ? chooseUniform(weightsForCount(count), random)
      : configuredWeightKinds
        ? weighted<string>(
          Object.fromEntries(weightsForCount(count)
            .map((value) => [value, configuredWeightKinds[value] ?? (value === 'symmetric' ? configuredWeightKinds.sym : undefined) ?? 0])) as FlagProfileWeights,
          random,
        ) as G02WeightKind
        : chooseUniform(weightsForCount(count), random);
    let weights: Record<string, unknown> = weightKind === 'symmetric'
      ? count === 3
        ? { kind: 'sym', ratio: chooseUniform(FLAG_FIELD_CONFIG.weights.symmetricRatios, random) }
        : { kind: '5', variant: chooseUniform(['11211', '12121'], random) }
      : weightKind === 'five'
        ? { kind: '5', variant: chooseUniform(['11211', '12121'], random) }
        : { kind: weightKind === 'equal' ? 'equal' : weightKind };
    params.axis = axisOptions.length ? chooseUniform(axisOptions, random) : chooseUniform(['H', 'V'], random);
    if (weightKind === 'comp' || weightKind === 'accent') {
      const frameHeight = params.axis === 'H' ? CANVAS_HEIGHT : CANVAS_HEIGHT * aspect;
      const generatedWeights = generateFlagBandWeights(
        weightKind === 'comp' ? { kind: 'comp' } : { kind: 'accent' },
        count,
        { frameHeight, canvasHeight: CANVAS_HEIGHT, random },
      );
      weights = { kind: 'custom', weights: generatedWeights };
    }
    params.n = count;
    params.bands = count;
    params.pattern = pattern;
    params.weights = weights;
  } else if (operator === 'G03') {
    const tokens = suffix.flatMap((part) => part.split('|')).map((part) => part.trim().toUpperCase()).filter(Boolean);
    const [minimumBands, maximumBands] = FLAG_FIELD_CONFIG.operators.G03.bands;
    const countOptions = tokens
      .flatMap((part) => part.split('|'))
      .flatMap((part) => parseBandCountToken(part) ?? [])
      .filter((count) => count >= minimumBands && count <= maximumBands);
    const explicitAngles = tokens
      .map((token) => token === 'DIAGONAL' || token === 'CORNER_TO_CORNER'
        ? 'DIAGONAL'
        : Number(token))
      .filter((angle): angle is number | 'DIAGONAL' =>
        angle === 'DIAGONAL' || FLAG_FIELD_CONFIG.operators.G03.angles.includes(angle as 30 | 45 | 60));
    const explicitPatterns = tokens.map(normalizeG02Pattern)
      .filter((pattern): pattern is G02Pattern => pattern !== null);
    const explicitWeightKinds = tokens.map(normalizeG02WeightKind)
      .filter((kind): kind is G02WeightKind => kind !== null);
    const countCandidates = countOptions.length ? countOptions : rangeValues(minimumBands, maximumBands);
    const validCounts = [...new Set(countCandidates)].filter((count) =>
      (!explicitPatterns.length || explicitPatterns.some((pattern) => g02PatternFits(pattern, count))) &&
      (!explicitWeightKinds.length || explicitWeightKinds.some((kind) => g02WeightFits(kind, count))));
    if (!validCounts.length) throw new RangeError('В описании диагональных полос нет допустимого числа полос');
    const count = chooseUniform(validCounts, random);
    const angle = explicitAngles.length
      ? chooseUniform(explicitAngles, random)
      : chooseUniform(['DIAGONAL', ...FLAG_FIELD_CONFIG.operators.G03.angles], random);
    const patterns = (explicitPatterns.length
      ? explicitPatterns
      : ['CYC', 'MIRROR', 'TRIAD', 'SEP', 'DISTINCT'] as G02Pattern[])
      .filter((pattern) => g02PatternFits(pattern, count));
    const weightKinds = (explicitWeightKinds.length
      ? explicitWeightKinds
      : ['equal', 'symmetric', 'five', 'comp', 'accent'] as G02WeightKind[])
      .filter((kind) => g02WeightFits(kind, count));
    const weightKind = chooseUniform(weightKinds, random);
    let weights: Record<string, unknown> = weightKind === 'symmetric'
      ? count === 3
        ? { kind: 'sym', ratio: chooseUniform(FLAG_FIELD_CONFIG.weights.symmetricRatios, random) }
        : { kind: '5', variant: chooseUniform(['11211', '12121'], random) }
      : weightKind === 'five'
        ? { kind: '5', variant: chooseUniform(['11211', '12121'], random) }
        : { kind: weightKind === 'equal' ? 'equal' : weightKind };
    if (weightKind === 'comp' || weightKind === 'accent') {
      const theta = typeof angle === 'string'
        ? Math.atan2(1, aspect)
        : angle * Math.PI / 180;
      const frameWidth = CANVAS_HEIGHT * aspect;
      const bandExtent = Math.abs(Math.sin(theta)) * frameWidth + Math.abs(Math.cos(theta)) * CANVAS_HEIGHT;
      weights = {
        kind: 'custom',
        weights: generateFlagBandWeights(
          weightKind === 'comp' ? { kind: 'comp' } : { kind: 'accent' },
          count,
          { frameHeight: bandExtent, canvasHeight: CANVAS_HEIGHT, random },
        ),
      };
    }
    params.n = count;
    params.bands = count;
    params.angle = angle;
    params.mirror = random() < 0.5;
    params.pattern = chooseUniform(patterns, random);
    params.weights = weights;
  } else if (operator === 'G04') {
    const allowedModes = ['PALE', 'FESS', 'BEND', 'CHEVRON'];
    const modes = suffix.flatMap((part) => part.split('|'))
      .map((part) => part.toUpperCase())
      .filter((part): part is typeof allowedModes[number] => allowedModes.includes(part));
    const mode = modes.length ? chooseUniform(modes, random) : chooseUniform(allowedModes, random);
    const config = FLAG_FIELD_CONFIG.operators.G04;
    params.mode = mode;
    if (mode === 'PALE' || mode === 'FESS') {
      params.p = chooseUniform(config.splitFractions, random);
    } else if (mode === 'BEND') {
      params.diagonal = chooseUniform(['BACKSLASH', 'SLASH'], random);
    } else {
      params.orientation = weighted<string>(
        Object.fromEntries(config.chevronOrientations.map(({ id, weight }) => [id, weight])),
        random,
      );
      const positions = rangeValues(3, config.chevronVertexDivisor - 3)
        .map((step) => step / config.chevronVertexDivisor);
      params.vertex = { u: chooseUniform(positions, random), v: chooseUniform(positions, random) };
      params.angle = chooseUniform(config.chevronAngles, random);
    }
  } else if (operator === 'G05') {
    const config = FLAG_FIELD_CONFIG.operators.G05;
    const slotModes = ['CHECKER', 'AB/CD', 'AB/BB'];
    const explicitModes = suffix.flatMap((part) => part.split('|'))
      .map((part) => part.toUpperCase().replaceAll('_', '/'))
      .filter((part): part is typeof slotModes[number] => slotModes.includes(part));
    params.px = chooseUniform(config.splitFractions, random);
    params.py = chooseUniform(config.splitFractions, random);
    params.slotsMode = explicitModes.length ? chooseUniform(explicitModes, random) : chooseUniform(slotModes, random);
  } else if (operator === 'G06') {
    const modes = ['TOP_BOTTOM_SIDES', 'ALL_DISTINCT', 'TOP_DISTINCT'];
    const explicitModes = suffix.flatMap((part) => part.split('|'))
      .map((part) => part.toUpperCase())
      .filter((part): part is typeof modes[number] => modes.includes(part));
    const epsilon = Number.EPSILON * 4;
    let validCenter = false;
    for (let attempt = 0; attempt < 256; attempt += 1) {
      params.center = {
        u: epsilon + random() * (1 - epsilon * 2),
        v: epsilon + random() * (1 - epsilon * 2),
      };
      if (fieldMeetsMinimumPolygonAngle(operator, params, aspect, outline, slots)) {
        validCenter = true;
        break;
      }
    }
    if (!validCenter) throw new RangeError('G06 не найдено положение центра без углов меньше порога приёмки');
    params.slotsMode = explicitModes.length ? chooseUniform(explicitModes, random) : chooseUniform(modes, random);
  } else if (operator === 'G07') {
    const config = FLAG_FIELD_CONFIG.operators.G07;
    const centerSteps = rangeValues(config.centerRange[0] * config.centerDivisor, config.centerRange[1] * config.centerDivisor);
    const center = {
      u: chooseUniform(centerSteps, random) / config.centerDivisor,
      v: chooseUniform(centerSteps, random) / config.centerDivisor,
    };
    const explicitLayout = suffix.flatMap((part) => part.split('|'))
      .map((part) => part.replaceAll('_', '/').replaceAll(':', '/'))
      .find((part) => part === '90/135/135' || part === '120/120/120');
    const angleSet = explicitLayout === '90/135/135'
      ? config.angleSets[1]
      : explicitLayout === '120/120/120'
        ? config.angleSets[0]
        : chooseUniform(config.angleSets, random);
    const layout = config.startAngles.find(({ angles }) => angles.every((angle, index) => angle === angleSet[index]));
    if (!layout) throw new RangeError('Не настроены начальные углы выбранного деления G07');
    params.center = center;
    params.angles = angleSet.join('/');
    params.startAngle = Number(weighted<string>(
      Object.fromEntries(layout.values.map((angle, index) => [String(angle), layout.weights[index]])),
      random,
    ));
  } else if (operator === 'G08') {
    const config = FLAG_FIELD_CONFIG.operators.G08;
    const explicitCounts = suffix.flatMap((part) => part.split('|'))
      .flatMap((part) => parseBandCountToken(part.trim()) ?? []);
    const validExplicitCounts = explicitCounts.filter((count) => config.counts.includes(count as 8 | 12 | 16 | 24));
    params.n = validExplicitCounts.length ? chooseUniform(validExplicitCounts, random) : chooseUniform(config.counts, random);
    params.colors = chooseUniform(config.colors, random);
    const fanMarker = suffix.some((part) => part.toUpperCase().includes('FAN'));
    const fan = fanMarker || random() < 0.5;
    params.fan = fan;
    let validGeometry = false;
    for (let attempt = 0; attempt < 256; attempt += 1) {
      params.center = fan
        ? { u: config.fanCenterRange[0] + random() * (config.fanCenterRange[1] - config.fanCenterRange[0]), v: random() }
        : { u: 0.5 - random() * config.maximumPoleShift, v: 0.5 };
      params.startAngle = random() * 360;
      if (fieldMeetsMinimumPolygonAngle(operator, params, aspect, outline, slots)) {
        validGeometry = true;
        break;
      }
    }
    if (!validGeometry) throw new RangeError('G08 не найдено деление без углов меньше порога приёмки');
  } else if (operator === 'G09') {
    const config = FLAG_FIELD_CONFIG.operators.G09;
    const explicitCounts = suffix.flatMap((part) => part.split('|'))
      .flatMap((part) => parseBandCountToken(part.trim()) ?? [])
      .filter((count) => count >= config.columns[0] && count <= config.columns[1]);
    const origins = suffix.flatMap((part) => part.split('|'))
      .map((part) => part.toUpperCase())
      .filter((part): part is 'CORNER' | 'CENTER' => part === 'CORNER' || part === 'CENTER');
    const columns = explicitCounts.length ? explicitCounts : rangeValues(...config.columns);
    const placements = origins.length ? origins : ['CORNER', 'CENTER'] as const;
    const frame = { x0: 0, y0: 0, w: CANVAS_HEIGHT * aspect, h: CANVAS_HEIGHT };
    const choices = columns.flatMap((nx) => placements
      .filter((origin) => isFlagG09ChoiceFeasible(frame, nx, origin))
      .map((origin) => ({ nx, origin })));
    if (!choices.length) {
      throw new FlagGenerationAttemptError('S4_COMPOSITION', 'Для G09 нет допустимой комбинации nx и origin при данном отношении сторон');
    }
    const choice = chooseUniform(choices, random);
    params.nx = choice.nx;
    params.origin = choice.origin;
  } else if (operator === 'G10') {
    const config = FLAG_FIELD_CONFIG.operators.G10;
    params.angle = config.angles[0] + random() * (config.angles[1] - config.angles[0]);
    params.cellSize = CANVAS_HEIGHT / config.cellSizeDivisors[0] +
      random() * (CANVAS_HEIGHT / config.cellSizeDivisors[1] - CANVAS_HEIGHT / config.cellSizeDivisors[0]);
    params.origin = weighted<string>(config.centeringWeights, random);
    params.orientation = config.defaultOrientation;
  } else if (operator === 'G11') {
    const config = FLAG_FIELD_CONFIG.operators.G11;
    const orientations = Object.fromEntries(config.orientations.map(({ id, weight }) => [id, weight]));
    const patterns = Object.fromEntries(config.colorPatterns.map(({ id, weight }) => [id, weight]));
    const orientation = weighted<string>(orientations, random);
    const validThicknesses = config.angles.flatMap((angle) =>
      config.thicknessDivisors
        .filter((divisor) => Math.cos(angle * Math.PI / 180) / divisor >=
          1 / FLAG_FIELD_CONFIG.minimumThicknessDivisor)
        .map((thicknessDivisor) => ({ angle, thicknessDivisor })),
    );
    const geometry = chooseUniform(validThicknesses, random);
    const [minimumBands, maximumBands] = config.bands;
    const axisStart = 0.15 + random() * 0.2;
    const transverse = random();
    params.n = minimumBands + Math.floor(random() * (maximumBands - minimumBands + 1));
    params.orientation = orientation;
    params.pattern = weighted<string>(patterns, random);
    params.angle = geometry.angle;
    params.thicknessDivisor = geometry.thicknessDivisor;
    params.vertex = orientation === 'UP' || orientation === 'DOWN'
      ? { u: transverse, v: axisStart }
      : { u: axisStart, v: transverse };
  } else if (operator === 'G12') {
    const config = FLAG_FIELD_CONFIG.operators.G12;
    const count = chooseUniform(rangeValues(...config.bands), random);
    const patterns = (['CYC', 'MIRROR', 'TRIAD', 'SEP', 'DISTINCT'] as G02Pattern[])
      .filter((pattern) => g02PatternFits(pattern, count));
    params.n = count;
    params.bands = count;
    params.figure = chooseUniform(['circle', 'square', 'rhombus', 'rectangle'], random);
    params.center = { u: random(), v: random() };
    params.pattern = chooseUniform(patterns, random);
  }
  return params;
}

function ordinaryType(key: string): FlagOrdinaryType | null {
  const kind = key.split(':', 1)[0].toUpperCase();
  return ORDINARY_TYPES[kind] ?? null;
}

function containsBordure(spec: FlagOrdinarySpec): boolean {
  return spec.type === 'O07' || (spec.children ?? []).some(containsBordure);
}

function sampleOrdinaryParameters(
  descriptor: string,
  profileId: string,
  aspect: number,
  random: () => number,
  ordinaryFill?: string,
): Record<string, unknown> {
  const type = ordinaryType(descriptor);
  if (!type) return {};
  const options = descriptor.split(':').slice(1)
    .flatMap((part) => part.split('|'))
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);
  const has = (value: string) => options.includes(value);
  const width = CANVAS_HEIGHT * aspect;
  const margin = FLAG_PLACEMENT_CONFIG.anchors.safeMargin;
  const scandinavian = has('SCANDINAVIAN') || profileId === 'P19';
  const center = has('CENTER')
    ? { u: 0.5, v: 0.5 }
    : scandinavian
      ? {
        u: sampleRange(...FLAG_ORDINARY_CONFIG.operators.O01.scandinavianCenterRange, random),
        v: 0.5,
      }
      : {
      u: margin / width + random() * (1 - 2 * margin / width),
      v: margin / CANVAS_HEIGHT + random() * (1 - 2 * margin / CANVAS_HEIGHT),
      };
  const minimumThickness = CANVAS_HEIGHT / FLAG_ORDINARY_CONFIG.minimumThicknessDivisor;
  const sampleSnappedMeasure = (minimum: number, maximum: number, floor: number) => {
    if (!(maximum >= minimum)) {
      throw new RangeError(`Нет допустимого диапазона размерного параметра: ${minimum}..${maximum}`);
    }
    const value = maximum === minimum ? minimum : sampleRange(minimum, maximum, random);
    const snapConfig = FLAG_ORDINARY_CONFIG.thicknessSnap;
    const divisor = random() < snapConfig.preferredProbability
      ? snapConfig.preferredDivisor
      : snapConfig.fineDivisor;
    const step = CANVAS_HEIGHT / divisor;
    return Math.min(maximum, Math.max(Math.round(value / step) * step, floor));
  };
  const sampleThickness = (divisors: readonly number[], maximum = Number.POSITIVE_INFINITY) => {
    const minimum = Math.max(
      CANVAS_HEIGHT / Math.max(...divisors),
      minimumThickness,
    );
    const upper = Math.min(CANVAS_HEIGHT / Math.min(...divisors), maximum);
    return sampleSnappedMeasure(minimum, upper, minimumThickness);
  };

  if (type === 'O01') {
    const profileByOption: Record<string, string> = {
      PLAIN: 'STRAIGHT', STRAIGHT: 'STRAIGHT', FLARED: 'FLARED', LATIN: 'LATIN',
    };
    const allowedProfiles = options.map((option) => profileByOption[option]).filter(Boolean);
    const profiles = scandinavian ? ['STRAIGHT'] : allowedProfiles.length
      ? allowedProfiles
      : ['STRAIGHT', 'FLARED', 'LATIN'];
    const armOptions = options.filter((option) => option === 'FULL' || option === 'COUPED');
    const arms = armOptions.length ? chooseUniform(armOptions, random) : scandinavian
      ? 'FULL'
      : chooseUniform(['FULL', 'COUPED'], random);
    const profile = chooseUniform(profiles, random);
    const params: Record<string, unknown> = {
      thickness: sampleThickness(FLAG_ORDINARY_CONFIG.operators.O01.thicknessDivisors),
      center,
      arms,
      profile,
    };
    if (scandinavian) params.scandinavian = true;
    if (arms === 'COUPED') {
      const [minimum, maximum] = FLAG_ORDINARY_CONFIG.operators.O01.coupleLength;
      params.halfLength = sampleRange(minimum * Math.min(width, CANVAS_HEIGHT), maximum * Math.min(width, CANVAS_HEIGHT), random);
    }
    if (profile === 'FLARED') {
      const [minimum, maximum] = FLAG_ORDINARY_CONFIG.operators.O01.flare;
      params.flareRatio = sampleRange(minimum, maximum, random);
    }
    if (profile === 'LATIN') {
      const [minimum, maximum] = FLAG_ORDINARY_CONFIG.operators.O01.latinLength;
      params.latinRatio = sampleRange(minimum, maximum, random);
    }
    return params;
  }

  if (type === 'O02') {
    const modes = options.filter((option) => option === 'CORNER' || option === 'D45');
    return {
      thickness: sampleThickness(FLAG_ORDINARY_CONFIG.operators.O02.thicknessDivisors),
      center,
      mode: modes.length ? chooseUniform(modes, random) : chooseUniform(['CORNER', 'D45'], random),
    };
  }
  if (type === 'O03') {
    const config = FLAG_ORDINARY_CONFIG.operators.O03;
    const axes = config.angles.filter((axis) => options.includes(String(axis).toUpperCase()));
    const edges = [
      ['CHIEF', 'TOP'],
      ['BASE', 'BOTTOM'],
      ['HOIST', 'LEFT'],
      ['FLY', 'RIGHT'],
    ] as const;
    const selectedEdge = edges.find(([token]) => has(token))?.[1];
    const placement = selectedEdge ? 'AT_EDGE' : 'CENTER';
    return {
      axis: axes.length ? chooseUniform(axes, random) : chooseUniform(config.angles, random),
      placement,
      ...(selectedEdge ? { edge: selectedEdge } : {}),
      thickness: sampleThickness(placement === 'AT_EDGE'
        ? config.edgeThicknessDivisors
        : config.thicknessDivisors),
    };
  }
  if (type === 'O04') {
    const thicknessConfig = FLAG_ORDINARY_CONFIG.operators.O04;
    const orientations = ['RIGHT', 'DOWN', 'LEFT', 'UP'];
    const requestedOrientations = orientations.filter((orientation) => has(orientation));
    return {
      thickness: sampleThickness(thicknessConfig.thicknessDivisors),
      orientation: requestedOrientations.length
        ? chooseUniform(requestedOrientations, random)
        : chooseUniform(orientations, random),
      halfAngle: chooseUniform(thicknessConfig.halfAngles, random),
    };
  }
  if (type === 'O05') {
    const config = FLAG_ORDINARY_CONFIG.operators.O05;
    const centerCoordinate = () => {
      const minimum = Math.ceil(config.centerRange[0] * config.centerDivisor);
      const maximum = Math.floor(config.centerRange[1] * config.centerDivisor);
      return (minimum + Math.floor(random() * (maximum - minimum + 1))) / config.centerDivisor;
    };
    return {
      thickness: sampleThickness(config.thicknessDivisors),
      center: { u: centerCoordinate(), v: centerCoordinate() },
      stemDirection: weighted<string>(
        Object.fromEntries(config.stemDirections.map(({ id, weight }) => [id, weight])),
        random,
      ),
      branchAngle: Number(weighted<string>(
        Object.fromEntries(config.branchAngles.map(({ angle, weight }) => [String(angle), weight])),
        random,
      )),
    };
  }
  if (type === 'O06') {
    const config = FLAG_ORDINARY_CONFIG.operators.O06;
    const sides = ['HOIST', 'FLY', 'TOP', 'BOTTOM'];
    const requestedSides = sides.filter((side) => has(side));
    const side = requestedSides.length ? chooseUniform(requestedSides, random) : chooseUniform(sides, random);
    const horizontal = side === 'HOIST' || side === 'FLY';
    const sideLength = horizontal ? CANVAS_HEIGHT : width;
    const depthBase = horizontal ? width : CANVAS_HEIGHT;
    const baseLength = sampleRange(
      config.baseSideFraction[0] * sideLength,
      config.baseSideFraction[1] * sideLength,
      random,
    );
    const truncated = has('TRUNCATED') ||
      (has('TRUNCATED_OPTIONAL') && random() < 0.5);
    return {
      side,
      baseLength,
      depth: sampleRange(config.depthFraction[0] * depthBase, config.depthFraction[1] * depthBase, random),
      apexPosition: sampleRange(config.apexPosition[0], config.apexPosition[1], random),
      truncated,
      tipWidth: truncated
        ? sampleRange(config.truncatedTip[0] * baseLength, config.truncatedTip[1] * baseLength, random)
        : 0,
    };
  }
  if (type === 'O07') {
    const config = FLAG_ORDINARY_CONFIG.operators.O07;
    const selectedOption = options.length ? chooseUniform(options, random) : undefined;
    const isVariant = selectedOption !== undefined &&
      config.variants.includes(selectedOption as typeof config.variants[number]);
    const requestedVariants = isVariant
      ? [selectedOption as typeof config.variants[number]]
      : selectedOption
        ? ['PLAIN' as const]
        : [...config.variants];
    const minimumDimension = Math.min(width, CANVAS_HEIGHT);
    const divisorsForVariant = (variant: typeof config.variants[number]) =>
      variant === 'CHECKY' ? config.checkyThicknessDivisors : config.thicknessDivisors;
    const minimumThicknessForVariant = (variant: typeof config.variants[number]) =>
      Math.max(
        CANVAS_HEIGHT / Math.max(...divisorsForVariant(variant)),
        minimumThickness,
      );
    const feasibleVariants = requestedVariants.filter((variant) => {
      const variantThickness = minimumThicknessForVariant(variant);
      const minimumGap = variant === 'DOUBLE' || variant === 'ORLE'
        ? FLAG_ORDINARY_CONFIG.minimumGap
        : 0;
      const minimumDepth = variant === 'DOUBLE'
        ? 2 * variantThickness + minimumGap
        : variant === 'ORLE'
          ? variantThickness + minimumGap
          : variantThickness;
      return minimumDimension - 2 * minimumDepth >= minimumThickness;
    });
    if (!feasibleVariants.length) {
      throw new RangeError('У бордюра нет варианта, сохраняющего внутреннюю область не уже T_MIN');
    }
    const variant = chooseUniform(feasibleVariants, random);
    const thicknessDivisors = divisorsForVariant(variant);
    const minimumVariantThickness = minimumThicknessForVariant(variant);
    let gap: number | undefined;
    if (variant === 'DOUBLE') {
      const maximumGap = (minimumDimension - minimumThickness -
        4 * minimumVariantThickness) / 2;
      gap = sampleSnappedMeasure(FLAG_ORDINARY_CONFIG.minimumGap, maximumGap,
        FLAG_ORDINARY_CONFIG.minimumGap);
    } else if (variant === 'ORLE') {
      const maximumGap = Math.min(
        CANVAS_HEIGHT / 20,
        (minimumDimension - minimumThickness - 2 * minimumVariantThickness) / 2,
      );
      gap = sampleSnappedMeasure(FLAG_ORDINARY_CONFIG.minimumGap, maximumGap,
        FLAG_ORDINARY_CONFIG.minimumGap);
    }
    const maximumThickness = variant === 'DOUBLE'
      ? (minimumDimension - minimumThickness - 2 * gap!) / 4
      : variant === 'ORLE'
        ? (minimumDimension - minimumThickness - 2 * gap!) / 2
        : (minimumDimension - minimumThickness) / 2;
    const params: Record<string, unknown> = {
      variant,
      thickness: sampleThickness(thicknessDivisors, maximumThickness),
      ...(gap === undefined ? {} : { gap }),
    };
    const lineStyleToken = selectedOption && !isVariant
      ? selectedOption
      : undefined;
    if (lineStyleToken) {
      params.line_style = lineStyleToken.startsWith('INNER_')
        ? lineStyleToken.slice('INNER_'.length)
        : lineStyleToken;
    }
    if (variant === 'CHECKY' && ordinaryFill === config.defaultSecondaryFill) {
      params.secondary_fill = 's2';
    }
    return params;
  }
  if (type === 'O08') {
    const config = FLAG_ORDINARY_CONFIG.operators.O08;
    const corners = ['HOIST_TOP', 'FLY_TOP', 'HOIST_BOTTOM', 'FLY_BOTTOM'];
    const requestedCorner = corners.find((corner) => has(corner));
    const side = has('HOIST') ? 'HOIST' : has('FLY') ? 'FLY' : null;
    const vertical = has('TOP') ? 'TOP' : has('BOTTOM') ? 'BOTTOM' : null;
    const feasibleCorners = corners.filter((corner) =>
      (!requestedCorner || corner === requestedCorner) &&
      (!side || corner.startsWith(side)) &&
      (!vertical || corner.endsWith(vertical)),
    );
    return {
      width: sampleRange(config.widthFraction[0] * width, config.widthFraction[1] * width, random),
      height: sampleRange(config.heightFraction[0] * CANVAS_HEIGHT, config.heightFraction[1] * CANVAS_HEIGHT, random),
      corner: chooseUniform(feasibleCorners.length ? feasibleCorners : corners, random),
      ...(has('SQUARE') ? { square: true } : {}),
    };
  }
  return {};
}

function moduleId(key: string): string {
  const normalized = key.toUpperCase().replaceAll('-', '_');
  const id = MODULE_IDS[normalized] ?? (/^M(?:0[1-9]|[12]\d|30)$/.test(normalized) ? normalized : undefined);
  if (!id) throw new RangeError(`Неизвестный модуль эмблемы: ${key}`);
  return id;
}

function moduleMinimumFeatureFraction(module: string, params: Record<string, unknown>): number {
  const configuration = (FLAG_EMBLEM_CONFIG.modules as any)[module]?.qualification;
  if (!configuration || !Number.isFinite(configuration.f_min) || configuration.f_min <= 0) {
    throw new RangeError(`Для модуля ${module} не настроен f_min`);
  }
  let result = Number(configuration.f_min);
  const fMinByParameter = configuration.f_min_by_parameter as
    Record<string, Record<string, number>> | undefined;
  for (const [parameter, values] of Object.entries(fMinByParameter ?? {})) {
    const candidate = values[String(params[parameter] ?? '')];
    if (Number.isFinite(candidate)) result = Number(candidate);
  }
  if (module === 'M09' && String(params.profile ?? '').toUpperCase() === 'FLARED') {
    result = Number(params.thickness ?? result);
  }
  if (!(result > 0 && result <= 1)) throw new RangeError(`Для модуля ${module} задан некорректный f_min=${result}`);
  return result;
}

function maximumEmblemRadius(primitives: readonly EmblemPrimitive[]): number {
  let maximum = 0;
  for (const primitive of primitives) {
    if (primitive.kind === 'circle') {
      maximum = Math.max(maximum, Math.hypot(primitive.center.x, primitive.center.y) + primitive.radius);
    } else if (primitive.kind === 'ring') {
      maximum = Math.max(maximum, Math.hypot(primitive.center.x, primitive.center.y) + primitive.outerRadius);
    } else {
      for (const point of primitive.points) maximum = Math.max(maximum, Math.hypot(point.x, point.y));
    }
  }
  return maximum;
}

function chooseModuleOption(key: string, random: () => number, profileId: string): ChosenModuleOption {
  const normalized = key.toUpperCase().replaceAll('-', '_');
  const groupStart = normalized.indexOf(':');
  if (groupStart >= 0 && ['SMALL', 'SMALL_HOIST', 'ONE_MODULE'].includes(normalized.slice(0, groupStart))) {
    const alternatives = normalized.slice(groupStart + 1).split('|').map((item) => item.trim()).filter(Boolean);
    if (!alternatives.length) throw new RangeError(`В пуле «${key}» нет модулей`);
    const moduleName = chooseUniform(alternatives, random).split(':', 1)[0];
    return {
      moduleName,
      ...(normalized.startsWith('SMALL:') ? { sizeRange: [0.12, 0.3] as const } : {}),
    };
  }

  const selectInscribe = (frameText: string, moduleText: string | undefined): ChosenModuleOption => {
    const frames = frameText.split('|').map((item) => item.trim()).filter(Boolean);
    const frame = chooseUniform(frames, random);
    const contentPool = moduleText
      ? moduleText.split('|').map((item) => item.trim()).filter(Boolean)
      : [...(PROFILE_INSCRIBE_MODULES[profileId] ?? [])];
    const innerModule = chooseUniform(contentPool, random);
    const composerParams: Record<string, unknown> = {
      frame,
      scale: sampleRange(0.45, 0.7, random),
    };
    if (frame === 'SHIELD') {
      composerParams.shape = chooseUniform(
        FLAG_EMBLEM_CONFIG.geometry.shield.shapes as readonly string[],
        random,
      );
    }
    if (innerModule === 'ARC_REPEAT') {
      composerParams.innerComposer = 'ARC_REPEAT';
      composerParams.innerComposerParams = {
        count: Math.floor(sampleRange(3, 9, random)),
        sweep: sampleRange(120, 300, random),
      };
      return { moduleName: 'LENS', composer: 'INSCRIBE', composerParams };
    }
    return { moduleName: innerModule, composer: 'INSCRIBE', composerParams };
  };

  if (normalized.startsWith('INSCRIBE:')) {
    const fields = normalized.slice('INSCRIBE:'.length).split(':');
    if (fields.length >= 2) return selectInscribe(fields[0], fields.slice(1).join(':'));
    const plus = fields[0].split('+');
    if (plus.length === 2) return selectInscribe(plus[0], plus[1]);
    return selectInscribe(fields[0], undefined);
  }
  if (normalized.startsWith('HOIST_BADGE:INSCRIBE_')) {
    const frameText = normalized.slice('HOIST_BADGE:INSCRIBE_'.length);
    return { ...selectInscribe(frameText, undefined), anchor: 'A11' };
  }
  if (normalized === 'CONSTELLATION') {
    const presets = Object.keys(FLAG_PLACEMENT_CONFIG.repeaters.constellations);
    return {
      moduleName: 'STAR',
      composer: 'CONSTELLATION',
      composerParams: { preset: chooseUniform(presets, random) },
    };
  }
  if (normalized.startsWith('CRESCENT:1_5_STARS_IN_HORNS') ||
    normalized.startsWith('CRESCENT:1_5_STARS')) {
    const count = Math.floor(sampleRange(1, 6, random));
    const positions = count === 1
      ? [{ u: sampleRange(0.68, 0.88, random), v: sampleRange(0.44, 0.56, random) }]
      : Array.from({ length: count }, (_, index) => ({
        u: 0.61 + (0.28 * index) / (count - 1),
        v: 0.5,
      }));
    return { moduleName: 'CRESCENT', composer: 'OVERLAY', composerParams: { positions } };
  }
  if (normalized === 'CRESCENT+STAR') {
    return {
      moduleName: 'CRESCENT',
      composer: 'OVERLAY',
      composerParams: { positions: [{ u: sampleRange(0.68, 0.88, random), v: sampleRange(0.44, 0.56, random) }] },
    };
  }
  if (normalized.startsWith('CRESCENT+CONSTELLATION')) {
    const presets = Object.keys(FLAG_PLACEMENT_CONFIG.repeaters.constellations);
    return {
      moduleName: 'CRESCENT',
      composer: 'OVERLAY',
      composerParams: {
        preset: chooseUniform(presets, random),
        scaleX: 0.45,
        scaleY: 0.6,
        offsetX: 0.14,
      },
    };
  }
  if (normalized.startsWith('CROSSED:')) {
    return { moduleName: normalized.slice('CROSSED:'.length).split('|')[0].split(':')[0], composer: 'CROSSED' };
  }
  if (normalized.includes('+')) {
    const [outer, inner] = normalized.split('+');
    return {
      moduleName: outer,
      composer: 'CHARGE_ON_CHARGE',
      composerParams: { innerModule: inner },
    };
  }
  return { moduleName: normalized.split(':', 1)[0] };
}

function sampleRange(minimum: number, maximum: number, random: () => number): number {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum < minimum) {
    throw new RangeError(`Недопустимый диапазон размера ${minimum}..${maximum}`);
  }
  return minimum + random() * (maximum - minimum);
}

function ordinaryThickness(draft: ProfiledDraft, types: readonly FlagOrdinaryType[]): number | null {
  const ordinary = draft.ordinarySpecs.find(({ type }) => types.includes(type));
  if (!ordinary) return null;
  const requested = Number(ordinary.params?.thickness);
  if (Number.isFinite(requested) && requested > 0) return requested / CANVAS_HEIGHT;
  const divisor = (FLAG_ORDINARY_CONFIG.operators as any)[ordinary.type]?.defaultThicknessDivisor;
  return Number.isFinite(divisor) && divisor > 0 ? 1 / divisor : null;
}

function pileInteriorDistance(draft: ProfiledDraft): number | null {
  const pile = draft.ordinarySpecs.find(({ type }) => type === 'O06');
  const layer = draft.ordinaryPaint?.paintLayers.find((candidate) => String(candidate.id).includes(pile?.id ?? '\u0000'));
  const polygon = layer?.polygons?.[0];
  if (!polygon || polygon.length < 3) return null;
  const center = polygonCentroid(polygon);
  let minimum = Infinity;
  for (let index = 0; index < polygon.length; index += 1) {
    const first = polygon[index], second = polygon[(index + 1) % polygon.length];
    const dx = second.x - first.x, dy = second.y - first.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((center.x - first.x) * dx + (center.y - first.y) * dy) / lengthSquared)) : 0;
    minimum = Math.min(minimum, Math.hypot(center.x - (first.x + t * dx), center.y - (first.y + t * dy)));
  }
  return minimum / CANVAS_HEIGHT;
}

function anchorSizeBounds(
  anchor: FlagChargeAnchor,
  draft: ProfiledDraft,
  virtualCantonSize?: { w: number; h: number },
  regionMinDistance?: number,
): [number, number] {
  if (anchor === 'A1') return [0.25, 0.6];
  if (anchor === 'A2') return [0.25, 0.55];
  if (anchor === 'A3') {
    const thickness = ordinaryThickness(draft, ['O01', 'O02', 'O05']);
    if (thickness === null) throw new RangeError('A3 требует толщину CROSS, SALTIRE или PALL');
    return [Math.max(0.12, 0.7 * thickness), 0.95 * thickness];
  }
  if (anchor === 'A4') {
    const canton = draft.ordinaryPaint?.paintLayers.filter((layer) => layer.kind === 'canton') ?? [];
    let width: number, height: number;
    if (canton.length) {
      const points = canton.flatMap((layer) => layer.polygons.flat());
      width = (Math.max(...points.map(({ x }) => x)) - Math.min(...points.map(({ x }) => x))) /
        (CANVAS_HEIGHT * (draft.aspect ?? 1.5));
      height = (Math.max(...points.map(({ y }) => y)) - Math.min(...points.map(({ y }) => y))) / CANVAS_HEIGHT;
    } else if (virtualCantonSize) {
      width = virtualCantonSize.w * (draft.aspect ?? 1.5);
      height = virtualCantonSize.h;
    } else {
      const config = FLAG_PLACEMENT_CONFIG.anchors;
      width = Math.max(...config.virtualCantonWidths) * (draft.aspect ?? 1.5);
      height = Math.max(...config.virtualCantonHeights);
    }
    return [0.55 * Math.min(width, height), 0.8 * Math.min(width, height)];
  }
  if (anchor === 'A5') {
    const thickness = ordinaryThickness(draft, ['O01', 'O02']);
    const dMin = regionMinDistance ?? (thickness === null ? 0.25 : Math.max(0.12, 0.25 - thickness / 2));
    return [0.12, Math.min(0.3, 1.6 * dMin)];
  }
  if (anchor === 'A6') {
    const bands = Math.max(1, Number(draft.fieldParams?.bands ?? 3));
    const axis = String(draft.fieldParams?.axis ?? 'H').toUpperCase();
    const stripeThickness = (axis === 'V' ? (draft.aspect ?? 1.5) : 1) / bands;
    return [0.5 * stripeThickness, 0.85 * stripeThickness];
  }
  if (anchor === 'A7') return [0.2, 0.45];
  if (anchor === 'A8') return [0.1, 0.2];
  if (anchor === 'A9') {
    const dMin = pileInteriorDistance(draft);
    if (dMin === null) throw new RangeError('A9 требует внутреннюю область PILE');
    return [0.12, 1.6 * dMin];
  }
  if (anchor === 'A10') return [0.15, 0.3];
  if (anchor === 'A11') return draft.chargeCount > 1 ? [0.3, 0.3] : [0.3, 0.55];
  throw new RangeError(`Неизвестный якорь ${anchor}`);
}

function sampleAnchorSize(
  anchor: FlagChargeAnchor,
  draft: ProfiledDraft,
  random: () => number,
  minimumDiameterUnits: number,
  virtualCantonSize?: { w: number; h: number },
  regionMinDistance?: number,
  requestedRange?: readonly [number, number],
  maximumFeasibleSize = 1,
): number {
  const [minimum, maximum] = anchorSizeBounds(anchor, draft, virtualCantonSize, regionMinDistance);
  const [globalMinimum, globalMaximum] = FLAG_PLACEMENT_CONFIG.anchors.sizeRange;
  const lowerBound = Math.max(
    minimum, minimumDiameterUnits / CANVAS_HEIGHT, requestedRange?.[0] ?? 0, globalMinimum,
  );
  const upperBound = Math.min(maximum, requestedRange?.[1] ?? 1, maximumFeasibleSize, globalMaximum);
  if (upperBound < lowerBound) {
    throw new RangeError(`Якорь ${anchor} исключён: диапазон ${lowerBound}..${upperBound} пуст`);
  }
  return sampleRange(lowerBound, upperBound, random);
}

function createChargeNode(
  module: string,
  composer?: string,
  random?: () => number,
  composerParams?: Record<string, unknown>,
  maximumSize = Number.POSITIVE_INFINITY,
): EmblemNode {
  const normalizedModule = module.toUpperCase().replaceAll('-', '_');
  const id = moduleId(module);
  const params = { ...(FLAG_EMBLEM_CONFIG.modules as any)[id].defaults };
  const seeded = random ?? (() => 0.5);
  if (id === 'M03') {
    const pointCounts = [5, 6, 8, 12, 24];
    const points = pointCounts[Math.floor(seeded() * pointCounts.length)];
    const angle = FLAG_EMBLEM_CONFIG.geometry.star.minimumPointAngleDegrees * Math.PI / 180;
    const tangent = Math.tan(angle / 2);
    const minimumRatio = tangent /
      (Math.sin(Math.PI / points) + tangent * Math.cos(Math.PI / points));
    params.points = points;
    params.innerRatio = sampleRange(
      Math.max(FLAG_EMBLEM_CONFIG.geometry.star.minimumInnerRatio, minimumRatio),
      FLAG_EMBLEM_CONFIG.geometry.star.maximumInnerRatio,
      seeded,
    );
  }
  if (id === 'M06') {
    const innerRatio = sampleRange(0.7, 0.92, seeded);
    params.innerRatio = innerRatio;
    params.offsetRatio = sampleRange(Math.max(0.2, 1 - innerRatio + 0.001), 0.55, seeded);
    params.rotation = chooseUniform([0, 45, 90, 135, 180, 225, 270, 315], seeded);
  }
  if (id === 'M08') {
    const isGear = normalizedModule === 'GEAR';
    params.spokes = isGear
      ? chooseUniform([8, 9, 10, 11, 12, 13, 14, 15, 16], seeded)
      : chooseUniform([6, 8, 12, 16, 24], seeded);
    params.innerRatio = sampleRange(0.45, 0.85, seeded);
    params.hubRatio = sampleRange(0.12, 0.25, seeded);
    params.gear = isGear;
    if (isGear) params.teeth = chooseUniform([8, 9, 10, 11, 12, 13, 14, 15, 16], seeded);
  }
  if (id === 'M21') {
    const configuration = FLAG_EMBLEM_CONFIG.geometry.waves;
    params.bands = chooseUniform(configuration.bandCounts, seeded);
    params.amplitude = sampleRange(...configuration.amplitudeRange, seeded);
    params.wavelength = sampleRange(...configuration.wavelengthRange, seeded);
    params.phase = sampleRange(...configuration.phaseRange, seeded);
    params.clipShape = chooseUniform(configuration.clipShapes, seeded);
  }
  if (id === 'M14') {
    const pointCounts = FLAG_EMBLEM_CONFIG.geometry.crown.allowedPoints.filter((points) =>
      FLAG_GENERATOR_CONFIG.physical.minimumThickness /
        moduleMinimumFeatureFraction(id, { ...params, points }) /
        CANVAS_HEIGHT <= maximumSize,
    );
    if (!pointCounts.length) {
      throw new RangeError(`Модуль ${id}: нет допустимого числа точек, помещающегося в доступные якоря`);
    }
    params.points = chooseUniform(pointCounts, seeded);
    params.dots = false;
  }
  if (id === 'M07') {
    const allowed = (FLAG_EMBLEM_CONFIG.modules.M07 as any).qualification.allowed_parameter_sets as Record<string, unknown>[];
    const feasible = allowed.filter((candidate) =>
      FLAG_GENERATOR_CONFIG.physical.minimumThickness /
        moduleMinimumFeatureFraction(id, { ...params, ...candidate }) /
        CANVAS_HEIGHT <= maximumSize,
    );
    if (!feasible.length) {
      throw new RangeError(`Модуль ${id}: нет допустимого набора параметров, помещающегося в доступные якоря`);
    }
    Object.assign(params, chooseUniform(feasible, seeded));
  }
  if (id === 'M24') params.canvasHeight = CANVAS_HEIGHT;
  const child: EmblemNode = { module: id as any, params };
  if (!composer || composer === 'SINGLE') return child;
  if (composer === 'ARC_REPEAT') {
    const leaf: EmblemNode = { module: 'M11', params: { length: 0.2, width: 0.08 } };
    const countRange = (composerParams?.countRange as readonly [number, number] | undefined) ?? [6, 14];
    const count = Math.floor(sampleRange(countRange[0], countRange[1], seeded));
    const sweep = sampleRange(120, 300, seeded);
    return { composer: 'ARC_REPEAT', params: { count, sweep }, children: [leaf] };
  }
  if (composer === 'CHARGE_ON_CHARGE') {
    const innerModule = String(composerParams?.innerModule ?? 'DISC');
    const inner = createChargeNode(innerModule, 'SINGLE', seeded);
    const smallScale = chooseUniform([0.4, 0.5, 0.6], seeded);
    return { composer: 'CHARGE_ON_CHARGE', params: { smallScale }, children: [inner, child] };
  }
  if (composer === 'FLANK') return { composer: 'FLANK', children: [child, child, child] };
  if (composer === 'CONCENTRIC') return { composer: 'CONCENTRIC', params: { rings: (random?.() ?? 0) < 0.6 ? 1 : 2 }, children: [child] };
  if (composer === 'PAIR_MIRROR') {
    const gaps = [0.2, 0.3, 0.5];
    const weights = [2, 2, 1];
    const target = (random?.() ?? 0) * 5;
    const index = target < weights[0] ? 0 : target < weights[0] + weights[1] ? 1 : 2;
    return { composer: 'PAIR_MIRROR', params: { gap: gaps[index] }, children: [child] };
  }
  if (composer === 'INSCRIBE') {
    const params: Record<string, unknown> = {
      ...(FLAG_EMBLEM_CONFIG.composers.INSCRIBE as any).defaults,
      ...composerParams,
    };
    const nestedComposer = String(params.innerComposer ?? '');
    delete params.innerComposer;
    const nestedParams = params.innerComposerParams as Record<string, unknown> | undefined;
    delete params.innerComposerParams;
    let content = child;
    if (nestedComposer === 'ARC_REPEAT') {
      content = {
        composer: 'ARC_REPEAT',
        params: nestedParams ?? {},
        children: [{ module: 'M11', params: { length: 0.2, width: 0.08 } }],
      };
    }
    return {
      composer: 'INSCRIBE',
      params,
      children: [content],
    };
  }
  if (composer === 'CONSTELLATION') {
    return { composer: 'CONSTELLATION', params: { ...composerParams }, children: [child] };
  }
  if (composer === 'OVERLAY') {
    const star = createChargeNode('STAR', 'SINGLE', seeded);
    const constellation: EmblemNode = {
      composer: 'CONSTELLATION',
      params: { ...composerParams },
      children: [star],
    };
    return { composer: 'OVERLAY', children: [child, constellation] };
  }
  return { composer: composer as any, children: [child] };
}

function primitiveShape(
  primitive: EmblemPrimitive,
  x: number,
  y: number,
  diameter: number,
  rotation = 0,
  mirror = false,
): JsonObject {
  const transformPoint = (point: { x: number; y: number }) => {
    // Примитивы заданы относительно центра эмблемы, поэтому вращать нужно вокруг (0, 0).
    let dx = point.x, dy = point.y;
    if (mirror) dx = -dx;
    const angle = rotation * Math.PI / 180;
    return {
      x: x + (dx * Math.cos(angle) - dy * Math.sin(angle)) * diameter,
      y: y + (dx * Math.sin(angle) + dy * Math.cos(angle)) * diameter,
    };
  };
  if (primitive.kind === 'polygon') {
    return { type: 'polygon', points: primitive.points.map(transformPoint) };
  }
  if (primitive.kind === 'circle') {
    const center = transformPoint(primitive.center);
    return { type: 'circle', cx: center.x, cy: center.y, radius: primitive.radius * diameter };
  }
  const center = transformPoint(primitive.center);
  return {
    type: 'ring', cx: center.x, cy: center.y,
    outerRadius: primitive.outerRadius * diameter, innerRadius: primitive.innerRadius * diameter,
  };
}

function addLayer(
  nodes: FlagNode[],
  id: string,
  role: FlagLayer['role'],
  shape: JsonObject,
  fill: string,
  tags: string[],
  cost: number,
): void {
  let uniqueId = id;
  let suffix = 1;
  while (nodes.some((node) => node.kind === 'layer' && node.layer.id === uniqueId)) {
    uniqueId = `${id}-${suffix}`;
    suffix += 1;
  }
  nodes.push({
    kind: 'layer',
    layer: { id: uniqueId, role, shape, transform: {}, fill, clip: [], tags, cost },
  });
}

function prepareCantonSpec(
  draft: ProfiledDraft,
  width: number,
  height: number,
  random: () => number,
): FlagOrdinarySpec | null {
  const canton = draft.ordinarySpecs.find(({ type }) => type === 'O08');
  if (!canton) return null;
  const params = { ...(canton.params ?? {}) };
  const unionProfile = draft.profile.id === 'P13';
  const gridProfile = draft.profile.id === 'P18';
  if (unionProfile || gridProfile) params.corner = 'HOIST_TOP';
  if (gridProfile) params.square = false;
  else if (params.corner === undefined) {
    params.corner = chooseUniform(['HOIST_TOP', 'FLY_TOP', 'HOIST_BOTTOM', 'FLY_BOTTOM'], random);
  }
  if (params.square === true) {
    let minSide = Math.max(width * 0.25, height * 0.25);
    const maxSide = Math.min(width * 0.5, height * 0.6);
    if (gridProfile) {
      const star = createChargeNode('STAR', 'SINGLE', random);
      const minDiameter = FLAG_GENERATOR_CONFIG.physical.minimumThickness /
        moduleMinimumFeatureFraction(moduleId('STAR'), star.params as Record<string, unknown>);
      minSide = Math.max(minSide, (2.5 / 0.92) * minDiameter + FLAG_PLACEMENT_CONFIG.anchors.safeMargin * 2);
    }
    if (minSide > maxSide) throw new FlagGenerationAttemptError('S4_COMPOSITION', 'Кантон P18 недостаточно велик для безопасной звёздной сетки');
    const side = sampleRange(minSide, maxSide, random);
    params.width = side;
    params.height = side;
  } else if (gridProfile) {
    const star = createChargeNode('STAR', 'SINGLE', random);
    const minDiameter = FLAG_GENERATOR_CONFIG.physical.minimumThickness /
      moduleMinimumFeatureFraction(moduleId('STAR'), star.params as Record<string, unknown>);
    const margin = FLAG_PLACEMENT_CONFIG.anchors.safeMargin;
    const minWidth = Math.max(width * 0.25, (2.5 / 0.92) * minDiameter + margin * 2);
    const minHeight = Math.max(height * 0.25, (1 / 0.92) * minDiameter + margin * 2);
    const maxWidth = width * 0.5;
    const maxHeight = height * 0.6;
    if (minWidth > maxWidth || minHeight > maxHeight) {
      throw new FlagGenerationAttemptError('S4_COMPOSITION', 'Кантон P18 недостаточно велик для безопасной звёздной сетки');
    }
    params.width = sampleRange(minWidth, maxWidth, random);
    params.height = sampleRange(minHeight, maxHeight, random);
  } else {
    params.width ??= sampleRange(width * 0.25, width * 0.5, random);
    params.height ??= sampleRange(height * 0.25, height * 0.6, random);
  }
  canton.params = params;
  if (gridProfile) canton.fill = 's3';
  if (unionProfile) canton.children = [makeP13UnionMotif(random, height)];
  return canton;
}

function makeP13UnionMotif(random: () => number, height: number): FlagOrdinarySpec {
  const nSaltire = chooseUniform([1, 2], random);
  const nCross = chooseUniform([0, 1, 2], random);
  const params: Record<string, unknown> = {
    n_saltire: nSaltire,
    n_cross: nCross,
    center: { u: 0.5, v: 0.5 },
    thickness: sampleRange(height / 12, height / 4, random),
    field_fill: 's2',
    saltire_fill: 's3',
    second_saltire_fill: 's4',
    cross_fill: 's4',
    second_cross_fill: 's3',
    secondary_slot: 's4',
    pinwheel: random() < 0.5,
  };
  if (nSaltire === 2) params.second_saltire_ratio = sampleRange(0.3, 0.5, random);
  if (nCross === 2) params.second_cross_ratio = sampleRange(0.4, 0.7, random);
  if (params.pinwheel) params.pinwheel_shift = sampleRange(0, 0.5, random);
  for (let index = 1; index <= nSaltire; index += 1) {
    if (random() < 0.5) {
      params[`fimbration_saltire_${index}`] = { delta: sampleRange(30, 60, random), fill: 's4' };
    }
  }
  for (let index = 1; index <= nCross; index += 1) {
    if (random() < 0.5) {
      params[`fimbration_cross_${index}`] = { delta: sampleRange(30, 60, random), fill: 's4' };
    }
  }
  return { id: 'p13-union-motif', type: 'O09', params };
}

function allocateCantonSlot(slots: Set<string>, excluded: string[] = []): string {
  const slot = SYMBOLIC_SLOTS.find((candidate) => !slots.has(candidate) && !excluded.includes(candidate)) ??
    SYMBOLIC_SLOTS.find((candidate) => !excluded.includes(candidate)) ??
    SYMBOLIC_SLOTS[0];
  slots.add(slot);
  return slot;
}

function cantonModulePool(profile: FlagProfileConfig, minimumSize: number): FlagProfileWeights {
  const source = profile.CHG?.modules ?? {};
  const allowed = new Set(['STAR', 'DISC', 'SUN', 'CROSS_EMB', 'CRESCENT', 'POLYGON', 'WHEEL', 'LILY', 'SHIELD']);
  const result: FlagProfileWeights = {};
  for (const [key, weight] of Object.entries(source)) {
    const separator = key.indexOf(':');
    const family = (separator < 0 ? key : key.slice(0, separator)).toUpperCase().replaceAll('-', '_');
    if (['SMALL', 'SMALL_HOIST', 'ONE_MODULE'].includes(family) && separator >= 0) {
      const alternatives = key.slice(separator + 1).split('|').map((name) => name.trim())
        .filter((name) => allowed.has(name.toUpperCase().replaceAll('-', '_')))
        .filter((name) => {
          const id = moduleId(name);
          const defaults = (FLAG_EMBLEM_CONFIG.modules as any)[id].defaults as Record<string, unknown>;
          return FLAG_GENERATOR_CONFIG.physical.minimumThickness /
            moduleMinimumFeatureFraction(id, defaults) <= minimumSize * 0.7;
        });
      if (alternatives.length) result[`${family}:${alternatives.join('|')}`] = weight;
      continue;
    }
    if (!allowed.has(family)) continue;
    const id = moduleId(family);
    const defaults = (FLAG_EMBLEM_CONFIG.modules as any)[id].defaults as Record<string, unknown>;
    if (FLAG_GENERATOR_CONFIG.physical.minimumThickness /
      moduleMinimumFeatureFraction(id, defaults) <= minimumSize * 0.7) result[key] = weight;
  }
  return result;
}

function buildP18StarGrid(
  canton: NonNullable<ProfiledDraft['ordinaryPaint']>['paintLayers'][number],
  width: number,
  height: number,
  random: () => number,
): { shape: JsonObject; cost: number } {
  const polygon = canton.polygons[0];
  if (!polygon?.length) throw new FlagGenerationAttemptError('S4_COMPOSITION', 'У кантона P18 отсутствует видимая рамка для звёздной сетки');
  const bounds = polygon.reduce((box, point) => ({
    minX: Math.min(box.minX, point.x), minY: Math.min(box.minY, point.y),
    maxX: Math.max(box.maxX, point.x), maxY: Math.max(box.maxY, point.y),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  const margin = FLAG_PLACEMENT_CONFIG.anchors.safeMargin;
  const innerWidth = bounds.maxX - bounds.minX - margin * 2;
  const innerHeight = bounds.maxY - bounds.minY - margin * 2;
  const node = createChargeNode('STAR', 'SINGLE', random);
  const built = validateFlagEmblem(node, { canvasHeight: height, scale: 1, rng: random });
  const module = moduleId('STAR');
  const minimumDiameter = FLAG_GENERATOR_CONFIG.physical.minimumThickness /
    moduleMinimumFeatureFraction(module, node.params as Record<string, unknown>);
  const feasibleGrids: Array<{ rows: number; columns: number; stepX: number; stepY: number; diameter: number }> = [];
  for (let rows = 1; rows <= 1; rows += 1) {
    for (let columns = 2; columns <= 13; columns += 1) {
      const stepX = innerWidth / (columns + 0.5);
      const stepY = innerHeight / rows;
      const diameter = Math.min(stepX, stepY) * 0.92;
      if (diameter >= minimumDiameter) feasibleGrids.push({ rows, columns, stepX, stepY, diameter });
    }
  }
  if (!feasibleGrids.length) {
    throw new FlagGenerationAttemptError('S4_COMPOSITION', 'Кантон P18 недостаточно велик для безопасной звёздной сетки');
  }
  const { rows, columns, stepX, stepY, diameter } = chooseUniform(feasibleGrids, random);
  const starDiameter = sampleRange(minimumDiameter, diameter, random);
  const polygons: { x: number; y: number }[][] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const centerX = bounds.minX + margin + (column + 0.5 + (row % 2) * 0.5) * stepX;
      const centerY = bounds.minY + margin + (row + 0.5) * stepY;
      for (const primitive of built.primitives) {
        const shape = primitiveShape(primitive, width / 2, height / 2, starDiameter);
        if (shape.type !== 'polygon' || !Array.isArray(shape.points)) {
          throw new FlagGenerationAttemptError('S4_COMPOSITION', 'Звёзды кантона P18 должны быть полигональными');
        }
        polygons.push((shape.points as { x: number; y: number }[]).map((point) => ({
          x: point.x + centerX - width / 2,
          y: point.y + centerY - height / 2,
        })));
      }
    }
  }
  return {
    shape: { type: 'multipolygon', polygons },
    cost: calculateFlagEmblemCost(node) + Math.min(
      FLAG_EMBLEM_CONFIG.costs.repeatPerCopy * polygons.length,
      FLAG_EMBLEM_CONFIG.costs.repeatMaximumSurcharge,
    ),
  };
}

function addGenericCantonEmblem(
  draft: ProfiledDraft,
  canton: NonNullable<ProfiledDraft['ordinaryPaint']>['paintLayers'][number],
  width: number,
  height: number,
  random: () => number,
  slots: Set<string>,
  layers: FlagNode[],
): number {
  const polygon = canton.polygons[0];
  if (!polygon?.length) throw new FlagGenerationAttemptError('S4_COMPOSITION', 'У кантона отсутствует видимая рамка для эмблемы');
  const bounds = polygon.reduce((box, point) => ({
    minX: Math.min(box.minX, point.x), minY: Math.min(box.minY, point.y),
    maxX: Math.max(box.maxX, point.x), maxY: Math.max(box.maxY, point.y),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  const minimumFrameSize = Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const modulePool = cantonModulePool(draft.chargeProfile, minimumFrameSize);
  if (!Object.keys(modulePool).length) {
    throw new FlagGenerationAttemptError('S4_COMPOSITION', `В пуле ${draft.chargeProfile.id} нет физически допустимого модуля для кантона`);
  }
  const composerSource = draft.chargeProfile.CHG?.composers ?? {};
  const hasStar = Object.keys(modulePool).some((key) => {
    const [family, alternatives = ''] = key.toUpperCase().replaceAll('-', '_').split(':');
    return family === 'STAR' || ['SMALL', 'SMALL_HOIST', 'ONE_MODULE'].includes(family) &&
      alternatives.split('|').includes('STAR');
  });
  const composerWeights: FlagProfileWeights = {
    SINGLE: Object.entries(composerSource).find(([name]) => name.split(':', 1)[0].toUpperCase() === 'SINGLE')?.[1] ?? null,
    CONSTELLATION: hasStar
      ? Object.entries(composerSource).find(([name]) => name.split(':', 1)[0].toUpperCase() === 'CONSTELLATION')?.[1] ?? null
      : 0,
  };
  const composer = weighted<string>(composerWeights, random);
  const composerParams = composer === 'CONSTELLATION'
    ? { preset: chooseUniform(Object.keys(FLAG_PLACEMENT_CONFIG.repeaters.constellations), random) }
    : undefined;
  const moduleKey = composer === 'CONSTELLATION'
    ? weighted<string>(Object.fromEntries(Object.entries(modulePool).flatMap(([key, weight]) => {
      const normalized = key.toUpperCase().replaceAll('-', '_');
      const separator = normalized.indexOf(':');
      if (separator < 0) return normalized === 'STAR' || normalized.startsWith('STAR:') ? [[key, weight]] : [];
      const family = normalized.slice(0, separator);
      if (['SMALL', 'SMALL_HOIST', 'ONE_MODULE'].includes(family) &&
        normalized.slice(separator + 1).split('|').includes('STAR')) {
        return [[`${family}:STAR`, weight]];
      }
      return family === 'STAR' ? [[key, weight]] : [];
    })), random)
    : weighted<string>(modulePool, random);
  const selectedModule = chooseModuleOption(moduleKey, random, draft.chargeSourceProfileId);
  const module = moduleId(selectedModule.moduleName);
  const node = createChargeNode(selectedModule.moduleName, composer, random, composerParams);
  const built = validateFlagEmblem(node, { canvasHeight: height, scale: 1, rng: random });
  const minimumDiameter = FLAG_GENERATOR_CONFIG.physical.minimumThickness /
    moduleMinimumFeatureFraction(module, node.params as Record<string, unknown>);
  const lower = Math.max(minimumFrameSize * 0.35, minimumDiameter);
  const upper = minimumFrameSize * 0.7;
  if (lower > upper) {
    throw new FlagGenerationAttemptError('S4_COMPOSITION', `Модуль ${module} не помещается в рамку кантона`);
  }
  const diameter = sampleRange(lower, upper, random);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const backgroundSlot = typeof canton.fill === 'string' ? canton.fill : 's2';
  const outerSlot = allocateCantonSlot(slots, [backgroundSlot]);
  const hasInner = built.primitives.some(({ fill }) => fill !== 'outer');
  const innerSlot = hasInner ? allocateCantonSlot(slots, [backgroundSlot, outerSlot]) : outerSlot;
  for (let index = 0; index < built.primitives.length; index += 1) {
    const primitive = built.primitives[index];
    const fill = primitive.fill === 'outer' ? outerSlot : innerSlot;
    slots.add(fill);
    addLayer(layers, `canton-emblem-${index}`, 'charge',
      primitiveShape(primitive, centerX, centerY, diameter), fill,
      ['charge', module, ...(composer === 'CONSTELLATION' ? ['repeat'] : [])],
      built.cost / Math.max(1, built.primitives.length));
  }
  return calculateFlagEmblemCost(node);
}

interface GeneratorPlacementReferences extends PlacementReferences {
  regionMinDistance?: number;
}

function polygonCentroid(points: readonly { x: number; y: number }[]): { x: number; y: number } {
  let twiceArea = 0, x = 0, y = 0;
  for (let index = 0; index < points.length; index += 1) {
    const first = points[index], second = points[(index + 1) % points.length];
    const cross = first.x * second.y - second.x * first.y;
    twiceArea += cross;
    x += (first.x + second.x) * cross;
    y += (first.y + second.y) * cross;
  }
  if (Math.abs(twiceArea) < 1e-9) throw new RangeError('Нельзя найти центр вырожденной области');
  return { x: x / (3 * twiceArea), y: y / (3 * twiceArea) };
}

type A5RegionGeometry = { quarters: { u: number; v: number }[]; regionMinDistance: number };

const a5RegionReferenceCache = new WeakMap<object, WeakMap<object, A5RegionGeometry | null>>();

function a5RegionReferences(
  draft: ProfiledDraft,
  field: FlagFieldResult,
): A5RegionGeometry | null {
  const fieldKey = field as object;
  const ordinaryKey = (draft.ordinaryPaint ?? draft) as object;
  let byOrdinary = a5RegionReferenceCache.get(fieldKey);
  if (!byOrdinary) {
    byOrdinary = new WeakMap<object, A5RegionGeometry | null>();
    a5RegionReferenceCache.set(fieldKey, byOrdinary);
  }
  if (byOrdinary.has(ordinaryKey)) return byOrdinary.get(ordinaryKey) ?? null;
  const remember = (geometry: A5RegionGeometry | null) => {
    byOrdinary!.set(ordinaryKey, geometry);
    return geometry;
  };
  const columns = 120, rows = 80;
  const labels = new Int16Array(columns * rows).fill(-1);
  const width = CANVAS_HEIGHT * (draft.aspect ?? 1.5);
  const ordinaryPolygons = (draft.ordinaryPaint?.paintLayers ?? []).flatMap((layer) => layer.polygons);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = ((column + 0.5) / columns) * width;
      const y = ((row + 0.5) / rows) * CANVAS_HEIGHT;
      if (!containsPolygon(x, y, draft.outline!.boundary)) continue;
      if (ordinaryPolygons.some((polygon) => containsPolygon(x, y, polygon))) continue;
      const regionIndex = field.regions.findIndex((region) =>
        region.visiblePolygons.some((polygon) => containsPolygon(x, y, polygon)),
      );
      if (regionIndex >= 0) labels[row * columns + column] = regionIndex;
    }
  }
  const visited = new Uint8Array(labels.length);
  const components: { label: number; cells: number[]; u: number; v: number; dMin: number }[] = [];
  const neighbors = [-columns, 1, columns, -1];
  for (let start = 0; start < labels.length; start += 1) {
    if (labels[start] < 0 || visited[start]) continue;
    const label = labels[start], queue = [start], cells: number[] = [];
    visited[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      cells.push(current);
      const row = Math.floor(current / columns), column = current % columns;
      for (const offset of neighbors) {
        const next = current + offset;
        if (next < 0 || next >= labels.length || visited[next] || labels[next] !== label) continue;
        const nextRow = Math.floor(next / columns), nextColumn = next % columns;
        if (Math.abs(nextRow - row) + Math.abs(nextColumn - column) !== 1) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }
    if (cells.length < 4) continue;
    const columnSum = cells.reduce((sum, cell) => sum + (cell % columns + 0.5), 0);
    const rowSum = cells.reduce((sum, cell) => sum + (Math.floor(cell / columns) + 0.5), 0);
    const centerColumn = columnSum / cells.length;
    const centerRow = rowSum / cells.length;
    const cellSet = new Set(cells);
    const boundary = cells.filter((cell) => {
      const row = Math.floor(cell / columns), column = cell % columns;
      return row === 0 || row === rows - 1 || column === 0 || column === columns - 1 ||
        neighbors.some((offset) => {
          const next = cell + offset;
          const nextRow = Math.floor(next / columns), nextColumn = next % columns;
          return next < 0 || next >= labels.length || Math.abs(nextRow - row) + Math.abs(nextColumn - column) !== 1 ||
            !cellSet.has(next);
        });
    });
    const dMin = Math.min(...boundary.map((cell) => {
      const row = Math.floor(cell / columns), column = cell % columns;
      return Math.hypot((column + 0.5 - centerColumn) * (draft.aspect ?? 1.5) / columns,
        (row + 0.5 - centerRow) / rows) / Math.min(1, draft.aspect ?? 1.5);
    }));
    components.push({
      label,
      cells,
      u: centerColumn / columns,
      v: centerRow / rows,
      dMin,
    });
  }
  components.sort((first, second) => second.cells.length - first.cells.length);
  if (components.length < 4) return remember(null);
  const selected = components.slice(0, 4).sort((first, second) => first.v - second.v || first.u - second.u);
  return remember({
    quarters: selected.map(({ u, v }) => ({ u, v })),
    regionMinDistance: Math.min(...selected.map(({ dMin }) => dMin)),
  });
}

function canPlaceA5(
  draft: ProfiledDraft,
  field: FlagFieldResult,
  geometry?: A5RegionGeometry | null,
): boolean {
  if (!draft.outline || !draft.aspect) return false;
  const candidateGeometry = geometry === undefined ? a5RegionReferences(draft, field) : geometry;
  if (!candidateGeometry || Math.min(0.3, 1.6 * candidateGeometry.regionMinDistance) < 0.12) return false;
  try {
    resolveChargeGroupPlacements({
      anchor: 'A5',
      frame: { w: draft.aspect, h: 1 },
      safeArea: draft.outline.safe_area,
      size: 0.12,
      snapAlreadyApplied: true,
      references: { quarters: candidateGeometry.quarters },
      canvasHeight: CANVAS_HEIGHT,
      rng: () => 0.5,
    });
    return true;
  } catch {
    return false;
  }
}

function ordinaryBandCenterReference(draft: ProfiledDraft): { u: number; v: number } {
  const ordinary = draft.ordinarySpecs.find(({ type }) => type === 'O03');
  if (!ordinary) throw new RangeError('Якорь A6 требует полосу O03 или поле G02');
  const params = ordinary.params ?? {};
  const config = FLAG_ORDINARY_CONFIG.operators.O03;
  const aspect = draft.aspect ?? 1.5;
  const width = CANVAS_HEIGHT * aspect;
  const rawAxis = String(params.axis ?? config.defaultAxis).toUpperCase();
  const angle = rawAxis === 'DIAGONAL'
    ? Math.atan2(1, aspect) * 180 / Math.PI
    : Number(rawAxis);
  if (!Number.isFinite(angle)) throw new RangeError(`Некорректная ось O03: ${rawAxis}`);
  const placement = String(params.placement ?? 'CENTER').toUpperCase();
  let u = 0.5;
  let v = 0.5;
  if (placement === 'AT_EDGE') {
    const edge = String(params.edge ?? 'TOP').toUpperCase();
    const edgeCenters: Record<string, { u: number; v: number }> = {
      TOP: { u: 0.5, v: 0 },
      RIGHT: { u: 1, v: 0.5 },
      BOTTOM: { u: 0.5, v: 1 },
      LEFT: { u: 0, v: 0.5 },
    };
    const center = edgeCenters[edge];
    if (!center) throw new RangeError(`Некорректный край O03: ${edge}`);
    ({ u, v } = center);
  } else if (placement === 'CENTER') {
    const center = params.center && typeof params.center === 'object'
      ? params.center as Record<string, unknown>
      : {};
    u = Number(center.u ?? params.cx ?? 0.5);
    v = Number(center.v ?? params.cy ?? 0.5);
    const offset = Number(params.offset ?? config.defaultOffset);
    if (![u, v, offset].every(Number.isFinite) || u < 0 || u > 1 || v < 0 || v > 1) {
      throw new RangeError('Некорректные центр или смещение O03');
    }
    const normal = (angle + 90) * Math.PI / 180;
    u += Math.cos(normal) * offset / width;
    v += Math.sin(normal) * offset / CANVAS_HEIGHT;
  } else {
    throw new RangeError(`Некорректное размещение O03: ${placement}`);
  }
  return { u, v };
}

function symmetricPlacementCenters(
  point: { u: number; v: number },
  symmetry: FlagSymmetryClass,
): { u: number; v: number }[] {
  return expandSymmetricPlacements(
    [{ ...point, size: 1, rotation: 0, mirror: false }],
    symmetry,
  ).map(({ u, v }) => ({ u, v }));
}

function sampleFreePlacementCandidate(
  draft: ProfiledDraft,
  random: () => number,
): { u: number; v: number } {
  const normalizedMargin = FLAG_PLACEMENT_CONFIG.anchors.safeMargin / CANVAS_HEIGHT;
  const minU = normalizedMargin / (draft.aspect ?? 1.5);
  const minV = normalizedMargin;
  const symmetry = draft.symmetry ?? 'NONE';
  const maxU = ['MIR_H', 'BOTH', 'ROT180'].includes(symmetry) ? 0.5 : 1 - minU;
  const maxV = ['MIR_V', 'BOTH', 'ROT180'].includes(symmetry) ? 0.5 : 1 - minV;
  if (maxU <= minU || maxV <= minV) {
    throw new RangeError(`Для A10 нет допустимого диапазона координат при симметрии ${symmetry}`);
  }
  return {
    u: sampleRange(minU, maxU, random),
    v: sampleRange(minV, maxV, random),
  };
}

function maximumPlacementSizeClearOfExisting(
  centers: readonly { u: number; v: number }[],
  existing: readonly { u: number; v: number; size: number }[],
  frame: { w: number; h: number },
  canvasHeight: number,
): number {
  const minimumGap = FLAG_PLACEMENT_CONFIG.anchors.minimumGap / canvasHeight;
  let maximumSize = Number.POSITIVE_INFINITY;
  for (const center of centers) {
    for (const placed of existing) {
      const distance = Math.hypot(
        (center.u - placed.u) * frame.w,
        (center.v - placed.v) * frame.h,
      );
      maximumSize = Math.min(
        maximumSize,
        2 * (distance - placed.size * frame.h / 2 - minimumGap) / frame.h,
      );
    }
  }
  for (let first = 0; first < centers.length; first += 1) {
    for (let second = first + 1; second < centers.length; second += 1) {
      const distance = Math.hypot(
        (centers[first].u - centers[second].u) * frame.w,
        (centers[first].v - centers[second].v) * frame.h,
      );
      maximumSize = Math.min(maximumSize, (distance - minimumGap) / frame.h);
    }
  }
  return Number.isFinite(maximumSize) ? Math.max(0, maximumSize) : Number.POSITIVE_INFINITY;
}

function placementReferences(
  draft: ProfiledDraft,
  field: FlagFieldResult,
  anchor: FlagChargeAnchor,
  groupIndex: number,
  random: () => number,
  virtualCantonSize?: { w: number; h: number },
  a5Geometry?: A5RegionGeometry | null,
  bandCenterOverride?: { u: number; v: number },
  a10CandidateOverride?: { u: number; v: number },
): GeneratorPlacementReferences {
  const references: GeneratorPlacementReferences = {
    profileId: draft.chargeProfile.id,
    outlineType: draft.outlineType,
  };
  if (anchor === 'A11' && draft.chargeCount > 1) references.groupIndex = groupIndex % 2;
  if (anchor === 'A3') {
    const ordinary = draft.ordinarySpecs.find(({ type }) => ['O01', 'O02', 'O05'].includes(type));
    const params = ordinary?.params ?? {};
    const center = params.center as { u?: number; v?: number } | undefined;
    references.ordinaryCenter = {
      u: Number(center?.u ?? (draft.profile.id === 'P19' ? FLAG_ORDINARY_CONFIG.operators.O01.defaultScandinavianCenter : 0.5)),
      v: Number(center?.v ?? 0.5),
    };
  }
  if (anchor === 'A4') {
    const canton = draft.ordinaryPaint?.paintLayers.filter((layer) => layer.kind === 'canton') ?? [];
    if (canton.length) {
      const points = canton.flatMap((layer) => layer.polygons.flat());
      const width = CANVAS_HEIGHT * (draft.aspect ?? 1.5);
      references.cantonCenter = {
        u: (Math.min(...points.map(({ x }) => x)) + Math.max(...points.map(({ x }) => x))) / (2 * width),
        v: (Math.min(...points.map(({ y }) => y)) + Math.max(...points.map(({ y }) => y))) / (2 * CANVAS_HEIGHT),
      };
    } else {
      references.virtualCantonSize = {
        w: virtualCantonSize?.w ?? FLAG_PLACEMENT_CONFIG.anchors.virtualCantonWidths[
          Math.floor(random() * FLAG_PLACEMENT_CONFIG.anchors.virtualCantonWidths.length)
        ],
        h: virtualCantonSize?.h ?? FLAG_PLACEMENT_CONFIG.anchors.virtualCantonHeights[
          Math.floor(random() * FLAG_PLACEMENT_CONFIG.anchors.virtualCantonHeights.length)
        ],
      };
    }
  }
  if (anchor === 'A5') {
    const geometry = a5Geometry === undefined ? a5RegionReferences(draft, field) : a5Geometry;
    if (!geometry) throw new RangeError('A5 требует четыре непересекающиеся области композиции');
    references.quarters = geometry.quarters;
    references.regionMinDistance = geometry.regionMinDistance;
  }
  if (anchor === 'A6') {
    if (bandCenterOverride) {
      references.bandCenter = bandCenterOverride;
    } else if (draft.fieldOperator !== 'G02') {
      references.bandCenter = ordinaryBandCenterReference(draft);
    } else {
      const bands = Math.max(1, Number(draft.fieldParams?.bands ?? 3));
      const axis = String(draft.fieldParams?.axis ?? 'H').toUpperCase();
      let bandIndex = Math.floor(random() * bands);
      if (bands % 2 === 1 && random() < 0.8) bandIndex = Math.floor(bands / 2);
      references.bandCenter = axis === 'V'
        ? { u: (bandIndex + 0.5) / bands, v: 0.5 }
        : { u: 0.5, v: (bandIndex + 0.5) / bands };
    }
  }
  if (anchor === 'A9') {
    const pile = draft.ordinarySpecs.find(({ type }) => type === 'O06');
    const layer = draft.ordinaryPaint?.paintLayers.find((candidate) => String(candidate.id).includes(pile?.id ?? '\u0000'));
    const polygon = layer?.polygons?.[0];
    if (!polygon) throw new RangeError('A9 требует внутреннюю область PILE');
    const scale = CANVAS_HEIGHT * (draft.aspect ?? 1.5);
    references.pileInterior = polygon.map(({ x, y }) => ({ u: x / scale, v: y / CANVAS_HEIGHT }));
  }
  if (anchor === 'A10') {
    if (a10CandidateOverride) {
      references.candidates = [a10CandidateOverride];
    } else {
      references.candidates = Array.from(
        { length: FLAG_PLACEMENT_CONFIG.anchors.a10Attempts },
        () => sampleFreePlacementCandidate(draft, random),
      );
    }
  }
  return references;
}

function applicableAnchorWeights(
  draft: ProfiledDraft,
  configured: Record<string, number | null> | null,
): Record<string, number> {
  const hasOrdinary = (...types: FlagOrdinaryType[]) => draft.ordinarySpecs.some(({ type }) => types.includes(type));
  const hasFourRegions = draft.fieldOperator === 'G05' ||
    (draft.fieldOperator === 'G03' && draft.fieldDescriptor?.includes('SALTIRE_DIV')) ||
    hasOrdinary('O01', 'O02');
  const allowed: Record<FlagChargeAnchor, boolean> = {
    A1: true,
    A2: true,
    A3: hasOrdinary('O01', 'O02', 'O05'),
    A4: true,
    A5: hasFourRegions,
    A6: draft.fieldOperator === 'G02' || hasOrdinary('O03'),
    A7: false,
    A8: true,
    A9: hasOrdinary('O06'),
    A10: !!draft.symmetry && draft.symmetry !== 'NONE',
    A11: draft.profile.id === 'P13',
  };
  const result: Record<string, number> = {};
  if (!configured) {
    for (const [anchor, isAllowed] of Object.entries(allowed)) {
      if (isAllowed) result[anchor] = 1;
    }
    return result;
  }
  for (const [anchor, weight] of Object.entries(configured)) {
    if (weight === null || weight <= 0 || !allowed[anchor as FlagChargeAnchor]) continue;
    result[anchor] = weight;
  }
  return result;
}

function potentialChargeAnchors(draft: ProfiledDraft): FlagChargeAnchor[] {
  const hasOrdinary = draft.ordinarySpecs.length > 0 ||
    draft.ordinaryCount > 0 || ['P13', 'P18', 'P19'].includes(draft.profile.id);
  const ordinaryTypes = new Set<FlagOrdinaryType>(
    draft.ordinarySpecs.length
      ? draft.ordinarySpecs.map(({ type }) => type)
      : hasOrdinary
        ? Object.keys(draft.fieldProfile.ORD ?? {})
          .map(ordinaryType)
          .filter((type): type is FlagOrdinaryType => type !== null)
        : [],
  );
  const fieldWeights = configuredChoiceWeights(draft.fieldProfile.SPECIAL?.fieldOperatorWeights) ??
    draft.fieldProfile.GND;
  const fieldDescriptors = draft.fieldOperator
    ? [draft.fieldDescriptor ?? draft.fieldOperator]
    : Object.keys(fieldWeights ?? {});
  const fieldOperators = draft.fieldOperator
    ? new Set([draft.fieldOperator])
    : new Set(fieldDescriptors.map(resolveFieldOperator));
  const hasFourRegions = fieldOperators.has('G05') ||
    fieldDescriptors.some((descriptor) =>
      resolveFieldOperator(descriptor) === 'G03' && descriptor.includes('SALTIRE_DIV')) ||
    ordinaryTypes.has('O01') || ordinaryTypes.has('O02');
  const possible: Record<FlagChargeAnchor, boolean> = {
    A1: true,
    A2: true,
    A3: ordinaryTypes.has('O01') || ordinaryTypes.has('O02') || ordinaryTypes.has('O05'),
    A4: true,
    A5: hasFourRegions,
    A6: fieldOperators.has('G02') || ordinaryTypes.has('O03'),
    A7: false,
    A8: true,
    A9: ordinaryTypes.has('O06'),
    A10: Object.entries(draft.profile.SYM ?? {}).some(([symmetry, weight]) =>
      symmetry !== 'NONE' && typeof weight === 'number' && weight > 0),
    A11: draft.profile.id === 'P13',
  };
  const configured = draft.chargeProfile.CHG?.anchors;
  return (Object.keys(possible) as FlagChargeAnchor[]).filter((anchor) =>
    possible[anchor] && (!configured || (typeof configured[anchor] === 'number' && configured[anchor]! > 0)));
}

class FlagSlotCompactor {
  compact(
    draft: ProfiledDraft,
    field: FlagFieldResult,
    ordinaryPaint: ReturnType<typeof buildFlagOrdinaryLayers>,
    rootLayers: FlagNode[],
    slots: Set<string>,
  ): string[] {
    const used = new Set<string>(field.regions.map(({ slot }) => slot));
    this.collectLayerSlots(rootLayers, used);
    const unknown = [...used].filter((slot) => !SYMBOLIC_SLOTS.includes(slot));
    if (unknown.length) throw new RangeError(`Неизвестные цветовые слоты: ${unknown.join(', ')}`);
    const retained = SYMBOLIC_SLOTS.filter((slot) => used.has(slot));
    if (!retained.length) throw new RangeError('Спецификация флага не содержит используемых цветовых слотов');
    const mapping = new Map(retained.map((slot, index) => [slot, `s${index + 1}`]));
    const remap = (slot: string) => mapping.get(slot) ?? slot;
    const remappedField = this.remapReferences(field, mapping);
    Object.assign(field, remappedField);
    const remappedOrdinaries = this.remapReferences(ordinaryPaint, mapping);
    Object.assign(ordinaryPaint, remappedOrdinaries);
    const remappedLayers = this.remapReferences(rootLayers, mapping) as FlagNode[];
    rootLayers.splice(0, rootLayers.length, ...remappedLayers);
    draft.ordinarySpecs = this.remapReferences(draft.ordinarySpecs, mapping) as FlagOrdinarySpec[];
    draft.fieldParams = this.remapReferences(draft.fieldParams, mapping) as JsonObject;
    if (draft.fieldSlots) draft.fieldSlots = draft.fieldSlots.map(remap);
    draft.charges = draft.charges.map((charge) => ({
      ...charge, slot: remap(charge.slot), innerSlot: remap(charge.innerSlot),
    }));
    slots.clear();
    for (const slot of retained) slots.add(remap(slot));
    return [...slots];
  }

  private collectLayerSlots(value: unknown, used: Set<string>): void {
    if (Array.isArray(value)) {
      value.forEach((item) => this.collectLayerSlots(item, used));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if ((key === 'fill' || key.endsWith('_fill') || key === 'slot' || key.endsWith('_slot')) &&
        typeof child === 'string' && /^s\d+$/.test(child)) used.add(child);
      else this.collectLayerSlots(child, used);
    }
  }

  private remapReferences(value: unknown, mapping: Map<string, string>, key = ''): unknown {
    if (typeof value === 'string') {
      if (key !== 'fill' && key !== 'slot' && key !== 'slots' &&
        !key.endsWith('_fill') && !key.endsWith('_slot')) return value;
      const mapped = mapping.get(value);
      if (mapped) return mapped;
      // Обрезанная область может исчезнуть, но слоту нужен допустимый адрес при повторной сборке поля.
      return key === 'slots' ? mapping.values().next().value ?? value : value;
    }
    if (Array.isArray(value)) return value.map((item) => this.remapReferences(item, mapping, key));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) =>
      [childKey, this.remapReferences(child, mapping, childKey)]));
  }
}

type NormalizedPlacementObstacle = readonly { u: number; v: number }[];

function makeSpec(
  draft: ProfiledDraft,
  field: FlagFieldResult,
  random: () => number,
  parts: {
    includeOrdinaries?: boolean;
    includeCharges?: boolean;
  } = {},
): FlagSpec {
  if (!draft.outline || !draft.outlineType || !draft.aspect || !draft.fieldOperator || !draft.fieldParams) {
    throw new Error('Кандидат не прошёл обязательные стадии контура и поля');
  }
  const includeOrdinaries = parts.includeOrdinaries ?? true;
  const includeCharges = parts.includeCharges ?? true;
  const height = CANVAS_HEIGHT;
  const width = height * draft.aspect;
  const slots = new Set<string>(field.regions.map((region) => region.slot));
  if (!slots.size) slots.add('s1');
  const rootLayers: FlagNode[] = [];
  const ordinaryFrame = { x0: 0, y0: 0, w: width, h: height };
  const cantonSpec = !includeOrdinaries || draft.isFallback
    ? null
    : prepareCantonSpec(draft, width, height, random);
  const emptyOrdinaryResult = {
    paintLayers: [], ordinaryCount: 0, cantonCount: 0, bordureCount: 0, totalCost: 0, maxDepth: 0,
  };
  const ordinaryResult = includeOrdinaries
    ? draft.isFallback
      ? emptyOrdinaryResult
      : buildFlagOrdinaryLayers(draft.ordinarySpecs, ordinaryFrame, {
        canvasHeight: height,
        clipChain: [[draft.outline.boundary]],
        random,
      })
    : draft.ordinaryPaint ?? emptyOrdinaryResult;
  draft.ordinaryPaint = ordinaryResult as ReturnType<typeof buildFlagOrdinaryLayers>;
  // По одному пикселю запаса на дискретизацию каждой из двух масок; порог V08 не изменяется.
  const minimumOrdinaryGap = (
    FLAG_VALIDATION_CONFIG.physical.minimumGap *
      FLAG_VALIDATION_CONFIG.physical.validationFactor /
      FLAG_VALIDATION_CONFIG.physical.referenceUnitsPerPixel +
    2
  ) / FLAG_VALIDATION_CONFIG.referenceRasterHeight;
  const placementFrame = { w: draft.aspect ?? 1.5, h: 1 };
  const placementSafeArea = draft.outline.safe_area;
  const ordinaryObstacles: NormalizedPlacementObstacle[] = [];
  const a6OrdinaryObstacles: NormalizedPlacementObstacle[] =
    draft.fieldOperator === 'G02' ? ordinaryObstacles as NormalizedPlacementObstacle[] : [];
  for (const layer of ordinaryResult.paintLayers) {
    for (const polygon of layer.polygons) {
      if (polygon.length < 3) continue;
      const normalized = polygon.map(({ x, y }) => ({ u: x / width, v: y / height }));
      ordinaryObstacles.push(normalized);
      if (a6OrdinaryObstacles !== ordinaryObstacles && layer.operator !== 'O03') {
        a6OrdinaryObstacles.push(normalized);
      }
    }
  }
  const noPlacementObstacles: readonly (readonly { u: number; v: number }[])[] = [];
  const placementClearanceCache = new Map<string, number>();
  const safeChargeSizeEvaluators = new Map<
    'ordinary' | 'a6' | 'none',
    (center: { u: number; v: number }) => number
  >();
  const safeChargeSizeEvaluator = (obstacleKind: 'ordinary' | 'a6' | 'none') => {
    let evaluator = safeChargeSizeEvaluators.get(obstacleKind);
    if (!evaluator) {
      const obstacles = obstacleKind === 'ordinary'
        ? ordinaryObstacles
        : obstacleKind === 'a6'
          ? a6OrdinaryObstacles
          : noPlacementObstacles;
      evaluator = createMaximumSafeChargeSizeEvaluator(
        placementFrame,
        placementSafeArea!,
        height,
        obstacles,
        minimumOrdinaryGap,
      );
      safeChargeSizeEvaluators.set(obstacleKind, evaluator);
    }
    return evaluator;
  };
  const cachedSafeChargeSizeAtPoint = (
    center: { u: number; v: number },
    obstacleKind: 'ordinary' | 'a6' | 'none' = 'ordinary',
  ): number => {
    if (!placementSafeArea) {
      throw new FlagGenerationAttemptError('S4_COMPOSITION', 'Для размещения заряда не задана safe_area контура');
    }
    const key = `${obstacleKind}:${center.u}:${center.v}`;
    const cached = placementClearanceCache.get(key);
    if (cached !== undefined) return cached;
    const clearance = safeChargeSizeEvaluator(obstacleKind)(center);
    placementClearanceCache.set(key, clearance);
    return clearance;
  };
  for (const layer of ordinaryResult.paintLayers) {
    const fill = typeof layer.fill === 'string' ? layer.fill : 's2';
    slots.add(fill);
    const polygons = layer.polygons.map((polygon) => polygon.map(({ x, y }) => ({ x, y })));
    if (!polygons.length) continue;
    if (polygons.length === 1) {
      addLayer(rootLayers, `${layer.id}-group`, layer.kind === 'canton' ? 'canton' : 'ordinary',
        { type: 'polygon', points: polygons[0] }, fill, layer.tags, layer.cost);
    } else {
      addLayer(rootLayers, `${layer.id}-group`, layer.kind === 'canton' ? 'canton' : 'ordinary',
        { type: 'multipolygon', polygons }, fill, layer.tags, layer.cost);
    }
  }
  const cantonPaint = ordinaryResult.paintLayers.find((layer) => layer.kind === 'canton');
  if (!draft.isFallback && cantonSpec && cantonPaint) {
    const backgroundSlot = typeof cantonPaint.fill === 'string' ? cantonPaint.fill : 's2';
    if (draft.profile.id === 'P18') {
      const grid = buildP18StarGrid(cantonPaint, width, height, random);
      const starSlot = allocateCantonSlot(slots, [backgroundSlot]);
      addLayer(rootLayers, 'p18-canton-star-grid', 'canton', grid.shape, starSlot,
        ['repeat', 'canton-grid', 'M03'], grid.cost);
      const contentCost = grid.cost * FLAG_ORDINARY_CONFIG.costs.cantonContentMultiplier;
      ordinaryResult.totalCost += contentCost;
      cantonPaint.cost += contentCost;
    } else if (draft.profile.id !== 'P13') {
      const contentCost = addGenericCantonEmblem(draft, cantonPaint, width, height, random, slots, rootLayers) *
        FLAG_ORDINARY_CONFIG.costs.cantonContentMultiplier;
      ordinaryResult.totalCost += contentCost;
      cantonPaint.cost += contentCost;
    }
  }
  draft.charges = [];
  const chargeWeights = draft.chargeProfile.CHG?.modules ?? null;
  const configuredAnchorWeights = draft.chargeProfile.CHG?.anchors ?? null;
  const anchorWeights = applicableAnchorWeights(draft, configuredAnchorWeights);
  const usedAnchors = new Set<FlagChargeAnchor>();
  let completedGroups = 0;
  for (let index = 0; includeCharges && index < draft.chargeCount; index += 1) {
    const existingPlacements = draft.charges.flatMap(({ centers, placementSize }) =>
      centers.map(({ x, y }) => ({ u: x / width, v: y / height, size: placementSize })),
    );
    const a10CandidatePoints: { u: number; v: number }[] = [];
    const a10ClearanceCache = new Map<string, { safeSize: number; existingSize: number }>();
    if (!draft.isFallback && !chargeWeights) {
      throw new FlagGenerationAttemptError('S4_COMPOSITION', `Для профиля ${draft.chargeProfile.id} не задан пул модулей эмблем`);
    }
    if (!draft.isFallback && !Object.keys(anchorWeights).length) {
      throw new FlagGenerationAttemptError('S4_COMPOSITION', `Для профиля ${draft.chargeProfile.id} не заданы веса якорей эмблем`);
    }
    const candidateFailures: string[] = [];
    let preparedCandidate: PreparedChargeCandidate | null = null;
    const candidateModuleWeights = draft.isFallback
      ? null
      : expandModuleCandidateWeights(chargeWeights ?? {});
    const remainingModuleWeights = candidateModuleWeights ? { ...candidateModuleWeights } : null;
    const moduleCandidateLimit = draft.isFallback
      ? 1
      : Math.max(1, Object.keys(candidateModuleWeights ?? {}).length);
    for (let candidateAttempt = 0;
      candidateAttempt < moduleCandidateLimit &&
        (draft.isFallback || Object.keys(remainingModuleWeights ?? {}).length > 0);
      candidateAttempt += 1) {
    const rawModuleName = draft.isFallback
      ? ['DISC', 'STAR', 'RHOMBUS'][Math.floor(random() * 3)]
      : weighted<string>(remainingModuleWeights, random);
    if (remainingModuleWeights) delete remainingModuleWeights[rawModuleName];
    const moduleOption = chooseModuleOption(rawModuleName, random, draft.chargeSourceProfileId);
    const moduleName = moduleOption.moduleName;
    const module = moduleId(moduleName);
    const composer = draft.isFallback ? 'SINGLE' : moduleOption.composer ?? (draft.chargeProfile.CHG?.composers
      ? weighted<string>(draft.chargeProfile.CHG.composers, random)
      : 'SINGLE');
    const forcedAnchor: FlagChargeAnchor | undefined = moduleOption.anchor ?? (draft.isFallback
      ? 'A1'
      : draft.profile.id === 'P04' && rawModuleName.startsWith('SMALL:')
        ? 'A5'
        : draft.profile.id === 'P04' && draft.chargeCount >= 2 && ['CROWN', 'DISC', 'SWORD'].includes(moduleName)
          ? 'A3'
          : undefined);
    if (forcedAnchor && usedAnchors.has(forcedAnchor)) {
      candidateFailures.push(`${moduleName}: обязательный якорь ${forcedAnchor} уже использован`);
      continue;
    }
    const candidateAnchorNames = forcedAnchor
      ? [forcedAnchor]
      : Object.keys(anchorWeights).filter((anchor) =>
        anchor === 'A11' || !usedAnchors.has(anchor as FlagChargeAnchor));
    const maximumAnchorSize = candidateAnchorNames.reduce((maximum, anchor) => {
      try {
        const [, configuredMaximum] = anchorSizeBounds(anchor as FlagChargeAnchor, draft);
        const possibleMaximum = anchor === 'A5' ? 0.3 : configuredMaximum;
        return Math.max(maximum, Math.min(possibleMaximum, FLAG_PLACEMENT_CONFIG.anchors.sizeRange[1]));
      } catch {
        return maximum;
      }
    }, 0);
    const maximumModuleSize = Math.min(
      maximumAnchorSize,
      moduleOption.sizeRange?.[1] ?? Number.POSITIVE_INFINITY,
    );
    let node: EmblemNode;
    try {
      node = createChargeNode(moduleName, composer, random, moduleOption.composerParams, maximumModuleSize);
    } catch (error) {
      if (error instanceof RangeError && error.message.includes('помещающегося в доступные якоря')) {
        candidateFailures.push(`${moduleName}: параметры не помещаются ни в один оставшийся якорь`);
        continue;
      }
      throw error;
    }
    const minimumFeatureFraction = moduleMinimumFeatureFraction(module, node.params ?? {});
    const minimumDiameterUnits = FLAG_GENERATOR_CONFIG.physical.minimumThickness / minimumFeatureFraction;
    if (minimumDiameterUnits / height > maximumModuleSize) {
      candidateFailures.push(`${moduleName}: минимальный размер превышает предел всех оставшихся якорей`);
      continue;
    }
    const built = validateFlagEmblem(node, { canvasHeight: height, scale: 1, rng: random });
    const extentFactor = Math.max(1, maximumEmblemRadius(built.primitives) * 2);
    const availableWeights = { ...anchorWeights };
    for (const usedAnchor of usedAnchors) {
      if (usedAnchor !== 'A11') delete availableWeights[usedAnchor];
    }
    const virtualCantonSize = availableWeights.A4 && !draft.ordinaryPaint?.paintLayers.some((layer) => layer.kind === 'canton')
      ? {
        w: FLAG_PLACEMENT_CONFIG.anchors.virtualCantonWidths[
          Math.floor(random() * FLAG_PLACEMENT_CONFIG.anchors.virtualCantonWidths.length)
        ],
        h: FLAG_PLACEMENT_CONFIG.anchors.virtualCantonHeights[
          Math.floor(random() * FLAG_PLACEMENT_CONFIG.anchors.virtualCantonHeights.length)
        ],
      }
      : undefined;
    const needsA5Geometry = Boolean(availableWeights.A5) || forcedAnchor === 'A5';
    const a5Geometry = needsA5Geometry ? a5RegionReferences(draft, field) : null;
    const a5Applicable = needsA5Geometry && canPlaceA5(draft, field, a5Geometry);
    if (!a5Applicable) delete availableWeights.A5;
    if (forcedAnchor === 'A5' && !a5Applicable) {
      candidateFailures.push(`${moduleName}: обязательный якорь A5 не имеет четырёх допустимых областей`);
      continue;
    }
    const maximumSizeByAnchor = new Map<FlagChargeAnchor, number>();
    const a2FitOptions = new Map<FlagChargeAnchor, {
      references: Partial<GeneratorPlacementReferences>;
      maximumSize: number;
    }[]>();
    const a6FitOptions = new Map<FlagChargeAnchor, {
      references: Partial<GeneratorPlacementReferences>;
      maximumSize: number;
    }[]>();
    const a10FitOptions = new Map<FlagChargeAnchor, {
      references: Partial<GeneratorPlacementReferences>;
      maximumSize: number;
    }[]>();
    const anchorExclusions: string[] = [];
    for (const key of Object.keys(availableWeights)) {
      const candidate = key as FlagChargeAnchor;
      try {
        const [minimum, maximum] = anchorSizeBounds(candidate, draft, virtualCantonSize, a5Geometry?.regionMinDistance);
        const lowerBound = Math.max(
          minimum,
          minimumDiameterUnits / CANVAS_HEIGHT,
          moduleOption.sizeRange?.[0] ?? 0,
          FLAG_PLACEMENT_CONFIG.anchors.sizeRange[0],
        );
        let maximumFeasibleSize = Number.POSITIVE_INFINITY;
        if (candidate === 'A1') {
          const centers = symmetricPlacementCenters({ u: 0.5, v: 0.5 }, draft.symmetry ?? 'NONE');
          const safeSize = Math.min(...centers.map((center) => cachedSafeChargeSizeAtPoint(center)));
          maximumFeasibleSize = safeSize / extentFactor;
        } else if (candidate === 'A2') {
          const points = draft.outlineType === 'BANNER'
            ? FLAG_PLACEMENT_CONFIG.anchors.bannerA2YValues.map((y) => ({
              point: { u: 0.5, v: y },
              references: { a2Y: y },
            }))
            : (draft.chargeProfile.id === 'P22'
              ? [FLAG_PLACEMENT_CONFIG.anchors.p22HoistCenterX]
              : FLAG_PLACEMENT_CONFIG.anchors.hoistCenterXValues).map((x) => ({
              point: { u: x, v: 0.5 },
              references: { a2X: x },
            }));
          const symmetry = draft.symmetry ?? 'NONE';
          const feasible = points.map(({ point, references }) => {
            const centers = symmetricPlacementCenters(point, symmetry);
            const safeSize = Math.min(...centers.map((center) => cachedSafeChargeSizeAtPoint(center)));
            const existingSize = maximumPlacementSizeClearOfExisting(
              centers, existingPlacements, placementFrame, height,
            );
            return { references, maximumSize: Math.min(safeSize, existingSize) / extentFactor };
          }).filter(({ maximumSize }) =>
            Math.min(maximum, moduleOption.sizeRange?.[1] ?? 1, maximumSize) >= lowerBound,
          );
          if (!feasible.length) {
            anchorExclusions.push(`${candidate}: все позиции A2 меньше нижней границы ${lowerBound.toFixed(3)}`);
            delete availableWeights[key];
            continue;
          }
          a2FitOptions.set(candidate, feasible);
          maximumFeasibleSize = Math.max(...feasible.map(({ maximumSize }) => maximumSize));
        } else if (candidate === 'A3') {
          const references = placementReferences(
            draft, field, candidate, completedGroups, random, virtualCantonSize, a5Geometry,
          );
          const point = references.ordinaryCenter;
          if (!point) throw new RangeError('A3 требует центр ординария');
          const centers = symmetricPlacementCenters(point, draft.symmetry ?? 'NONE');
          const safeSize = Math.min(...centers.map((center) => cachedSafeChargeSizeAtPoint(center, 'none')));
          maximumFeasibleSize = safeSize / extentFactor;
        } else if (candidate === 'A6') {
          const candidates = draft.fieldOperator === 'G02'
            ? (() => {
              const bands = Math.max(1, Math.floor(Number(draft.fieldParams?.bands ?? 3)));
              const axis = String(draft.fieldParams?.axis ?? 'H').toUpperCase();
              return Array.from({ length: bands }, (_, bandIndex) => ({
                point: axis === 'V'
                  ? { u: (bandIndex + 0.5) / bands, v: 0.5 }
                  : { u: 0.5, v: (bandIndex + 0.5) / bands },
              }));
            })()
            : [{ point: ordinaryBandCenterReference(draft) }];
          const feasible = candidates.map(({ point }) => {
            const centers = symmetricPlacementCenters(point, draft.symmetry ?? 'NONE');
            const safeSize = Math.min(...centers.map((center) => cachedSafeChargeSizeAtPoint(center, 'a6')));
            const existingSize = maximumPlacementSizeClearOfExisting(
              centers, existingPlacements, placementFrame, height,
            );
            return { references: { bandCenter: point }, maximumSize: Math.min(safeSize, existingSize) / extentFactor };
          }).filter(({ maximumSize }) =>
            Math.min(maximum, moduleOption.sizeRange?.[1] ?? 1, maximumSize) >= lowerBound,
          );
          if (!feasible.length) {
            anchorExclusions.push(`${candidate}: нет полосы с безопасным диапазоном от ${lowerBound.toFixed(3)}`);
            delete availableWeights[key];
            continue;
          }
          a6FitOptions.set(candidate, feasible);
          maximumFeasibleSize = Math.max(...feasible.map(({ maximumSize }) => maximumSize));
        } else if (candidate === 'A5') {
          const quarterClearances = a5Geometry?.quarters.map((point) =>
            cachedSafeChargeSizeAtPoint(point),
          ) ?? [];
          maximumFeasibleSize = quarterClearances.length === 4
            ? Math.min(...quarterClearances) / extentFactor
            : 0;
        } else if (candidate === 'A10') {
          const feasible: { references: Partial<GeneratorPlacementReferences>; maximumSize: number }[] = [];
          const maximumAttempts = FLAG_PLACEMENT_CONFIG.anchors.a10Attempts;
          const batchSize = Math.max(1, Math.ceil(Math.sqrt(maximumAttempts)));
          for (let start = 0; start < maximumAttempts && !feasible.length; start += batchSize) {
            const batchEnd = Math.min(maximumAttempts, start + batchSize);
            while (a10CandidatePoints.length < batchEnd) {
              a10CandidatePoints.push(sampleFreePlacementCandidate(draft, random));
            }
            for (const center of a10CandidatePoints.slice(start, batchEnd)) {
              const key = `${center.u}:${center.v}`;
              let clearance = a10ClearanceCache.get(key);
              if (!clearance) {
                const centers = symmetricPlacementCenters(center, draft.symmetry ?? 'NONE');
                clearance = {
                  safeSize: Math.min(...centers.map((point) => cachedSafeChargeSizeAtPoint(point))),
                  existingSize: maximumPlacementSizeClearOfExisting(
                    centers, existingPlacements, placementFrame, height,
                  ),
                };
                a10ClearanceCache.set(key, clearance);
              }
              const maximumSize = Math.min(
                clearance.safeSize,
                clearance.existingSize,
              ) / extentFactor;
              if (Math.min(maximum, moduleOption.sizeRange?.[1] ?? 1, maximumSize) >= lowerBound) {
                feasible.push({ references: { candidates: [center] }, maximumSize });
              }
            }
          }
          if (!feasible.length) {
            anchorExclusions.push(`${candidate}: нет безопасной позиции из ${maximumAttempts} проверяемых точек от ${lowerBound.toFixed(3)}`);
            delete availableWeights[key];
            continue;
          }
          a10FitOptions.set(candidate, feasible);
          maximumFeasibleSize = Math.max(...feasible.map(({ maximumSize }) => maximumSize));
        }
        const upperBound = Math.min(
          maximum,
          moduleOption.sizeRange?.[1] ?? 1,
          maximumFeasibleSize,
          FLAG_PLACEMENT_CONFIG.anchors.sizeRange[1],
        );
        if (upperBound < lowerBound) {
          anchorExclusions.push(`${candidate}: диапазон ${lowerBound.toFixed(3)}..${upperBound.toFixed(3)}`);
          delete availableWeights[key];
        } else {
          maximumSizeByAnchor.set(candidate, maximumFeasibleSize);
        }
      } catch (error) {
        anchorExclusions.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
        delete availableWeights[key];
      }
    }
    if (forcedAnchor && !availableWeights[forcedAnchor]) {
      candidateFailures.push(`${moduleName}: обязательный якорь ${forcedAnchor} не имеет допустимого размера`);
      continue;
    }
    const selectableWeights = { ...availableWeights };
    if (completedGroups >= 2) delete selectableWeights.A11;
    const remainingGroups = draft.chargeCount - completedGroups - 1;
    if (remainingGroups > 0) {
      const a11Capacity = selectableWeights.A11
        ? completedGroups === 0 ? 2 : completedGroups === 1 ? 1 : 0
        : 0;
      for (const candidate of Object.keys(selectableWeights)) {
        const otherAnchorCapacity = Object.keys(selectableWeights)
          .filter((anchorName) => anchorName !== 'A11' && anchorName !== candidate).length;
        const remainingA11Capacity = candidate === 'A11' ? Math.max(0, a11Capacity - 1) : a11Capacity;
        if (otherAnchorCapacity + remainingA11Capacity < remainingGroups) delete selectableWeights[candidate];
      }
    }
    if (forcedAnchor && !selectableWeights[forcedAnchor]) {
      candidateFailures.push(`${moduleName}: обязательный якорь ${forcedAnchor} оставляет слишком мало якорей для остальных групп`);
      continue;
    }
    let anchor = forcedAnchor ?? (Object.keys(selectableWeights).length
      ? weighted<FlagChargeAnchor>(selectableWeights, random)
      : null);
    if (!anchor) {
      const exclusionSummary = anchorExclusions.length
        ? anchorExclusions.join('; ')
        : usedAnchors.size
          ? `ранее использованы: ${[...usedAnchors].join(',')}`
          : 'нет якорей с допустимым размером';
      candidateFailures.push(`${moduleName}: нет допустимых якорей (${exclusionSummary})`);
      continue;
    }
    if (anchor === 'A11' && completedGroups >= 2) {
      delete availableWeights.A11;
      if (forcedAnchor === 'A11' || !Object.keys(availableWeights).length) {
        candidateFailures.push(`${moduleName}: якорь A11 не поддерживает более двух групп`);
        continue;
      }
      anchor = weighted<FlagChargeAnchor>(availableWeights, random);
    }
    preparedCandidate = {
      moduleOption,
      moduleName,
      module,
      composer,
      node,
      built,
      minimumDiameterUnits,
      extentFactor,
      availableWeights,
      virtualCantonSize,
      a5Geometry,
      maximumSizeByAnchor,
      a2FitOptions,
      a6FitOptions,
      a10FitOptions,
      anchor,
    };
    break;
    }
    if (!preparedCandidate) {
      const configuredAnchors = Object.entries(configuredAnchorWeights ?? {})
        .map(([name, weight]) => `${name}:${weight ?? 'без веса'}`)
        .join(',');
      throw new FlagGenerationAttemptError(
        'S4_COMPOSITION',
        `Для групп ${completedGroups + 1}/${draft.chargeCount} не найдено размещение после ${moduleCandidateLimit} вариантов; источник ${draft.chargeSourceProfileId}; настройки якорей ${configuredAnchors || 'не заданы'}; доступный пул ${Object.keys(anchorWeights).join(',') || 'пуст'}; причины: ${[...new Set(candidateFailures)].slice(0, 4).join(' | ') || 'варианты не прошли геометрическую проверку'}`,
      );
    }
    const {
      moduleOption,
      moduleName,
      module,
      composer,
      node,
      built,
      minimumDiameterUnits,
      extentFactor,
      availableWeights,
      virtualCantonSize,
      a5Geometry,
      maximumSizeByAnchor,
      a2FitOptions,
      a6FitOptions,
      a10FitOptions,
    } = preparedCandidate;
    let anchor = preparedCandidate.anchor;
    let references: GeneratorPlacementReferences;
    let size: number;
    let maximumFeasibleSize = maximumSizeByAnchor.get(anchor) ?? 1;
    let placementSize: number | null = null;
    let placements: ReturnType<typeof resolveChargeGroupPlacements> | null = null;
    try {
      let a6Selected: { references: Partial<GeneratorPlacementReferences>; maximumSize: number } | undefined;
      let a6BandCenter: { u: number; v: number } | undefined;
      let a10Selected: { references: Partial<GeneratorPlacementReferences>; maximumSize: number } | undefined;
      let a10CandidateOverride: { u: number; v: number } | undefined;
      if (anchor === 'A6') {
        const choices = a6FitOptions.get(anchor);
        if (choices?.length) {
          if (draft.fieldOperator === 'G02') {
            const bands = Math.max(1, Math.floor(Number(draft.fieldParams?.bands ?? 3)));
            const axis = String(draft.fieldParams?.axis ?? 'H').toUpperCase();
            const centerBandIndex = Math.floor(bands / 2);
            const centerPoint = axis === 'V'
              ? { u: (centerBandIndex + 0.5) / bands, v: 0.5 }
              : { u: 0.5, v: (centerBandIndex + 0.5) / bands };
            const centerChoice = choices.find(({ references: candidateReferences }) =>
              candidateReferences.bandCenter?.u === centerPoint.u &&
              candidateReferences.bandCenter?.v === centerPoint.v);
            const randomChoice = chooseUniform(choices, random);
            const preferCenter = bands % 2 === 1 && random() < 0.8;
            a6Selected = preferCenter && centerChoice
              ? centerChoice
              : randomChoice;
          } else {
            const previousBandCount = Math.max(1, Number(draft.fieldParams?.bands ?? 3));
            random();
            if (previousBandCount % 2 === 1) random();
            a6Selected = choices[0];
          }
          a6BandCenter = a6Selected.references.bandCenter;
          maximumFeasibleSize = a6Selected.maximumSize;
        }
      }
      if (anchor === 'A10') {
        const choices = a10FitOptions.get(anchor);
        if (choices?.length) {
          a10Selected = chooseUniform(choices, random);
          const candidate = a10Selected.references.candidates?.[0];
          if (candidate) a10CandidateOverride = { u: candidate.u, v: candidate.v };
          maximumFeasibleSize = a10Selected.maximumSize;
        }
      }
      references = placementReferences(
        draft, field, anchor, completedGroups, random, virtualCantonSize, a5Geometry,
        a6BandCenter, a10CandidateOverride,
      );
      if (anchor === 'A2') {
        const choices = a2FitOptions.get(anchor);
        if (choices?.length) {
          const selected = chooseUniform(choices, random);
          references = { ...references, ...selected.references };
          maximumFeasibleSize = selected.maximumSize;
        }
      }
      size = draft.isFallback
        ? Math.max(random() < 0.5 ? 0.3 : 0.36, minimumDiameterUnits / CANVAS_HEIGHT)
        : sampleAnchorSize(
          anchor, draft, random, minimumDiameterUnits, references.virtualCantonSize,
          references.regionMinDistance, moduleOption.sizeRange, maximumFeasibleSize,
        );
      if (draft.profile.id === 'P19' && anchor === 'A3' && size < 0.15) {
        const fallbackWeights = { ...anchorWeights };
        delete fallbackWeights.A3;
        if (!fallbackWeights.A5) throw new RangeError('A3 не помещается; для P19 отсутствует доступный якорь A5');
        anchor = 'A5';
        references = placementReferences(draft, field, anchor, completedGroups, random, undefined, a5Geometry);
        maximumFeasibleSize = maximumSizeByAnchor.get(anchor) ?? 1;
        size = sampleAnchorSize(
          anchor, draft, random, minimumDiameterUnits, references.virtualCantonSize,
          references.regionMinDistance, undefined, maximumFeasibleSize,
        );
      }
      const initialSize = size;
      const [anchorMinimum] = anchorSizeBounds(
        anchor, draft, references.virtualCantonSize, references.regionMinDistance,
      );
      const minimumSize = Math.max(
        anchorMinimum,
        minimumDiameterUnits / height,
        moduleOption.sizeRange?.[0] ?? 0,
        FLAG_PLACEMENT_CONFIG.anchors.sizeRange[0],
      );
      const existing = draft.charges.flatMap(({ centers, placementSize: existingSize }) => centers.map(({ x, y }) => ({
        u: x / width, v: y / height, size: existingSize, rotation: 0, mirror: false,
      })));
      let placementError: RangeError | null = null;
      const localPlacementAttempts = 8;
      for (let localAttempt = 0; localAttempt < localPlacementAttempts; localAttempt += 1) {
        const fraction = localPlacementAttempts <= 1 ? 1 : localAttempt / (localPlacementAttempts - 1);
        const candidateSize = Math.max(minimumSize, initialSize - (initialSize - minimumSize) * fraction);
        const snappedSize = Math.min(maximumFeasibleSize, draft.isFallback
          ? candidateSize
          : snapChargeSize(
            candidateSize,
            { w: draft.aspect, h: 1 },
            random,
            height,
            minimumDiameterUnits / height,
          ));
        const candidatePlacementSize = snappedSize * extentFactor;
        try {
          placements = resolveChargeGroupPlacements({
            anchor,
            frame: { w: draft.aspect, h: 1 },
            safeArea: draft.outline.safe_area,
            size: candidatePlacementSize,
            canvasHeight: height,
            existing,
            references,
            rng: random,
            minimumSize: minimumDiameterUnits / CANVAS_HEIGHT,
            snapAlreadyApplied: !draft.isFallback,
            snapStep: draft.isFallback ? height / 24 : undefined,
            symmetry: anchor === 'A5' ? 'NONE' : draft.symmetry,
          });
          size = draft.isFallback ? placements[0]?.size ?? snappedSize : snappedSize;
          placementSize = draft.isFallback ? size : candidatePlacementSize;
          break;
        } catch (error) {
          if (!(error instanceof RangeError) || !error.message.includes('не найдено безопасное размещение в safe_area')) throw error;
          placementError = error;
        }
      }
      if (!placements || placementSize === null) {
        throw placementError ?? new RangeError(`${anchor}: не найдено безопасное размещение в safe_area`);
      }
    } catch (error) {
      if (error instanceof RangeError) {
        throw new FlagGenerationAttemptError('S4_COMPOSITION', error.message);
      }
      throw error;
    }
    const expandedPlacements = anchor === 'A5' || !draft.symmetry || draft.symmetry === 'NONE'
      ? placements
      : placements.flatMap((placement) => expandSymmetricPlacements([placement], draft.symmetry!));
    const centers = expandedPlacements.map(({ u, v, rotation, mirror }) => ({
      x: u * width, y: v * height, rotation, mirror,
    }));
    const backgroundSlots = new Set(centers.map(({ x, y }) => {
      let background = field.regions.find((region) =>
        region.visiblePolygons.some((polygon) => containsPolygon(x, y, polygon)),
      )?.slot ?? 's1';
      for (const ordinary of ordinaryResult.paintLayers) {
        if (ordinary.polygons.some((polygon) => containsPolygon(x, y, polygon)) && typeof ordinary.fill === 'string') {
          background = ordinary.fill;
        }
      }
      return background;
    }));
    const configuredSlots = ['s1', 's2', 's3', 's4', 's5'];
    const slot = configuredSlots.find((candidate) => !slots.has(candidate)) ??
      configuredSlots.find((candidate) => !backgroundSlots.has(candidate));
    if (!slot) throw new FlagGenerationAttemptError('S4_COMPOSITION', 'Для заряда не осталось контрастного слота');
    slots.add(slot);
    const usesInnerSlot = built.primitives.some(({ fill }) => fill !== 'outer');
    const innerSlot = usesInnerSlot
      ? configuredSlots.find((candidate) => !slots.has(candidate)) ?? slot
      : slot;
    if (usesInnerSlot) slots.add(innerSlot);
    const emblemNode = JSON.parse(JSON.stringify(node)) as JsonObject;
    if (centers.length > 1) {
      const template: FlagNode = {
        kind: 'layer',
        layer: {
          id: `charge-${index}-template`,
          role: 'charge',
          shape: {
            type: module,
            node: emblemNode,
            diameter: size,
            cx: 0.5,
            cy: 0.5,
            inner_fill: innerSlot,
            detail_fill: innerSlot,
          },
          transform: {},
          fill: slot,
          clip: [],
          tags: ['charge', module],
          cost: built.cost * centers.length,
        },
      };
      rootLayers.push({
        kind: 'repeat',
        pattern: {
          chargeId: `charge-${index}`,
          placements: centers.map(({ x, y, rotation, mirror }) => ({
            u: x / width,
            v: y / height,
            rotation,
            scale: 1,
            mirror,
          })),
        },
        child: template,
      });
    } else {
      const center = centers[0];
      addLayer(rootLayers, `charge-${index}-module`, 'charge', {
        type: module,
        node: emblemNode,
        diameter: size,
        cx: center.x / width,
        cy: center.y / height,
        rotate: center.rotation,
        mirror: center.mirror,
        inner_fill: innerSlot,
        detail_fill: innerSlot,
      }, slot, ['charge', module], built.cost);
    }
    draft.charges.push({
      id: `charge-${index}`, node, moduleId: module, size, placementSize, anchor, slot, innerSlot, centers,
      cost: calculateFlagEmblemCost(node), primitives: built.primitives,
    });
    if (anchor !== 'A11') usedAnchors.add(anchor);
    completedGroups += 1;
  }
  if (includeCharges && completedGroups !== draft.chargeCount) {
    throw new FlagGenerationAttemptError(
      'S4_COMPOSITION',
      `Создано ${completedGroups} из ${draft.chargeCount} запрошенных групп зарядов`,
    );
  }

  const slotItems = new FlagSlotCompactor().compact(draft, field, ordinaryResult, rootLayers, slots);
  const fieldParams = { ...draft.fieldParams };
  const ground: FlagNode = {
    kind: 'split',
    op: draft.fieldOperator,
    params: fieldParams as JsonObject,
    children: field.regions.map(({ slot }) => ({ kind: 'fill', fill: slot })),
  };
  const placeholderColors: Record<string, string> = {};
  for (const [index, slot] of slotItems.entries()) {
    const color = (index + 1).toString(16).padStart(6, '0');
    placeholderColors[slot] = `#${color}`;
  }
  const spec: FlagSpec = {
    generator_version: FLAG_GENERATOR_CONFIG.generatorVersion,
    seed: draft.seed,
    profile_id: draft.profile.id,
    second_profile_id: draft.secondProfileId,
    era: draft.era,
    tags: draft.profile.tags_allowed?.includes('neutral') ? ['neutral'] : [],
    outline: {
      type: draft.outlineType,
      params: draft.outlineParams as JsonObject,
      aspect: draft.aspect,
      safe_area: draft.outline.safe_area.map(({ x, y }) => ({ x, y })),
    },
    slots: { items: slotItems, equalities: [] },
    palette: Object.fromEntries(slotItems.map((slot) => [slot, { color_id: `TEMP_${slot}`, hex: placeholderColors[slot] }])),
    root: {
      x0: 0, y0: 0, w: 1, h: 1, clip: [],
      ground,
      layers: rootLayers,
    },
    meta: {
      complexity: field.complexityCost + ordinaryResult.totalCost + draft.charges.reduce((sum, charge) => sum + charge.cost, 0),
      symmetry: draft.symmetry ?? 'NONE',
      color_count: slotItems.length,
      structure_hash: '',
      visual_hash: '',
    },
  };
  draft.spec = spec;
  return spec;
}

function containsPolygon(x: number, y: number, points: readonly { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const first = points[i], second = points[j];
    if ((first.y > y) !== (second.y > y) &&
      x < ((second.x - first.x) * (y - first.y)) / (second.y - first.y) + first.x) inside = !inside;
  }
  return inside;
}

function containsShape(shape: Record<string, unknown>, x: number, y: number): boolean {
  const type = String(shape.type ?? '').toLowerCase();
  if (type === 'polygon') {
    const points = shape.points as { x: number; y: number }[] | undefined;
    return Boolean(points && containsPolygon(x, y, points));
  }
  if (type === 'circle' || type === 'disc') {
    const dx = x - Number(shape.cx ?? 0), dy = y - Number(shape.cy ?? 0);
    return dx * dx + dy * dy <= Number(shape.radius ?? shape.r ?? 0) ** 2;
  }
  if (type === 'ring') {
    const dx = x - Number(shape.cx ?? 0), dy = y - Number(shape.cy ?? 0);
    const distance = Math.hypot(dx, dy);
    return distance <= Number(shape.outerRadius ?? shape.radius ?? 0) &&
      distance >= Number(shape.innerRadius ?? 0);
  }
  return false;
}

function makeSlotRaster(draft: ProfiledDraft): FlagSlotRaster {
  const spec = draft.spec;
  const field = draft.field;
  if (!spec || !field || !draft.outline) throw new Error('Для растра палитры нужны поле, контур и FlagSpec');
  const width = 120;
  const height = Math.max(1, Math.round(width / spec.outline.aspect));
  const frameWidth = CANVAS_HEIGHT * spec.outline.aspect;
  const scaleX = width / frameWidth, scaleY = height / CANVAS_HEIGHT;
  const slotIds = Object.fromEntries(spec.slots.items.map((slot, index) => [index, slot]));
  const slotCodeByName = new Map(spec.slots.items.map((slot, index) => [slot, index]));
  const values = new Int32Array(width * height).fill(-1);
  const scaledPolygon = (polygon: readonly { x: number; y: number }[]) =>
    polygon.map(({ x, y }) => ({ x: x * scaleX, y: y * scaleY }));
  const outlineMask = rasterizeFlagPolygonMask(width, height, [scaledPolygon(draft.outline.boundary)]);
  const cutoutMask = rasterizeFlagPolygonMask(
    width, height, draft.outline.cutouts.map(scaledPolygon),
  );
  for (const layer of field.paintLayers) {
    const code = slotCodeByName.get(layer.slot);
    if (code === undefined) throw new RangeError(`Слот ${layer.slot} отсутствует в описании палитры`);
    const mask = rasterizeFlagPolygonMask(width, height, layer.polygons.map(scaledPolygon));
    for (let index = 0; index < values.length; index += 1) {
      if (mask[index] && outlineMask[index] && !cutoutMask[index]) values[index] = code;
    }
  }
  const paintShape = (shape: Record<string, unknown>, code: number) => {
    const type = String(shape.type ?? '').toLowerCase();
    if (type === 'polygon' && Array.isArray(shape.points)) {
      const points = (shape.points as { x: number; y: number }[]).map(({ x, y }) =>
        ({ x: x * scaleX, y: y * scaleY }));
      const mask = rasterizeFlagPolygonMask(width, height, [points]);
      for (let index = 0; index < values.length; index += 1) {
        if (values[index] >= 0 && mask[index]) values[index] = code;
      }
      return;
    }
    if (type === 'multipolygon' && Array.isArray(shape.polygons)) {
      const polygons = (shape.polygons as { x: number; y: number }[][]).map(scaledPolygon);
      const mask = rasterizeFlagPolygonMask(width, height, polygons);
      for (let index = 0; index < values.length; index += 1) {
        if (values[index] >= 0 && mask[index]) values[index] = code;
      }
      return;
    }
    let minCanvasX: number, maxCanvasX: number, minCanvasY: number, maxCanvasY: number;
    if (type === 'rect') {
      minCanvasX = Number(shape.x);
      maxCanvasX = minCanvasX + Number(shape.width);
      minCanvasY = Number(shape.y);
      maxCanvasY = minCanvasY + Number(shape.height);
    } else if (type === 'circle' || type === 'disc' || type === 'ring') {
      const cx = Number(shape.cx ?? 0), cy = Number(shape.cy ?? 0);
      const radius = type === 'ring'
        ? Number(shape.outerRadius ?? shape.radius ?? 0)
        : Number(shape.radius ?? shape.r ?? 0);
      minCanvasX = cx - radius;
      maxCanvasX = cx + radius;
      minCanvasY = cy - radius;
      maxCanvasY = cy + radius;
    } else {
      return;
    }
    const minX = Math.max(0, Math.floor(minCanvasX / frameWidth * width) - 1);
    const maxX = Math.min(width - 1, Math.ceil(maxCanvasX / frameWidth * width));
    const minY = Math.max(0, Math.floor(minCanvasY / CANVAS_HEIGHT * height) - 1);
    const maxY = Math.min(height - 1, Math.ceil(maxCanvasY / CANVAS_HEIGHT * height));
    for (let y = minY; y <= maxY; y += 1) {
      const canvasY = (y + 0.5) * CANVAS_HEIGHT / height;
      for (let x = minX; x <= maxX; x += 1) {
        const index = y * width + x;
        if (values[index] < 0) continue;
        const canvasX = (x + 0.5) * frameWidth / width;
        if (containsShape(shape, canvasX, canvasY)) values[index] = code;
      }
    }
  };
  const paintCharge = (charge: SampledCharge) => {
    for (const center of charge.centers) {
      const shapesBySlot = new Map<string, JsonObject[]>();
      for (const primitive of charge.primitives) {
        const slot = primitive.fill === 'outer' ? charge.slot : charge.innerSlot;
        const shapes = shapesBySlot.get(slot) ?? [];
        shapes.push(primitiveShape(
          primitive, center.x, center.y, charge.size * CANVAS_HEIGHT, center.rotation, center.mirror,
        ));
        shapesBySlot.set(slot, shapes);
      }
      for (const [slot, shapes] of shapesBySlot) {
        const code = slotCodeByName.get(slot);
        if (code === undefined) throw new RangeError(`Слот ${slot} отсутствует в описании палитры`);
        for (const shape of shapes) paintShape(shape, code);
      }
    }
  };
  for (const node of spec.root.layers) {
    if (node.kind === 'repeat') {
      const chargeId = (node.pattern as Record<string, unknown>).chargeId;
      const charge = draft.charges.find(({ id }) => id === chargeId);
      if (charge) paintCharge(charge);
      continue;
    }
    if (node.kind !== 'layer') continue;
    if (node.layer.role === 'charge') {
      const charge = draft.charges.find(({ id }) => node.layer.id.startsWith(`${id}-`));
      if (charge) paintCharge(charge);
      continue;
    }
    if (typeof node.layer.fill !== 'string') continue;
    const code = slotCodeByName.get(node.layer.fill);
    if (code === undefined) throw new RangeError(`Слот ${node.layer.fill} отсутствует в описании палитры`);
    paintShape(node.layer.shape as Record<string, unknown>, code);
  }
  return {
    width, height, pixelSize: CANVAS_HEIGHT / height, values, slotIds,
  };
}

function chargeBackgroundsFor(draft: ProfiledDraft) {
  if (!draft.field) return [];
  return draft.charges.flatMap((charge) => charge.centers.map(({ x, y }) => {
    let backgroundSlot = draft.field!.regions.find((region) =>
      region.visiblePolygons.some((polygon) => containsPolygon(x, y, polygon)),
    )?.slot ?? 's1';
    for (const ordinary of draft.ordinaryPaint?.paintLayers ?? []) {
      if (ordinary.polygons.some((polygon) => containsPolygon(x, y, polygon)) && typeof ordinary.fill === 'string') {
        backgroundSlot = ordinary.fill;
      }
    }
    return { chargeSlot: charge.slot, backgroundSlot, diameterRatio: charge.size };
  }));
}

function outlineValidationFeatures(
  outline: NonNullable<ProfiledDraft['outline']>,
  rasterWidth: number,
  rasterHeight: number,
): NonNullable<FlagValidationEvidence['outlineFeatures']> {
  const features: NonNullable<FlagValidationEvidence['outlineFeatures']> = [];
  const scaleX = rasterWidth / outline.width;
  const scaleY = rasterHeight / outline.height;
  const addFeatures = (
    type: 'tooth' | 'scallop' | 'tab' | 'edge',
    count: number,
    minimumWidth: number,
  ) => {
    if (!Number.isFinite(count) || count <= 0 || !Number.isFinite(minimumWidth)) return;
    for (let index = 0; index < count; index += 1) {
      features.push({ type, minimumWidthPx: minimumWidth });
    }
  };

  if (outline.type === 'BANNER') {
    const settings = FLAG_OUTLINE_CONFIG.types.BANNER;
    const params = outline.params;
    const lowerEdge = String(params.lowerEdge ?? settings.defaults.lowerEdge).toUpperCase();
    const count = Number(params.lowerCount);
    if (lowerEdge === 'TEETH') {
      const teeth = Number.isInteger(count) ? count : settings.defaults.teethCount;
      const step = outline.width / teeth;
      const depth = Number(params.lowerDepthFactor ?? settings.defaults.teethDepthFactor) * step * 2;
      addFeatures('tooth', teeth, Math.min(step * scaleX, depth * scaleY));
    } else if (lowerEdge === 'SCALLOP') {
      const scallops = Number.isInteger(count) ? count : settings.defaults.scallopCount;
      const step = outline.width / scallops;
      addFeatures('scallop', scallops, Math.min(step * scaleX, step * 0.5 * scaleY));
    } else if (lowerEdge === 'TABS') {
      const tabs = Number.isInteger(count) ? count : settings.defaults.tabCount;
      const step = outline.width / tabs;
      const tabHeight = Number(params.tabHeight ?? settings.defaults.tabHeight);
      const tabWidth = step * settings.tabWidthStepRatio;
      addFeatures('tab', tabs, Math.min(tabWidth * scaleX, tabHeight * scaleY));
    }
  }

  if (outline.edge && outline.edge.effectiveCount > 0) {
    const edgeLength = outline.type === 'BANNER'
      ? outline.width
      : outline.type === 'PENNANT'
        ? Number(outline.params.thickness ?? FLAG_OUTLINE_CONFIG.types.PENNANT.defaultThickness)
        : outline.height;
    const step = edgeLength / outline.edge.effectiveCount;
    const minimumWidth = Math.min(
      outline.edge.depth * Math.min(scaleX, scaleY),
      step * Math.min(scaleX, scaleY),
    );
    addFeatures('edge', outline.edge.effectiveCount, minimumWidth);
  }
  return features;
}

function outlineAngleValidationPaths(
  outline: NonNullable<ProfiledDraft['outline']>,
): NonNullable<FlagValidationEvidence['outlinePaths']> {
  const lowerEdge = String(outline.params.lowerEdge ?? '').toUpperCase();
  const needsAngleCheck = outline.type === 'SWALLOW' ||
    Boolean(outline.edge) ||
    (outline.type === 'BANNER' && ['POINT', 'SWALLOW', 'TEETH'].includes(lowerEdge));
  if (!needsAngleCheck) return [];
  return [
    { points: outline.boundary, operator: 'OUTLINE', closed: true },
    ...outline.cutouts.map((points, index) => ({
      points,
      operator: `OUTLINE_CUTOUT_${index + 1}`,
      closed: true,
    })),
  ];
}

function measureRenderedSvg(svg: string): { primitiveCount: number; pathPointCount: number } {
  const primitiveCount = [...svg.matchAll(/<(?:path|rect|circle|polygon|use)\b/g)].length;
  let pathPointCount = 0;
  const countVertices = (path: string) => {
    const tokens = path.match(/[A-Za-z]|[-+]?(?:\d*\.?\d+)(?:[eE][-+]?\d+)?/g) ?? [];
    const arity: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, A: 7 };
    let command = '';
    let cursor = 0;
    let count = 0;
    while (cursor < tokens.length) {
      if (/^[A-Za-z]$/.test(tokens[cursor])) {
        command = tokens[cursor++].toUpperCase();
        if (command === 'Z') {
          command = '';
          continue;
        }
      }
      const argumentCount = arity[command];
      if (!argumentCount || cursor + argumentCount > tokens.length ||
        /^[A-Za-z]$/.test(tokens[cursor])) break;
      cursor += argumentCount;
      count += 1;
      if (command === 'M') command = 'L';
    }
    return count;
  };
  for (const match of svg.matchAll(/<path\b[^>]*\bd="([^"]*)"/g)) {
    pathPointCount += countVertices(match[1]);
  }
  for (const match of svg.matchAll(/<polygon\b[^>]*\bpoints="([^"]*)"/g)) {
    const values = match[1].trim().split(/[ ,]+/).filter(Boolean);
    pathPointCount += Math.floor(values.length / 2);
  }
  return { primitiveCount, pathPointCount };
}

function makeValidationEvidence(
  draft: ProfiledDraft,
  options: { includeSvg?: boolean; compositionSubset?: boolean } = {},
): FlagValidationEvidence {
  if (!draft.spec || !draft.field || !draft.outline) throw new Error('Для полной проверки нужны FlagSpec, поле и контур');
  const compositionSubset = options.compositionSubset === true;
  const recordValidationPaths = !compositionSubset;
  // Локальная проверка S4 использует тот же валидатор на уменьшенном растре;
  // окончательная проверка S8 всё равно строит эталонный и высокодетальный растр.
  const spec = draft.spec;
  const rasterHeight = compositionSubset
    ? Math.min(80, FLAG_VALIDATION_CONFIG.referenceRasterHeight)
    : FLAG_VALIDATION_CONFIG.referenceRasterHeight;
  const rasterWidth = Math.max(1, Math.round(rasterHeight * spec.outline.aspect));
  const frameWidth = CANVAS_HEIGHT * spec.outline.aspect;
  const scaleX = rasterWidth / frameWidth;
  const scaleY = rasterHeight / CANVAS_HEIGHT;
  const layerInputs: FlagRasterLayerInput[] = [];
  const layerInfo: FlagValidationEvidence['layers'] = [];
  const slotsByLayer = new Map<string, string>();
  const paths: FlagValidationEvidence['paths'] = [];
  let primitiveCount = 0;
  let pathPointCount = 0;
  const scaledShape = (
    shape: Record<string, unknown>,
    sx: number,
    sy: number,
    layerId?: string,
    operator?: string,
    module?: string,
    recordPath = true,
    countPathPoints = true,
  ): FlagRasterShape => {
    if (shape.type === 'polygon' && Array.isArray(shape.points)) {
      const points = (shape.points as { x: number; y: number }[]).map(({ x, y }) => ({ x: x * sx, y: y * sy }));
      if (recordPath) paths.push({ points, layerId, operator, module, closed: true, sunRay: module === 'M07' });
      if (countPathPoints) pathPointCount += points.length;
      return { type: 'polygon', points };
    }
    if (shape.type === 'circle') {
      return { type: 'circle', cx: Number(shape.cx) * sx, cy: Number(shape.cy) * sy, radius: Number(shape.radius) * sy };
    }
    if (shape.type === 'ring') {
      return {
        type: 'ring', cx: Number(shape.cx) * sx, cy: Number(shape.cy) * sy,
        innerRadius: Number(shape.innerRadius) * sy, outerRadius: Number(shape.outerRadius) * sy,
      };
    }
    if (shape.type === 'multipolygon' && Array.isArray(shape.polygons)) {
      const polygons = (shape.polygons as { x: number; y: number }[][]).map((polygon) =>
        polygon.map(({ x, y }) => ({ x: x * sx, y: y * sy })),
      );
      for (const polygon of polygons) {
        if (recordPath) paths.push({ points: polygon, layerId, operator, module, closed: true });
        if (countPathPoints) pathPointCount += polygon.length;
      }
      return { type: 'multipolygon', polygons };
    }
    if (shape.type === 'rect') {
      return {
        type: 'rect', x: Number(shape.x) * sx, y: Number(shape.y) * sy,
        width: Number(shape.width) * sx, height: Number(shape.height) * sy,
      };
    }
    throw new TypeError(`Для проверки не поддержана фигура ${String(shape.type)}`);
  };
  const addInputLayer = (
    id: string,
    role: string,
    slot: string,
    shapes: FlagRasterShape[],
    tags: string[] = [],
    overlayWith?: string[],
    catalogIds?: string[],
    parentId?: string,
    anchor?: string,
    operator?: string,
    module?: string,
    sourceId?: string,
  ) => {
    const color = spec.palette[slot]?.hex;
    if (!color) throw new Error(`Слот ${slot} не имеет цвета для приёмочного растра`);
    layerInputs.push({ id, color: color.toLowerCase(), shapes });
    slotsByLayer.set(id, slot);
    layerInfo.push({
      id, sourceId: sourceId ?? id, role, slot, tags, overlayWith, catalogIds, parentId, anchor, operator, module,
      ...(role === 'ground' ? { touchingEdge: true } : {}),
    });
    primitiveCount += shapes.length;
  };
  const fieldLayerIds = draft.field.regions.map((_, index) =>
    `L${index + 1}-ground-${spec.root.ground.kind === 'split' ? spec.root.ground.op.toLowerCase() : 'fill'}-region`,
  );
  const svgLayerIds = [...fieldLayerIds];
  for (let index = 0; index < draft.field.regions.length; index += 1) {
    const region = draft.field.regions[index];
    const polygons = region.visiblePolygons.length ? region.visiblePolygons : region.polygons;
    const shapes = polygons.length
      ? [scaledShape(
        { type: 'multipolygon', polygons }, scaleX, scaleY, fieldLayerIds[index], draft.fieldOperator, undefined,
        false, false,
      )]
      : [];
    // Приёмочная геометрия может быть разбита на дополнительные куски для растра;
    // V01 считает точки исходных контуров, которые действительно отрисовывает SVG.
    if (recordValidationPaths) {
      for (const polygon of region.polygons) {
        const points = polygon.map(({ x, y }) => ({ x: x * scaleX, y: y * scaleY }));
        paths.push({ points, layerId: fieldLayerIds[index], operator: draft.fieldOperator, closed: true });
        pathPointCount += polygon.length;
      }
    }
    addInputLayer(fieldLayerIds[index], 'ground', region.slot, shapes, ['field'], undefined, undefined, undefined,
      undefined, draft.fieldOperator);
  }
  let nextLayerId = fieldLayerIds.length + 1;
  const renderedRootIds = new Map<string, string>();
  const renderedGroups = new Map<string, string>();
  const validationOrdinaryRecorded = new Set<string>();
  for (const node of spec.root.layers) {
    if (node.kind === 'repeat') {
      const repeatId = `L${nextLayerId++}-charge-repeat`;
      svgLayerIds.push(`${repeatId}-source`);
      const children = node.child.kind === 'group' ? node.child.children : [node.child];
      for (const child of children) {
        if (child.kind !== 'layer') continue;
        const shape = child.layer.shape as Record<string, unknown>;
        const type = String(shape.type ?? 'shape').toLowerCase().replace(/[^a-z0-9-]+/g, '-') || 'shape';
        svgLayerIds.push(`L${nextLayerId++}-${child.layer.role.toLowerCase()}-${type}`);
      }
      continue;
    }
    if (node.kind !== 'layer') continue;
    const type = String((node.layer.shape as Record<string, unknown>).type ?? 'shape')
      .toLowerCase().replace(/[^a-z0-9-]+/g, '-') || 'shape';
    const renderedId = `L${nextLayerId++}-${node.layer.role.toLowerCase()}-${type}`;
    renderedRootIds.set(node.layer.id, renderedId);
    svgLayerIds.push(renderedId);
    const ordinary = draft.ordinarySpecs.find(({ id }) => node.layer.id.startsWith(`${id}-`));
    if (ordinary) renderedGroups.set(renderedId, `ordinary:${ordinary.id}`);
  }
  for (const node of spec.root.layers) {
    if (node.kind !== 'layer' || node.layer.role === 'charge' || typeof node.layer.fill !== 'string') continue;
    const shape = node.layer.shape as Record<string, unknown>;
    const renderedId = renderedRootIds.get(node.layer.id)!;
    const role = node.layer.role;
    const overlayWith = role === 'ordinary' ? fieldLayerIds : undefined;
    const ordinary = draft.ordinarySpecs.find(({ id }) => node.layer.id.startsWith(`${id}-`));
    const sourceOrdinary = draft.ordinaryPaint?.paintLayers.find(({ id }) => node.layer.id.startsWith(`${id}-`));
    const operator = sourceOrdinary?.operator ?? ordinary?.type ?? undefined;
    const shapes = [scaledShape(
      shape, scaleX, scaleY, renderedId, operator, undefined,
      recordValidationPaths && !sourceOrdinary, recordValidationPaths && !sourceOrdinary,
    )];
    if (recordValidationPaths && sourceOrdinary && !validationOrdinaryRecorded.has(sourceOrdinary.id)) {
      validationOrdinaryRecorded.add(sourceOrdinary.id);
      for (const polygon of sourceOrdinary.validationPolygons ?? sourceOrdinary.polygons) {
        paths.push({
          points: polygon.map(({ x, y }) => ({ x: x * scaleX, y: y * scaleY })),
          layerId: renderedId,
          operator: sourceOrdinary.operator,
          closed: true,
        });
      }
    }
    addInputLayer(renderedId, role, node.layer.fill, shapes, node.layer.tags,
      overlayWith, undefined, undefined, undefined, operator, undefined, node.layer.id);
  }
  const a6OrdinaryHost = draft.fieldOperator === 'G02'
    ? undefined
    : draft.ordinarySpecs.find(({ type }) => type === 'O03');
  const a6OrdinaryHostLayerId = a6OrdinaryHost
    ? [...renderedGroups].find(([, group]) => group === `ordinary:${a6OrdinaryHost.id}`)?.[0]
    : undefined;
  let syntheticLayerId = nextLayerId;
  for (const charge of draft.charges) {
    for (const [copyIndex, center] of charge.centers.entries()) {
      const shapesBySlot = new Map<string, JsonObject[]>();
      for (const primitive of charge.primitives) {
        const slot = primitive.fill === 'outer' ? charge.slot : charge.innerSlot;
        const shapes = shapesBySlot.get(slot) ?? [];
        shapes.push(primitiveShape(
          primitive, center.x, center.y, charge.size * CANVAS_HEIGHT, center.rotation, center.mirror,
        ));
        shapesBySlot.set(slot, shapes);
      }
      for (const [slot, rawShapes] of shapesBySlot) {
        const renderedId = `L${syntheticLayerId++}-charge-${charge.moduleId.toLowerCase()}`;
        const shapes = rawShapes.map((shape) =>
          scaledShape(
            shape, scaleX, scaleY, renderedId, undefined, charge.moduleId,
            recordValidationPaths, recordValidationPaths,
          ));
        renderedGroups.set(renderedId, `charge:${charge.id}`);
        const sourceId = `${charge.id}-${copyIndex}-${slot}`;
        const overlayWith = charge.anchor === 'A6' && a6OrdinaryHostLayerId
          ? [a6OrdinaryHostLayerId]
          : undefined;
        addInputLayer(renderedId, 'charge', slot, shapes, ['charge', charge.moduleId], overlayWith,
          [charge.moduleId], charge.id, charge.anchor, undefined, charge.moduleId, sourceId);
      }
    }
  }
  const raster = rasterizeFlagReference(rasterWidth, rasterHeight, layerInputs);
  let componentRaster: FlagValidationEvidence['componentRaster'];
  let componentPaths = paths;
  if (!compositionSubset) {
    const componentRasterHeight = FLAG_VALIDATION_CONFIG.components.highResolutionRasterHeight;
    const componentRasterWidth = Math.max(1, Math.round(componentRasterHeight * spec.outline.aspect));
    const componentScaleX = componentRasterWidth / rasterWidth;
    const componentScaleY = componentRasterHeight / rasterHeight;
    const componentLayerInputs: FlagRasterLayerInput[] = layerInputs.map((input) => ({
      ...input,
      shapes: input.shapes.map((shape): FlagRasterShape => {
        if (shape.type === 'polygon') return {
          type: 'polygon',
          points: shape.points.map(({ x, y }) => ({ x: x * componentScaleX, y: y * componentScaleY })),
        };
        if (shape.type === 'multipolygon') return {
          type: 'multipolygon',
          polygons: shape.polygons.map((polygon) =>
            polygon.map(({ x, y }) => ({ x: x * componentScaleX, y: y * componentScaleY })),
          ),
        };
        if (shape.type === 'circle') return {
          ...shape,
          cx: shape.cx * componentScaleX,
          cy: shape.cy * componentScaleY,
          radius: shape.radius * componentScaleY,
        };
        if (shape.type === 'ring') return {
          ...shape,
          cx: shape.cx * componentScaleX,
          cy: shape.cy * componentScaleY,
          innerRadius: shape.innerRadius * componentScaleY,
          outerRadius: shape.outerRadius * componentScaleY,
        };
        return {
          ...shape,
          x: shape.x * componentScaleX,
          y: shape.y * componentScaleY,
          width: shape.width * componentScaleX,
          height: shape.height * componentScaleY,
        };
      }),
    }));
    componentRaster = rasterizeFlagReference(
      componentRasterWidth,
      componentRasterHeight,
      componentLayerInputs,
      { includeLayerMasks: false },
    );
    componentPaths = paths.map((path) => ({
      ...path,
      points: path.points.map(({ x, y }) => ({ x: x * componentScaleX, y: y * componentScaleY })),
    }));
  }
  const idsByGroup = new Map<string, string[]>();
  for (const [id, group] of renderedGroups) idsByGroup.set(group, [...(idsByGroup.get(group) ?? []), id]);
  for (const layer of layerInfo) {
    const group = renderedGroups.get(layer.id);
    if (group) layer.overlayWith = [...new Set([...(layer.overlayWith ?? []), ...(idsByGroup.get(group) ?? []).filter((id) => id !== layer.id)])];
  }
  let slotRaster: FlagSlotRaster | undefined;
  if (!compositionSubset) {
    const slotIds = Object.fromEntries(spec.slots.items.map((slot, index) => [index, slot]));
    const slotCodeByName = new Map(spec.slots.items.map((slot, index) => [slot, index]));
    const slotCodeByRasterLayer = new Int32Array((raster.layerIdPalette?.length ?? 0) + 1).fill(-1);
    if (raster.layerIdPalette && raster.layerIdIndices) {
      for (let layerIndex = 1; layerIndex <= raster.layerIdPalette.length; layerIndex += 1) {
        const slot = slotsByLayer.get(raster.layerIdPalette[layerIndex - 1]);
        const code = slot ? slotCodeByName.get(slot) : undefined;
        if (code !== undefined) slotCodeByRasterLayer[layerIndex] = code;
      }
    }
    const slotValues = new Int32Array(raster.layerIdIndices?.length ?? raster.layerIds.length).fill(-1);
    for (let index = 0; index < slotValues.length; index += 1) {
      if (raster.layerIdIndices) {
        const layerIndex = raster.layerIdIndices[index];
        if (layerIndex) {
          const code = slotCodeByRasterLayer[layerIndex];
          if (code >= 0) slotValues[index] = code;
        }
        continue;
      }
      const layerId = raster.layerIds[index];
      if (!layerId) continue;
      const slot = slotsByLayer.get(layerId);
      const code = slot ? slotCodeByName.get(slot) : undefined;
      if (code !== undefined) slotValues[index] = code;
    }
    slotRaster = {
      width: rasterWidth,
      height: rasterHeight,
      pixelSize: CANVAS_HEIGHT / rasterHeight,
      values: slotValues,
      slotIds,
    };
  }
  let safeAreaMask: Uint8Array | undefined;
  let outlineExclusionMask: Uint8Array | undefined;
  let emblemMasks: Uint8Array[] | undefined;
  let compositionMask: Uint8Array | undefined;
  if (!compositionSubset) {
    const scaleOutlinePolygon = (polygon: readonly { x: number; y: number }[]) =>
      polygon.map(({ x, y }) => ({ x: x * scaleX, y: y * scaleY }));
    safeAreaMask = rasterizeFlagPolygonMask(
      rasterWidth, rasterHeight, [scaleOutlinePolygon(draft.outline.safe_area)],
    );
    outlineExclusionMask = rasterizeFlagPolygonMask(
      rasterWidth, rasterHeight, draft.outline.cutouts.map(scaleOutlinePolygon),
    );
    emblemMasks = [];
    compositionMask = new Uint8Array(64 * 64);
    for (let groupIndex = 0; groupIndex < draft.charges.length; groupIndex += 1) {
      const chargePrefix = `${draft.charges[groupIndex].id}-`;
      const groupShapes = layerInputs
        .filter(({ id }) => id.startsWith(chargePrefix))
        .flatMap(({ shapes }) => shapes)
        .map((shape): FlagRasterShape => {
        if (shape.type === 'polygon') return {
          type: 'polygon',
          points: shape.points.map(({ x, y }) => ({ x: x * 64 / rasterWidth, y: y * 64 / rasterHeight })),
        };
        if (shape.type === 'circle') return {
          type: 'circle', cx: shape.cx * 64 / rasterWidth, cy: shape.cy * 64 / rasterHeight,
          radius: shape.radius * 64 / rasterHeight,
        };
        if (shape.type === 'ring') return {
          type: 'ring', cx: shape.cx * 64 / rasterWidth, cy: shape.cy * 64 / rasterHeight,
          innerRadius: shape.innerRadius * 64 / rasterHeight, outerRadius: shape.outerRadius * 64 / rasterHeight,
        };
        if (shape.type === 'multipolygon') return {
          type: 'multipolygon',
          polygons: shape.polygons.map((polygon) =>
            polygon.map(({ x, y }) => ({ x: x * 64 / rasterWidth, y: y * 64 / rasterHeight })),
          ),
        };
        return {
          type: 'rect', x: shape.x * 64 / rasterWidth, y: shape.y * 64 / rasterHeight,
          width: shape.width * 64 / rasterWidth, height: shape.height * 64 / rasterHeight,
        };
        });
      const maskRaster = rasterizeFlagReference(64, 64, [{ id: 'emblem-mask', color: '#000000', shapes: groupShapes }]);
      const mask = Uint8Array.from(maskRaster.colors, (color) => color ? 1 : 0);
      emblemMasks.push(mask);
      for (let index = 0; index < mask.length; index += 1) compositionMask[index] ||= mask[index];
    }
  }
  const chargeBackgrounds = compositionSubset ? undefined : chargeBackgroundsFor(draft);
  const svg = options.includeSvg === false ? undefined : renderFlagSpec(spec);
  const svgMetrics = svg ? measureRenderedSvg(svg) : undefined;
  return {
    raster,
    ...(componentRaster ? { componentRaster } : {}),
    layers: layerInfo,
    ...(slotRaster ? { slotRaster } : {}),
    ...(chargeBackgrounds ? { chargeBackgrounds } : {}),
    tincture: false,
    primitiveCount: svgMetrics?.primitiveCount ?? primitiveCount,
    pathPointCount: svgMetrics?.pathPointCount ?? pathPointCount,
    paths,
    componentPaths,
    catalogIds: [...new Set(draft.charges.map(({ moduleId }) => moduleId))],
    expectedEmblemMaskCount: draft.charges.length,
    ...(emblemMasks ? { emblemMasks } : {}),
    ...(compositionMask ? { compositionMask } : {}),
    ...(outlineExclusionMask ? { outlineExclusionMask } : {}),
    ...(safeAreaMask ? { safeAreaMask } : {}),
    svgLayerIds,
    ...(svg ? { svg } : {}),
    outlineFeatures: outlineValidationFeatures(draft.outline, rasterWidth, rasterHeight),
    outlinePaths: outlineAngleValidationPaths(draft.outline),
    allowedTags: draft.profile.tags_allowed ?? [],
  };
}

function checkCompositionSubstep(
  draft: ProfiledDraft,
  context: FlagGenerationContext,
  substep: 'S4.1' | 'S4.2' | 'S4.3',
  localAttempt: number,
): string | null {
  if (!draft.spec) throw new Error('Для промежуточной проверки S4 отсутствует FlagSpec');
  const evidence = makeValidationEvidence(draft, { includeSvg: false, compositionSubset: true });
  const scheduledForRemoval = [...planTinyVisibleLayerRemoval(draft, evidence).layerIds];
  const rules = ['V08', 'V14'] as const;
  const report = validateFlag(draft.spec, evidence, {
    onlyRules: rules,
    skipRules: ['V02', 'V03'],
    ignoreLayerIds: scheduledForRemoval,
  });
  const failures = rules
    .map((rule) => [rule, report.checks[rule]] as const)
    .filter(([, result]) => !result.passed);
  if (!failures.length) return null;

  const messages: string[] = [];
  for (const [rule, result] of failures) {
    const details = result.details.length ? result.details : [JSON.stringify(result.value)];
    const layerIds = [...new Set(details.flatMap((detail) =>
      detail.match(/\bL\d+-[a-z0-9]+-[a-z0-9-]+\b/g) ?? [],
    ))];
    const relatedLayers = evidence.layers.filter(({ id }) => layerIds.includes(id));
    const operators = [...new Set(relatedLayers.map(({ operator }) => operator).filter((id): id is string => !!id))];
    const modules = [...new Set(relatedLayers
      .map(({ module, catalogIds }) => module ?? catalogIds?.[0])
      .filter((id): id is string => !!id))];
    context.stats.diagnostics.push({
      attempt: context.attempt + 1,
      stage: 'S4_COMPOSITION',
      code: rule,
      measured: result.value,
      threshold: result.limit ?? null,
      layerId: layerIds[0] ?? null,
      layerIds,
      layerContributors: relatedLayers.map(({ id, sourceId, parentId, anchor, operator, module, catalogIds, tags }) => ({
        layerId: id,
        sourceId: sourceId ?? null,
        parentId: parentId ?? null,
        anchor: anchor ?? null,
        operator: operator ?? null,
        module: module ?? catalogIds?.[0] ?? null,
        tags: tags ?? [],
      })),
      operator: operators.length ? operators.join(',') : layerIds.length ? null : draft.fieldOperator ?? null,
      module: modules.length ? modules.join(',') : null,
      profileId: draft.profile.id,
      details: [`${substep}, локальная попытка ${localAttempt}`, ...details],
    });
    messages.push(`${rule}: ${details.join(', ')}`);
  }
  return messages.join(' | ');
}

function recordCompositionAttemptError(
  draft: ProfiledDraft,
  context: FlagGenerationContext,
  substep: 'S4.1' | 'S4.2' | 'S4.3',
  localAttempt: number,
  error: unknown,
): string {
  const message = error instanceof Error ? error.message : String(error);
  context.stats.diagnostics.push({
    attempt: context.attempt + 1,
    stage: 'S4_COMPOSITION',
    code: 'S4_COMPOSITION',
    measured: null,
    threshold: null,
    layerId: null,
    layerIds: [],
    operator: draft.fieldOperator ?? null,
    module: null,
    profileId: draft.profile.id,
    details: [`${substep}, локальная попытка ${localAttempt}`, message],
  });
  return message;
}

type TinyVisibleLayerPlan = {
  removeOrdinaries: Set<string>;
  removeCharges: Set<string>;
  removeSourceIds: Set<string>;
  layerIds: Set<string>;
};

function planTinyVisibleLayerRemoval(
  draft: ProfiledDraft,
  evidence: FlagValidationEvidence,
): TinyVisibleLayerPlan {
  const removeOrdinaries = new Set<string>();
  const removeCharges = new Set<string>();
  const removeSourceIds = new Set<string>();
  const layerIds = new Set<string>();
  let totalArea = 0;
  const visibleByLayer = new Map<string, number>();
  if (evidence.raster.layerIdIndices && evidence.raster.layerIdPalette) {
    const visibleCounts = new Uint32Array(evidence.raster.layerIdPalette.length + 1);
    for (const layerIndex of evidence.raster.layerIdIndices) {
      if (layerIndex) visibleCounts[layerIndex] += 1;
    }
    for (let layerIndex = 1; layerIndex < visibleCounts.length; layerIndex += 1) {
      const count = visibleCounts[layerIndex];
      if (!count) continue;
      totalArea += count;
      visibleByLayer.set(evidence.raster.layerIdPalette[layerIndex - 1], count);
    }
  } else {
    for (const id of evidence.raster.layerIds) {
      if (id) {
        totalArea += 1;
        visibleByLayer.set(id, (visibleByLayer.get(id) ?? 0) + 1);
      }
    }
  }
  if (!totalArea) return { removeOrdinaries, removeCharges, removeSourceIds, layerIds };
  const threshold = FLAG_VALIDATION_CONFIG.components.minimumVisibleLayerAreaShare;
  const ordinaryVisibleArea = new Map<string, number>();
  const chargeVisibleArea = new Map<string, number>();
  const sourceVisibleArea = new Map<string, number>();
  for (const layer of evidence.layers) {
    if (layer.role === 'ground') continue;
    const sourceId = layer.sourceId ?? layer.id;
    const ordinary = draft.ordinarySpecs.find(({ id }) => !!id && sourceId.startsWith(`${id}-`));
    const charge = ordinary
      ? undefined
      : draft.charges.find(({ id }) => sourceId.startsWith(`${id}-`));
    const visibleArea = visibleByLayer.get(layer.id) ?? 0;
    if (ordinary?.id) {
      ordinaryVisibleArea.set(ordinary.id, (ordinaryVisibleArea.get(ordinary.id) ?? 0) + visibleArea);
    } else if (charge) {
      chargeVisibleArea.set(charge.id, (chargeVisibleArea.get(charge.id) ?? 0) + visibleArea);
    } else {
      sourceVisibleArea.set(sourceId, (sourceVisibleArea.get(sourceId) ?? 0) + visibleArea);
    }
  }
  // Порог применяется к суммарной видимой доле логического слоя, а не к его отдельным полигонам.
  for (const [id, area] of ordinaryVisibleArea) if (area / totalArea < threshold) removeOrdinaries.add(id);
  for (const [id, area] of chargeVisibleArea) if (area / totalArea < threshold) removeCharges.add(id);
  for (const [id, area] of sourceVisibleArea) if (area / totalArea < threshold) removeSourceIds.add(id);
  for (const layer of evidence.layers) {
    if (layer.role === 'ground') continue;
    const sourceId = layer.sourceId ?? layer.id;
    const ordinary = draft.ordinarySpecs.find(({ id }) => !!id && sourceId.startsWith(`${id}-`));
    const charge = ordinary
      ? undefined
      : draft.charges.find(({ id }) => sourceId.startsWith(`${id}-`));
    if (ordinary?.id && removeOrdinaries.has(ordinary.id) ||
        charge && removeCharges.has(charge.id) ||
        removeSourceIds.has(sourceId)) {
      layerIds.add(layer.id);
    }
  }
  return { removeOrdinaries, removeCharges, removeSourceIds, layerIds };
}

function pruneTinyVisibleLayers(draft: ProfiledDraft, evidence: FlagValidationEvidence): number {
  if (!draft.spec) return 0;
  const { removeOrdinaries, removeCharges, removeSourceIds } = planTinyVisibleLayerRemoval(draft, evidence);
  if (removeCharges.size) {
    throw new FlagGenerationAttemptError(
      'S8_VALIDATION',
      `Заряды ${[...removeCharges].join(',')} ниже порога видимой площади; группы не удаляются, попытка отклонена`,
    );
  }
  if (!removeCharges.size && !removeOrdinaries.size && !removeSourceIds.size) return 0;
  const shouldRemove = (node: FlagNode) => {
    if (node.kind === 'repeat') {
      const chargeId = (node.pattern as Record<string, unknown>).chargeId;
      return typeof chargeId === 'string' && removeCharges.has(chargeId);
    }
    if (node.kind !== 'layer') return false;
    const id = node.layer.id;
    return [...removeCharges, ...removeOrdinaries, ...removeSourceIds].some((prefix) =>
      id === prefix || id.startsWith(`${prefix}-`),
    );
  };
  const originalLayers = draft.spec.root.layers;
  const keptLayers = originalLayers.filter((node) => !shouldRemove(node));
  const removedCount = originalLayers.length - keptLayers.length;
  if (!removedCount) return 0;
  draft.spec.root.layers = keptLayers;
  draft.ordinarySpecs = draft.ordinarySpecs.filter(({ id }) => !id || !removeOrdinaries.has(id));
  draft.ordinaryCount = draft.ordinarySpecs.length;
  if (draft.ordinaryPaint) {
    draft.ordinaryPaint.paintLayers = draft.ordinaryPaint.paintLayers.filter((layer) =>
      ![...removeOrdinaries].some((id) => layer.id === id || layer.id.startsWith(`${id}-`)),
    );
    draft.ordinaryPaint.totalCost = draft.ordinaryPaint.paintLayers.reduce((sum, layer) => sum + layer.cost, 0);
  }
  const usedSlots = new Set<string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if ((key === 'fill' || key.endsWith('_fill') || key === 'slot' || key.endsWith('_slot')) &&
        typeof child === 'string') usedSlots.add(child);
      else visit(child);
    }
  };
  visit(draft.spec.root);
  const retainedSlots = draft.spec.slots.items.filter((slot) => usedSlots.has(slot));
  const slotMap = new Map(retainedSlots.map((slot, index) => [slot, `s${index + 1}`]));
  const remapSlot = (slot: string) => slotMap.get(slot) ?? slot;
  const remapSlotReferences = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const child of value) remapSlotReferences(child);
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if ((key === 'fill' || key.endsWith('_fill') || key === 'slot' || key.endsWith('_slot')) &&
        typeof child === 'string') {
        (value as Record<string, unknown>)[key] = remapSlot(child);
      } else if (key === 'slots' && Array.isArray(child)) {
        (value as Record<string, unknown>)[key] = child.map((slot) =>
          typeof slot === 'string' ? remapSlot(slot) : slot);
      } else {
        remapSlotReferences(child);
      }
    }
  };
  const previousPalette = draft.spec.palette;
  const previousEqualities = draft.spec.slots.equalities;
  remapSlotReferences(draft.spec.root);
  remapSlotReferences(draft.ordinarySpecs);
  remapSlotReferences(draft.ordinaryPaint);
  if (draft.fieldSlots) draft.fieldSlots = draft.fieldSlots.map(remapSlot);
  if (draft.fieldParams?.slots && Array.isArray(draft.fieldParams.slots)) {
    draft.fieldParams.slots = (draft.fieldParams.slots as string[]).map(remapSlot);
  }
  if (draft.field) {
    draft.field.regions = draft.field.regions.map((region) => ({ ...region, slot: remapSlot(region.slot) }));
  }
  draft.charges = draft.charges.map((charge) => ({
    ...charge, slot: remapSlot(charge.slot), innerSlot: remapSlot(charge.innerSlot),
  }));
  draft.spec.slots.items = retainedSlots.map((slot) => slotMap.get(slot)!);
  draft.spec.slots.equalities = previousEqualities
    .filter(([left, right]) => usedSlots.has(left) && usedSlots.has(right))
    .map(([left, right]) => [remapSlot(left), remapSlot(right)]);
  draft.spec.palette = Object.fromEntries(retainedSlots.map((slot) => [remapSlot(slot), previousPalette[slot]]));
  draft.spec.meta.color_count = draft.spec.slots.items.length;
  draft.spec.meta.complexity = (draft.field?.complexityCost ?? 0) +
    (draft.ordinaryPaint?.totalCost ?? 0) + draft.charges.reduce((sum, charge) => sum + charge.cost, 0);
  stampFlagHashes(draft.spec);
  return removedCount;
}

function createHooks(
  profileId: string,
  era: number,
  onValidationRuleTiming?: (rule: FlagValidationRule, durationMs: number, section?: string) => void,
  ablationScenario?: FlagAblationScenario,
  onCompositionTiming?: (section: string, durationMs: number) => void,
): FlagGenerationHooks<ProfiledDraft> {
  return {
    selectProfile(context: FlagGenerationContext) {
      return makeDraft(profileId, era, context.seed, context.random('S1_PROFILE'));
    },
    selectOutline(draft, context) {
      const random = context.random('S2_OUTLINE');
      if (!draft.isFallback && !ablationScenario) {
        const generation = draft.profile.GEN;
        if (!generation) throw new Error(`Для профиля ${draft.profile.id} нет распределений генерации`);
        const ordinaryCountWeights = draft.profile.id === 'P05' && draft.fieldProfile.GEN
          ? draft.fieldProfile.GEN.ordinaryCountWeights
          : generation.ordinaryCountWeights;
        draft.ordinaryCount = chooseCount(ordinaryCountWeights, random);
      }
      const configuredAnchors = draft.chargeProfile.CHG?.anchors;
      const chargedAnchors = Object.entries(configuredAnchors ?? {})
        .filter(([, weight]) => typeof weight === 'number' && weight > 0)
        .map(([anchor]) => anchor as FlagChargeAnchor);
      const generation = draft.profile.GEN;
      if (!draft.isFallback && !generation) {
        throw new Error(`Для профиля ${draft.profile.id} нет распределений генерации`);
      }
      const chargeCountCanBePositive = Boolean(generation &&
        Object.entries(generation.chargeGroupCountWeights).some(([count, weight]) =>
          Number(count) > 0 && typeof weight === 'number' && weight > 0));
      const hasMandatoryOrdinary = ['P13', 'P18', 'P19'].includes(draft.profile.id);
      const hasOrdinaryPotential = hasMandatoryOrdinary ||
        (draft.ordinaryCount > 0 && Object.keys(draft.fieldProfile.ORD ?? {}).length > 0);
      const needsCharge = chargeCountCanBePositive || !hasOrdinaryPotential;
      const fitAnchors = draft.chargeProfile.CHG?.modules &&
        needsCharge &&
        chargedAnchors.length > 0 &&
        chargedAnchors.every((anchor) => anchor === 'A1' || anchor === 'A2')
        ? chargedAnchors
        : undefined;
      makeOutline(draft, random, fitAnchors);
      return draft;
    },
    selectStyleAndComplexity(draft, context) {
      const random = context.random('S3_STYLE');
      const special = draft.fieldProfile.SPECIAL;
      const operatorWeights = configuredChoiceWeights(special?.fieldOperatorWeights) ?? draft.fieldProfile.GND;
      let descriptor = weighted<string>(operatorWeights, random);
      if (ablationScenario === 'FIELD_ONLY' && resolveFieldOperator(descriptor) === 'G01') {
        const multiRegionWeights = Object.fromEntries(Object.entries(operatorWeights ?? {})
          .filter(([candidate]) => resolveFieldOperator(candidate) !== 'G01'));
        if (Object.keys(multiRegionWeights).length) {
          descriptor = weighted<string>(multiRegionWeights, random);
        }
      }
      draft.fieldDescriptor = descriptor;
      draft.fieldOperator = resolveFieldOperator(descriptor);
      try {
        draft.fieldParams = fieldParameters(
          descriptor,
          draft.fieldOperator,
          random,
          special,
          draft.aspect ?? 1.5,
          draft.outline,
          draft.fieldSlots ?? SYMBOLIC_SLOTS,
        );
      } catch (error) {
        if (error instanceof RangeError) {
          throw new FlagGenerationAttemptError('S3_STYLE', `Параметры поля отклонены генератором: ${error.message}`);
        }
        throw error;
      }
      const symmetryWeights = draft.profile.SYM;
      const hasCompleteSymmetryWeights = symmetryWeights &&
        Object.entries(symmetryWeights).length > 0 &&
        Object.entries(symmetryWeights).every(([symmetry, weight]) =>
          FLAG_PLACEMENT_CONFIG.symmetry.classes.includes(symmetry as FlagSymmetryClass) && weight !== null);
      // Невзвешенные и групповые обозначения не превращаем в выдуманное распределение; фактический класс считается по растру.
      draft.symmetry = hasCompleteSymmetryWeights
        ? weighted<FlagSymmetryClass>(symmetryWeights, random)
        : undefined;
      if (!draft.isFallback) {
        const generation = draft.profile.GEN;
        if (!generation) throw new Error(`Для профиля ${draft.profile.id} нет распределений генерации`);
        if (ablationScenario) {
          const ordinaryCountWeights = draft.profile.id === 'P05' && draft.fieldProfile.GEN
            ? draft.fieldProfile.GEN.ordinaryCountWeights
            : generation.ordinaryCountWeights;
          draft.ordinaryCount = chooseCount(ordinaryCountWeights, random);
          draft.chargeCount = chooseCount(generation.chargeGroupCountWeights, random);
          draft.ordinaryCount = ablationScenario === 'FIELD_ONLY' ? 0 : 1;
          draft.chargeCount = ablationScenario === 'FIELD_ONE_ORDINARY_BORDURE_ONE_CHARGE' ? 1 : 0;
        }
        if (draft.profile.id === 'P13' || draft.profile.id === 'P18') draft.ordinaryCount = Math.max(1, draft.ordinaryCount);
        if (draft.profile.id === 'P19') draft.ordinaryCount = Math.max(1, draft.ordinaryCount);
        if (draft.fieldProfile.ORD) {
          const possibleAnchors = potentialChargeAnchors(draft);
          const chargeCanBeSelected = ablationScenario
            ? draft.chargeCount > 0
            : Object.entries(generation.chargeGroupCountWeights).some(([count, weight]) =>
              Number(count) > 0 && typeof weight === 'number' && weight > 0);
          const onlyCenterAnchor = chargeCanBeSelected &&
            possibleAnchors.length === 1 && possibleAnchors[0] === 'A1';
          const ordinaryWeights: FlagProfileWeights = { ...draft.fieldProfile.ORD };
          if (onlyCenterAnchor) {
            for (const descriptor of Object.keys(ordinaryWeights)) {
              if (ordinaryType(descriptor) === 'O03' && !/AT_EDGE|EDGE/i.test(descriptor)) {
                delete ordinaryWeights[descriptor];
              }
            }
          }
          if (!Object.keys(ordinaryWeights).length && draft.ordinaryCount > 0) {
            throw new FlagGenerationAttemptError(
              'S3_STYLE',
              `В профиле ${draft.profile.id} нет допустимого ординария для ${possibleAnchors.join(',')} при ${draft.chargeCount} группах зарядов`,
            );
          }
          const selectedTypes = new Set<FlagOrdinaryType>();
          for (let index = 0; index < draft.ordinaryCount; index += 1) {
            for (let retry = 0; retry < 12; retry += 1) {
              const selected = weighted<string>(ordinaryWeights, random);
              const type = ordinaryType(selected);
              if (type && !selectedTypes.has(type)) {
                selectedTypes.add(type);
                const id = `ordinary-${index}`;
                draft.ordinarySpecs.push({
                  id,
                  type,
                  fill: 's2',
                  params: sampleOrdinaryParameters(selected, draft.profile.id, draft.aspect ?? 1.5, random, 's2'),
                });
                draft.ordinaryDescriptors[id] = selected;
                break;
              }
            }
          }
        }
        if (draft.profile.id === 'P13') {
          const canton = draft.ordinarySpecs.find(({ type }) => type === 'O08') ??
            { id: 'mandatory-canton', type: 'O08' as const, fill: 's2', params: {} };
          const alternatives = draft.ordinarySpecs.filter(({ type }) => type !== 'O08');
          const keepCount = Math.min(1, Math.max(0, draft.ordinaryCount - 1));
          const retainedAlternatives = alternatives.length <= keepCount
            ? alternatives
            : keepCount ? [chooseUniform(alternatives, random)] : [];
          draft.ordinarySpecs = [canton, ...retainedAlternatives];
        } else if (draft.profile.id === 'P18') {
          if (!draft.ordinarySpecs.some(({ type }) => type === 'O08')) {
            draft.ordinarySpecs.unshift({ id: 'mandatory-canton', type: 'O08', fill: 's2', params: {} });
          }
        }
        if (draft.profile.id === 'P19') {
          let cross = draft.ordinarySpecs.find(({ type }) => type === 'O01');
          if (!cross) {
            cross = {
              id: 'mandatory-cross',
              type: 'O01',
              fill: 's2',
              params: sampleOrdinaryParameters('CROSS:SCANDINAVIAN:REQUIRED', draft.profile.id, draft.aspect ?? 1.5, random, 's2'),
            };
            draft.ordinarySpecs.unshift(cross);
            if (cross.id) draft.ordinaryDescriptors[cross.id] = 'CROSS:SCANDINAVIAN:REQUIRED';
          }
          cross.params = { ...cross.params, scandinavian: true };
        }
        draft.ordinaryCount = draft.ordinarySpecs.length;
        if (!ablationScenario) {
          const activeAnchors = draft.chargeProfile.CHG?.modules
            ? applicableAnchorWeights(draft, draft.chargeProfile.CHG.anchors)
            : {};
          const maximumGroups = Object.keys(activeAnchors)
            .reduce((sum, anchor) => sum + (anchor === 'A11' ? 2 : 1), 0);
          const minimumGroups = draft.ordinaryCount === 0 ? 1 : 0;
          const feasibleChargeCountWeights: FlagProfileWeights = Object.fromEntries(
            Object.entries(generation.chargeGroupCountWeights)
              .filter(([count, weight]) => {
                const groupCount = Number(count);
                return typeof weight === 'number' && weight > 0 &&
                  Number.isInteger(groupCount) &&
                  groupCount >= minimumGroups && groupCount <= maximumGroups;
              }),
          );
          if (!Object.keys(feasibleChargeCountWeights).length) {
            throw new FlagGenerationAttemptError(
              'S3_STYLE',
              `В профиле ${draft.profile.id} нет допустимого числа групп для ${draft.ordinaryCount} ординариев и якорей ${Object.keys(activeAnchors).join(',') || '—'}`,
            );
          }
          draft.chargeCount = chooseCount(feasibleChargeCountWeights, random);
        }
        if (!ablationScenario && draft.ordinaryCount === 0 && draft.chargeCount === 0) {
          throw new FlagGenerationAttemptError(
            'S3_STYLE',
            `В профиле ${draft.profile.id} не выбран ни один ординарий и не доступна группа заряда`,
          );
        }
      } else {
        draft.ordinarySpecs = [];
        draft.ordinaryCount = 0;
        draft.chargeCount = 1;
        draft.fieldOperator = 'G02';
        draft.fieldParams = { bands: 3, axis: 'H', weighting: 'symmetric' };
        draft.fieldSlots = ['s1', 's2', 's1'];
      }
      if (ablationScenario === 'FIELD_ONLY') {
        draft.ordinarySpecs = [];
        draft.ordinaryDescriptors = {};
        draft.ordinaryCount = 0;
        draft.chargeCount = 0;
      } else if (ablationScenario) {
        const selected = draft.ordinarySpecs.find((spec) => !containsBordure(spec));
        const selectedDescriptor = selected?.id ? draft.ordinaryDescriptors[selected.id] : undefined;
        const ordinaryWeights = Object.fromEntries(Object.entries(draft.fieldProfile.ORD ?? {})
          .filter(([key]) => ordinaryType(key) && ordinaryType(key) !== 'O07'));
        const descriptor = selectedDescriptor ??
          (selected
            ? Object.keys(ordinaryWeights).find((key) => ordinaryType(key) === selected.type)
            : undefined) ??
          (Object.keys(ordinaryWeights).length ? weighted<string>(ordinaryWeights, random) : 'CROSS');
        const ordinary: FlagOrdinarySpec = selected
          ? { ...structuredClone(selected), id: 'ablation-ordinary', fill: 's2' }
          : {
            id: 'ablation-ordinary',
            type: ordinaryType(descriptor) ?? 'O01',
            fill: 's2',
            params: sampleOrdinaryParameters(descriptor, draft.profile.id, draft.aspect ?? 1.5, random, 's2'),
          };
        draft.ordinarySpecs = [ordinary];
        draft.ordinaryDescriptors = descriptor ? { 'ablation-ordinary': descriptor } : {};
        if (ablationScenario !== 'FIELD_ONE_ORDINARY') {
          const bordureDescriptor = Object.keys(draft.fieldProfile.ORD ?? {})
            .find((key) => ordinaryType(key) === 'O07');
          const useBordure = Boolean(bordureDescriptor) && Number(draft.seed) % 2 === 0;
          if (useBordure) {
            const borderParams = sampleOrdinaryParameters(
              bordureDescriptor!,
              draft.profile.id,
              draft.aspect ?? 1.5,
              random,
              's3',
            );
            draft.ordinarySpecs.push({
              id: 'ablation-bordure',
              type: 'O07',
              fill: 's3',
              params: borderParams,
            });
            draft.ordinaryDescriptors['ablation-bordure'] = bordureDescriptor!;
          } else {
            ordinary.fimbration = {
              delta: sampleRange(...FLAG_ORDINARY_CONFIG.fimbration, random),
              fill: 's3',
            };
          }
          draft.ordinaryCount = draft.ordinarySpecs.length;
        } else {
          draft.ordinaryCount = 1;
        }
        draft.chargeCount = ablationScenario === 'FIELD_ONE_ORDINARY_BORDURE_ONE_CHARGE' ? 1 : 0;
      }
      return draft;
    },
    compose(draft, context) {
      if (!draft.outline || !draft.fieldOperator || !draft.fieldParams) throw new Error('Перед композицией нужны контур и параметры поля');
      const outlineBoundary = draft.outline.boundary;
      const timeComposition = <T>(section: string, operation: () => T): T => {
        if (!onCompositionTiming) return operation();
        const now = () => typeof performance === 'undefined' ? Date.now() : performance.now();
        const startedAt = now();
        try {
          return operation();
        } finally {
          onCompositionTiming(section, now() - startedAt);
        }
      };
      const width = CANVAS_HEIGHT * (draft.aspect ?? 1.5);
      // Сохраняем входные слоты оператора: обрезка контура может удалить видимую цветовую область.
      if (!Array.isArray(draft.fieldParams.slots)) {
        draft.fieldParams.slots = [...(draft.fieldSlots ?? SYMBOLIC_SLOTS)];
      }
      const node = { op: draft.fieldOperator, params: draft.fieldParams };
      const fieldRandom = context.random('S4_COMPOSITION');
      const composeRandom = context.random('S4_COMPOSITION');
      let field: FlagFieldResult;
      try {
        field = timeComposition('S4.1-построение-поля', () => buildFlagField(
          node, { x0: 0, y0: 0, w: width, h: CANVAS_HEIGHT }, {
          canvasHeight: CANVAS_HEIGHT,
          clipChain: [[outlineBoundary]],
          random: fieldRandom,
          slots: draft.fieldSlots ?? SYMBOLIC_SLOTS,
          },
        ));
      } catch (error) {
        if (error instanceof RangeError) {
          throw new FlagGenerationAttemptError('S4_COMPOSITION', `S4.1: ${error.message}`);
        }
        throw error;
      }
      draft.field = field;
      const isRetryableS4Error = (error: unknown) =>
        error instanceof FlagGenerationAttemptError ||
        error instanceof RangeError ||
        error instanceof TypeError && error.message.startsWith('Invalid FlagSpec:');
      try {
        timeComposition('S4.1-сборка-FlagSpec', () =>
          makeSpec(draft, field, composeRandom, { includeOrdinaries: false, includeCharges: false }));
      } catch (error) {
        if (isRetryableS4Error(error)) {
          throw new FlagGenerationAttemptError('S4_COMPOSITION', `S4.1: ${error instanceof Error ? error.message : String(error)}`);
        }
        throw error;
      }
      const fieldFailure = timeComposition('S4.1-локальная-проверка', () =>
        checkCompositionSubstep(draft, context, 'S4.1', 1));
      if (fieldFailure) {
        throw new FlagGenerationAttemptError('S4_COMPOSITION', `S4.1: ${fieldFailure}`);
      }

      const ordinaryBase = structuredClone(draft.ordinarySpecs);
      const requestedChargeCount = draft.chargeCount;
      let lastFailure = 'S4 не прошёл локальные проверки V02, V03, V08 и V14';
      const ordinaryAttempts = 4;
      for (let ordinaryAttempt = 0; ordinaryAttempt < ordinaryAttempts; ordinaryAttempt += 1) {
        if (ordinaryAttempt === 0) {
          draft.ordinarySpecs = structuredClone(ordinaryBase);
        } else {
          draft.ordinarySpecs = ordinaryBase.map((ordinary) => {
            const copy = structuredClone(ordinary);
            const descriptor = ordinary.id ? draft.ordinaryDescriptors[ordinary.id] : undefined;
            if (!descriptor) return copy;
            const params = sampleOrdinaryParameters(
              descriptor,
              draft.profile.id,
              draft.aspect ?? 1.5,
              composeRandom,
              typeof copy.fill === 'string' ? copy.fill : undefined,
            );
            if (draft.profile.id === 'P19' && ordinary.type === 'O01') params.scandinavian = true;
            return { ...copy, params };
          });
        }
        draft.ordinaryPaint = undefined;
        draft.chargeCount = requestedChargeCount;
        draft.charges = [];
        try {
          timeComposition('S4.2-сборка-ординариев', () =>
            makeSpec(draft, field, composeRandom, { includeOrdinaries: true, includeCharges: false }));
        } catch (error) {
          if (!isRetryableS4Error(error)) throw error;
          lastFailure = recordCompositionAttemptError(draft, context, 'S4.2', ordinaryAttempt + 1, error);
          continue;
        }
        const ordinaryFailure = timeComposition('S4.2-локальная-проверка', () =>
          checkCompositionSubstep(draft, context, 'S4.2', ordinaryAttempt + 1));
        if (ordinaryFailure) {
          lastFailure = ordinaryFailure;
          continue;
        }

        const chargeAttempts = ordinaryAttempt === 0 ? 8 : 1;
        let retryWithNewOrdinary = false;
        for (let chargeAttempt = 0; chargeAttempt < chargeAttempts; chargeAttempt += 1) {
          draft.chargeCount = requestedChargeCount;
          draft.charges = [];
          try {
            timeComposition('S4.3-сборка-зарядов', () => makeSpec(draft, field, composeRandom, {
              includeOrdinaries: false,
              includeCharges: true,
            }));
          } catch (error) {
            if (!isRetryableS4Error(error)) throw error;
            lastFailure = recordCompositionAttemptError(draft, context, 'S4.3', chargeAttempt + 1, error);
            if (error instanceof FlagGenerationAttemptError &&
              error.message.includes('не найдено размещение после') &&
              draft.ordinarySpecs.length) {
              retryWithNewOrdinary = true;
              break;
            }
            continue;
          }
          const diagnosticStart = context.stats.diagnostics.length;
          const chargeFailure = timeComposition('S4.3-локальная-проверка', () =>
            checkCompositionSubstep(draft, context, 'S4.3', chargeAttempt + 1));
          if (chargeFailure) {
            lastFailure = chargeFailure;
            const overlapsOrdinary = context.stats.diagnostics.slice(diagnosticStart).some((diagnostic) =>
              diagnostic.code === 'V08' &&
              diagnostic.layerContributors?.some((layer) => layer.tags?.includes('ordinary')));
            if (!draft.isFallback && draft.ordinarySpecs.length && overlapsOrdinary &&
              ordinaryAttempt + 1 < ordinaryAttempts) {
              retryWithNewOrdinary = true;
              break;
            }
            continue;
          }
          draft.validationEvidence = undefined;
          return draft;
        }
        if (retryWithNewOrdinary) continue;
      }
      throw new FlagGenerationAttemptError('S4_COMPOSITION', lastFailure);
    },
    enforceComplexityBudget(draft) {
      if (!draft.spec) throw new Error('До проверки бюджета не собрана FlagSpec');
      const limit = draft.isFallback ? 3 : draft.profile.CMAX ?? 0;
      if (draft.spec.meta.complexity > limit) {
        throw new FlagGenerationAttemptError('S5_COMPLEXITY', `Стоимость ${draft.spec.meta.complexity} превышает CMAX ${limit}`);
      }
      return draft;
    },
    solvePalette(draft, context) {
      if (!draft.spec) throw new Error('До решения палитры не собрана FlagSpec');
      context.stats.palette_attempts += 1;
      const profileForPalette = draft.profile.PAL
        ? { ...draft.profile, PAL: draft.profile.PAL }
        : draft.profile;
      const result = solveFlagPalette(draft.spec, {
        slotRaster: makeSlotRaster(draft),
        chargeBackgrounds: chargeBackgroundsFor(draft),
        random: context.random('S6_PALETTE'),
        profile: createFlagColorProfile(profileForPalette),
        era: draft.era,
      });
      if (!result.success) {
        throw new FlagGenerationAttemptError(
          'S6_PALETTE',
          `Поле ${draft.fieldOperator}; ординарии ${draft.ordinaryCount}; заряды ${draft.chargeCount}; слоты ${draft.spec.slots.items.length}: ${result.reason}`,
        );
      }
      draft.spec.palette = result.palette;
      draft.spec.meta.color_count = result.colorCount;
      draft.spec.meta.complexity = draft.spec.meta.complexity;
      stampFlagHashes(draft.spec);
      return draft;
    },
    repairGeometry(draft, context) {
      if (!draft.spec) return draft;
      let evidence: FlagValidationEvidence;
      try {
        evidence = makeValidationEvidence(draft);
      } catch (error) {
        if (error instanceof RangeError && error.message.startsWith('Rendered SVG exceeds the 30 KB limit')) {
          throw new FlagGenerationAttemptError('S7_GEOMETRY', error.message);
        }
        if (error instanceof RangeError &&
          error.message === 'GLYPH stroke is thinner than the configured minimum after scaling') {
          throw new FlagGenerationAttemptError('S7_GEOMETRY', error.message);
        }
        if (error instanceof TypeError && error.message.startsWith('Invalid FlagSpec:')) {
          throw new FlagGenerationAttemptError(
            'S7_GEOMETRY',
            `${error.message}; профиль ${draft.profile.id}; поле ${draft.fieldDescriptor ?? draft.fieldOperator}; параметры ${JSON.stringify(draft.fieldParams)}`,
          );
        }
        throw error;
      }
      const removed = pruneTinyVisibleLayers(draft, evidence);
      if (!removed) {
        draft.validationEvidence = evidence;
        return draft;
      }
      context.stats.small_layers_removed += removed;
      const profileForPalette = draft.profile.PAL
        ? { ...draft.profile, PAL: draft.profile.PAL }
        : draft.profile;
      context.stats.palette_attempts += 1;
      const result = solveFlagPalette(draft.spec, {
        slotRaster: makeSlotRaster(draft),
        chargeBackgrounds: chargeBackgroundsFor(draft),
        random: context.random('S6_PALETTE'),
        profile: createFlagColorProfile(profileForPalette),
        era: draft.era,
      });
      if (!result.success) {
        throw new FlagGenerationAttemptError(
          'S6_PALETTE',
          `После удаления малых слоёв (ординарии ${draft.ordinaryCount}; заряды ${draft.chargeCount}; слоты ${draft.spec.slots.items.length}) палитра не решена: ${result.reason}`,
        );
      }
      draft.spec.palette = result.palette;
      draft.spec.meta.color_count = result.colorCount;
      stampFlagHashes(draft.spec);
      draft.validationEvidence = makeValidationEvidence(draft);
      return draft;
    },
    validate(draft, context) {
      if (!draft.spec) return { passed: false, reason: 'FlagSpec отсутствует' };
      try {
        assertValidFlagSpec(draft.spec);
        const evidence = draft.validationEvidence ?? makeValidationEvidence(draft);
        const report = validateFlag(draft.spec, evidence, {
          onRuleTiming: onValidationRuleTiming,
          stopAfterFirstFailure: true,
        });
        draft.validationEvidence = undefined;
        if (!report.passed) {
          const failures = Object.entries(report.checks).filter(([, result]) => !result.passed);
          for (const [rule, result] of failures) {
            const details = result.details.length ? result.details : [JSON.stringify(result.value)];
            const layerIds = [...new Set(details.flatMap((detail) =>
              detail.match(/\bL\d+-[a-z0-9]+-[a-z0-9-]+\b/g) ?? [],
            ))];
            const relatedLayers = evidence.layers.filter(({ id }) => layerIds.includes(id));
            const operators = [...new Set(relatedLayers.map(({ operator }) => operator).filter((id): id is string => !!id))];
            const modules = [...new Set([
              ...relatedLayers.map(({ module, catalogIds }) => module ?? catalogIds?.[0]).filter((id): id is string => !!id),
            ])];
            context.stats.diagnostics.push({
              attempt: context.attempt + 1,
              stage: 'S8_VALIDATION',
              code: rule,
              measured: result.value,
              threshold: result.limit ?? null,
              layerId: layerIds[0] ?? null,
              layerIds,
              layerContributors: relatedLayers.map(({ id, sourceId, parentId, anchor, operator, module, catalogIds, tags }) => ({
                layerId: id,
                sourceId: sourceId ?? null,
                parentId: parentId ?? null,
                anchor: anchor ?? null,
                operator: operator ?? null,
                module: module ?? catalogIds?.[0] ?? null,
                tags: tags ?? [],
              })),
              operator: operators.length ? operators.join(',') : layerIds.length ? null : draft.fieldOperator ?? null,
              module: modules.length ? modules.join(',') : null,
              profileId: draft.profile.id,
              details,
            } satisfies FlagGenerationDiagnostic);
          }
          const failureText = failures.map(([rule, result]) =>
            `${rule}: ${result.details.join(', ') || JSON.stringify(result.value)}`);
          return { passed: false, reason: failureText.join(' | ') };
        }
        const target = String(draft.spec.meta.symmetry_target ?? draft.spec.meta.symmetry);
        const actual = String(draft.spec.meta.symmetry_actual ?? draft.spec.meta.symmetry);
        if (actual !== String(draft.spec.meta.symmetry)) {
          draft.spec.meta.symmetry = actual;
          context.stats.symmetry_downgrades += 1;
          stampFlagHashes(draft.spec);
        }
        if (target !== actual && !Array.isArray(draft.spec.meta.symmetry_target)) {
          draft.spec.meta.symmetry_target = target;
        }
        return true;
      } catch (error) {
        return { passed: false, reason: error instanceof Error ? error.message : String(error) };
      }
    },
    removeLastOptionalLayer() {
      return null;
    },
    createFallback(_fallbackId, context) {
      return makeDraft('P28_FB', era, context.seed, context.random('S1_FALLBACK'), true);
    },
    buildFlagSpec(draft, context) {
      if (!draft.spec) throw new Error('Финальная FlagSpec отсутствует');
      draft.spec.seed = context.seed;
      draft.spec.generator_version = FLAG_GENERATOR_CONFIG.generatorVersion;
      stampFlagHashes(draft.spec);
      return draft.spec;
    },
    render: renderFlagSpec,
  };
}

export type FlagAblationScenario =
  | 'FIELD_ONLY'
  | 'FIELD_ONE_ORDINARY'
  | 'FIELD_ONE_ORDINARY_BORDURE'
  | 'FIELD_ONE_ORDINARY_BORDURE_ONE_CHARGE';

export interface GenerateProfiledFlagOptions {
  seed: string | number;
  profileId: string;
  era: number;
  attempts_max?: number;
  generator_version?: string;
  onStageTiming?: (stage: FlagGenerationStage | 'render', durationMs: number) => void;
  onValidationRuleTiming?: (rule: FlagValidationRule, durationMs: number, section?: string) => void;
  onCompositionTiming?: (section: string, durationMs: number) => void;
  /** Режим для измерительной абляции; не используется игровой интеграцией. */
  ablationScenario?: FlagAblationScenario;
}

export function generateProfiledFlag(options: GenerateProfiledFlagOptions) {
  if (!options || typeof options !== 'object') throw new TypeError('Нужны параметры генерации флага');
  if (!Number.isInteger(options.era) || options.era < 0 || options.era > 6) throw new RangeError('Эпоха должна быть целым числом от 0 до 6');
  const hooks = createHooks(
    options.profileId,
    options.era,
    options.onValidationRuleTiming,
    options.ablationScenario,
    options.onCompositionTiming,
  );
  if (options.onStageTiming) hooks.onStageTiming = options.onStageTiming;
  return generateFlag(options.seed, hooks, {
    attempts_max: options.attempts_max,
    generator_version: options.generator_version,
  });
}
