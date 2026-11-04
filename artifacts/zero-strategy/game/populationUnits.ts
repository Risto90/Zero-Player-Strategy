import { MAP_POINT_AREA_KM2 } from './config';

/** Общая площадь суши, распределённая поровну по точкам игрового растра. */
export const TOTAL_LAND_AREA_KM2 = 510_072_000;
export { MAP_POINT_AREA_KM2 };

export function densityToResidents(density: number): number {
  if (!Number.isFinite(density)) throw new TypeError('Плотность должна быть конечным числом');
  return density * MAP_POINT_AREA_KM2;
}

export function residentsToDensity(residents: number): number {
  if (!Number.isFinite(residents)) throw new TypeError('Численность должна быть конечным числом');
  return residents / MAP_POINT_AREA_KM2;
}

export function roundResidents(residents: number): number {
  if (!Number.isFinite(residents)) throw new TypeError('Численность должна быть конечным числом');
  return Math.max(0, Math.floor(residents + 0.5));
}

export function densityToWholeResidents(density: number): number {
  return roundResidents(densityToResidents(density));
}
