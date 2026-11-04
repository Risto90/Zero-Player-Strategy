import { EARTH_HEIGHT, EARTH_WIDTH } from './data/earthLand';

export { FLAG_OUTLINE_CONFIG } from './flagOutlineConfig';
export { FLAG_LINE_STYLE_CONFIG } from './flagLineStyleConfig';
export { FLAG_ORDINARY_CONFIG } from './flagOrdinaryConfig';
export { FLAG_EMBLEM_CONFIG } from './flagEmblemConfig';
export { FLAG_PLACEMENT_CONFIG } from './flagPlacementConfig';
export { FLAG_COLOR_CONFIG } from './flagColorConfig';
export { FLAG_PROFILE_CONFIG, FLAG_PROFILE_DEFAULTS, FLAG_TAG_COMPATIBILITY, FLAG_CULTURE_PROFILE_BINDINGS } from './flagProfileConfig';
export { FLAG_GENERATOR_CONFIG } from './flagGeneratorConfig';
export { FLAG_VALIDATION_CONFIG } from './flagValidationConfig';

/** Map raster size (pixels). The world map is a fixed equirectangular projection of real coastlines. */
export const MAP_WIDTH = EARTH_WIDTH;
export const MAP_HEIGHT = EARTH_HEIGHT;
export const MAP_PIXELS = MAP_WIDTH * MAP_HEIGHT;
/** Реальная площадь одной точки карты при любой размерности холста. */
export const MAP_POINT_AREA_KM2 = 510_072_000 / MAP_PIXELS;

/** Climate and share values are kept in steps so equal-value areas form large zones. */
export const VALUE_STEP = 5;
export const SHARE_STEP = 5;

export const LOG_LIMIT = 120;
export const TURN_SECONDS = 60;
export const MAX_COUNTRIES = 80;

/** Границы старой шкалы нужны только для чтения сохранений до перехода на °C. */
const LEGACY_TEMPERATURE_SCALE_POINTS: readonly [number, number][] = [
  [0, -20],
  [10, -10],
  [25, -5],
  [40, 5],
  [65, 18],
  [100, 30],
];

export const HUMAN_THERMAL_COMFORT_C: readonly [number, number] = [18, 28];
export const MIN_TEMPERATURE_C = -90;
export const MAX_TEMPERATURE_C = 58;

export function legacyTemperatureIndexToCelsius(index: number): number {
  const value = Math.max(0, Math.min(100, index));
  for (let i = 1; i < LEGACY_TEMPERATURE_SCALE_POINTS.length; i += 1) {
    const [upperIndex, upperCelsius] = LEGACY_TEMPERATURE_SCALE_POINTS[i];
    const [lowerIndex, lowerCelsius] = LEGACY_TEMPERATURE_SCALE_POINTS[i - 1];
    if (value <= upperIndex) {
      const ratio = (value - lowerIndex) / (upperIndex - lowerIndex);
      return Math.round((lowerCelsius + ratio * (upperCelsius - lowerCelsius)) * 10) / 10;
    }
  }
  return LEGACY_TEMPERATURE_SCALE_POINTS[LEGACY_TEMPERATURE_SCALE_POINTS.length - 1][1];
}

export const CLIMATE_DELTA = 15;
export const FAITH_CONVERSION = 0.4;
export const CULTURE_CONVERSION = 0.5;

// Исторические площади — оценки по границам соответствующей эпохи, а не по позднейшим государствам.
// Для Рима 44 года до н. э. используется оценка 1 972 439 км² с romanempiremap.com/year/44-bc.
// Для империи Карла Великого в 800 году используется оценка 1,2 млн км² из l'histoire.fr.
// Площади Франции, герцогства Бургундия и Мерсии округлены по картам эпохи;
// герцогство не смешивается с владениями Валуа-Бургундского государства.
const HISTORICAL_RANK_AREAS_KM2 = [
  { name: 'Гегемония', area: 1_972_439 },
  { name: 'Империя', area: 1_200_000 },
  { name: 'Королевство', area: 400_000 },
  { name: 'Княжество', area: 35_000 },
  { name: 'Герцогство', area: 100_000 },
  { name: 'Марка', area: 50_000 },
  { name: 'Графство', area: (100_000 / 3 + 50_000 / 5) / 2 },
  { name: 'Виконтство', area: ((100_000 / 3 + 50_000 / 5) / 2) / 2 },
  { name: 'Баронство', area: ((100_000 / 3 + 50_000 / 5) / 2) / 3 },
  { name: 'Баронетство', area: ((100_000 / 3 + 50_000 / 5) / 2) / 6 },
] as const;

