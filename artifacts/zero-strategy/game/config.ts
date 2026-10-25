import { EARTH_HEIGHT, EARTH_WIDTH } from './data/earthLand';

export { FLAG_OUTLINE_CONFIG } from './flagOutlineConfig';

/** Map raster size (pixels). The world map is a fixed equirectangular projection of real coastlines. */
export const MAP_WIDTH = EARTH_WIDTH;
export const MAP_HEIGHT = EARTH_HEIGHT;
export const MAP_PIXELS = MAP_WIDTH * MAP_HEIGHT;

/** Climate and share values are kept in steps so equal-value areas form large zones. */
export const VALUE_STEP = 5;
export const SHARE_STEP = 5;

export const LOG_LIMIT = 120;
export const TURN_SECONDS = 60;
export const MAX_COUNTRIES = 80;

/** Ink is measured in map pixels the brush may change. */
export const INK = {
  expand: 4000,
  colonization: 4000,
  split: 9000,
  climate: 26000,
  faith: 14000,
  culture: 10000,
};
export const CLIMATE_DELTA = 15;
export const FAITH_CONVERSION = 0.4;
export const CULTURE_CONVERSION = 0.5;

export const RANKS = [
  { name: 'Баронство', ink: 2500 },
  { name: 'Графство', ink: 4500 },
  { name: 'Герцогство', ink: 8000 },
  { name: 'Королевство', ink: 14000 },
  { name: 'Империя', ink: 24000 },
  { name: 'Гегемония', ink: 40000 },
];

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
}

export const BIOMES: BiomeInfo[] = [
  { id: 0, name: 'Ледник', rule: 't < 10', color: '#e7ebe8' },
  { id: 1, name: 'Тундра', rule: 't 10–24', color: '#b3b6a2' },
  { id: 2, name: 'Болота', rule: 't ≥ 10, вл ≥ 55, дренаж ≤ 25', color: '#6c8c7f' },
  { id: 3, name: 'Тайга', rule: 't 25–39, эвл ≥ 35', color: '#5d7a63' },
  { id: 4, name: 'Холодная степь', rule: 't 25–39, эвл < 35', color: '#b0ad8b' },
  { id: 5, name: 'Лиственный лес', rule: 't 40–64, эвл ≥ 45', color: '#86a062' },
  { id: 6, name: 'Степь', rule: 't 40–64, эвл 20–44', color: '#c4b46f' },
  { id: 7, name: 'Пустыня', rule: 't ≥ 40, эвл < 20', color: '#e3cb96' },
  { id: 8, name: 'Саванна', rule: 't ≥ 65, эвл 20–49', color: '#c99e57' },
  { id: 9, name: 'Тропический лес', rule: 't ≥ 65, эвл ≥ 50', color: '#4b7c4d' },
];
export const BIOME_NOTE =
  't — температура (0–100), вл — влажность, эвл — влажность с учётом дренажа: вл × (1,3 − 0,006 × дренаж). Хороший дренаж сушит почву, плохой — заболачивает.';

export function effectiveMoisture(humidity: number, drainage: number): number {
  return Math.round(humidity * (1.3 - 0.006 * drainage));
}

export function biomeFor(humidity: number, temperature: number, drainage: number): number {
  const moisture = effectiveMoisture(humidity, drainage);
  if (temperature < 10) return 0;
  if (humidity >= 55 && drainage <= 25) return 2;
  if (temperature < 25) return 1;
  if (temperature < 40) return moisture >= 35 ? 3 : 4;
  if (moisture < 20) return 7;
  if (temperature < 65) return moisture >= 45 ? 5 : 6;
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