function normalizedRankAreas(): { name: string; ink: number }[] {
  const areas = HISTORICAL_RANK_AREAS_KM2.map(({ name, area }) => ({ name, area }));
  for (let index = 1; index < areas.length; index += 1) {
    const previous = areas[index - 1].area;
    while (areas[index].area >= previous) {
      areas[index].area = (previous + areas[index].area / 2) / 2;
    }
  }

  const points = areas.map(({ name, area }) => ({
    name,
    ink: Math.round(area / MAP_POINT_AREA_KM2),
  }));
  for (let index = 0; index < points.length; index += 1) {
    if (points[index].ink < 1) {
      throw new Error(`Площадь ранга «${points[index].name}» меньше одной точки карты; требуется увеличить размер холста.`);
    }
    if (index > 0 && points[index].ink >= points[index - 1].ink) {
      throw new Error(`Площади рангов «${points[index - 1].name}» и «${points[index].name}» не убывают на текущем размере холста.`);
    }
  }
  return points;
}

/** Пороги площади стран в точках карты; порядок идёт от крупнейшего ранга к меньшему. */
export const RANKS = normalizedRankAreas();
export const RANK_AREA_BY_NAME: Readonly<Record<string, number>> = Object.fromEntries(
  RANKS.map(({ name, ink }) => [name, ink]),
);

/** Лимиты заданы в единицах краски; для кистей территории верхний предел равен площади гегемонии. */
export const INK = {
  expand: RANKS[0].ink,
  colonization: RANKS[0].ink,
  split: 9000,
  climate: 26000,
  faith: 14000,
  culture: 10000,
};

export function countryRankForArea(areaInPoints: number): string {
  return RANKS.find((rank) => areaInPoints >= rank.ink)?.name ?? RANKS[RANKS.length - 1].name;
}

export const BRUSH_SIZES = [
  { id: 's', label: 'S', radius: 5 },
  { id: 'm', label: 'M', radius: 11 },
  { id: 'l', label: 'L', radius: 22 },
] as const;
export type BrushSize = (typeof BRUSH_SIZES)[number]['id'];

export const PALETTE = {
  ocean: '#b9cdd0',
  oceanDeep: '#a6bec3',
  coast: '#5d6b6b',
  unclaimedLand: '#ddd3b6',
  border: '#2f2a24',
  noFaith: '#cbc6b8',
  country: [
    '#c56f58', '#62836f', '#7279a2', '#c3974e', '#8d6f91', '#558d91', '#b26f84', '#487f9c',
    '#8a8f52', '#bd6689', '#5775a4', '#ba805f', '#6c9b97', '#8d83af', '#997242', '#62765c',
  ],
  culture: ['#a46150', '#4f7e79', '#6e70a0', '#ad803a', '#865d83', '#43818d', '#a75b77', '#667e48'],
  religion: ['#a77c36', '#527b91', '#7770a3', '#728457', '#aa6472', '#6c6b69'],
};

export interface BiomeInfo {
  id: number;
  name: string;
  rule: string;
  color: string;
  climate: {
    temperature: [number, number];
    humidity: [number, number];
    drainage: [number, number];
  };
}

export const BIOMES: BiomeInfo[] = [
  { id: 0, name: 'Ледник', rule: 't < −10 °C', color: '#e7ebe8', climate: { temperature: [-20, -10], humidity: [0, 100], drainage: [0, 30] } },
  { id: 1, name: 'Тундра', rule: '−10–−5 °C', color: '#b3b6a2', climate: { temperature: [-10, -5], humidity: [0, 100], drainage: [0, 35] } },
  { id: 2, name: 'Болота', rule: 't ≥ −10 °C, вл ≥ 55, дренаж ≤ 25', color: '#6c8c7f', climate: { temperature: [-10, 30], humidity: [55, 100], drainage: [0, 25] } },
  { id: 3, name: 'Тайга', rule: '−5–5 °C, эвл ≥ 35', color: '#5d7a63', climate: { temperature: [-5, 5], humidity: [35, 100], drainage: [15, 65] } },
  { id: 4, name: 'Холодная степь', rule: '−5–5 °C, эвл < 35', color: '#b0ad8b', climate: { temperature: [-5, 5], humidity: [0, 35], drainage: [35, 80] } },
  { id: 5, name: 'Лиственный лес', rule: '5–18 °C, эвл ≥ 45', color: '#86a062', climate: { temperature: [5, 18], humidity: [45, 100], drainage: [25, 70] } },
  { id: 6, name: 'Степь', rule: '5–18 °C, эвл 20–44', color: '#c4b46f', climate: { temperature: [5, 18], humidity: [20, 44], drainage: [40, 85] } },
  { id: 7, name: 'Пустыня', rule: 't ≥ 5 °C, эвл < 20', color: '#e3cb96', climate: { temperature: [5, 30], humidity: [0, 20], drainage: [60, 95] } },
  { id: 8, name: 'Саванна', rule: 't ≥ 18 °C, эвл 20–49', color: '#c99e57', climate: { temperature: [18, 30], humidity: [20, 49], drainage: [45, 90] } },
  { id: 9, name: 'Тропический лес', rule: 't ≥ 18 °C, эвл ≥ 50', color: '#4b7c4d', climate: { temperature: [18, 30], humidity: [50, 100], drainage: [30, 80] } },
];
export const BIOME_NOTE =
  't — температура в °C; влажность и дренаж — игровые шкалы 0–100. Эвл — влажность с учётом дренажа: вл × (1,3 − 0,006 × дренаж). Диапазон дренажа профиля описывает типичные условия почвы биома; сам биом по-прежнему определяется температурой, эффективной влажностью и правилом болот.';

export function effectiveMoisture(humidity: number, drainage: number): number {
  return Math.round(humidity * (1.3 - 0.006 * drainage));
}

export function biomeFor(humidity: number, temperature: number, drainage: number): number {
  const moisture = effectiveMoisture(humidity, drainage);
  if (temperature < -10) return 0;
  if (temperature >= -10 && humidity >= 55 && drainage <= 25) return 2;
  if (temperature < -5) return 1;
  if (temperature < 5) return moisture >= 35 ? 3 : 4;
  if (moisture < 20) return 7;
  if (temperature < 18) return moisture >= 45 ? 5 : 6;
  return moisture >= 50 ? 9 : 8;
}

export const NAMES = {
  countryStart: ['Аст', 'Вел', 'Кал', 'Мор', 'Нор', 'Тар', 'Эр', 'Сол', 'Лир', 'Ор', 'Дан', 'Иск', 'Рав', 'Ул', 'Гед', 'Бор', 'Зан', 'Кир'],
  countryEnd: ['ария', 'вальд', 'марк', 'орн', 'ест', 'ания', 'дора', 'град', 'рия', 'вена', 'тия', 'лон', 'стан', 'мир'],
  cultureStart: ['Ве', 'Та', 'Са', 'Ор', 'Ке', 'Ай', 'На', 'Эр', 'Ло', 'Ми', 'Ду', 'Ри', 'Ха', 'Зе', 'Бу', 'Го'],
  cultureEnd: ['лари', 'рны', 'эли', 'вены', 'лты', 'нумены', 'рви', 'валы', 'деты', 'ссы', 'ромы', 'киры'],
  cultureBranch: ['Северные', 'Южные', 'Горные', 'Прибрежные', 'Западные', 'Восточные', 'Степные', 'Лесные'],
  religionStart: ['Путь', 'Завет', 'Свет', 'Круг', 'Память', 'Учение', 'Огонь', 'Голос'],
  religionEnd: ['Прилива', 'Предков', 'Небес', 'Дубов', 'Солнца', 'Пепла', 'Звёзд', 'Камня', 'Ветра'],
};
