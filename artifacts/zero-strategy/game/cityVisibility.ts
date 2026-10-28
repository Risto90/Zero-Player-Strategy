import type { City } from './world';

export function cityVisibilityRank(city: Pick<City, 'rank' | 'capital'>, hasPort: boolean): number {
  // Порт и столица независимо сдвигают появление на один ранг.
  return Math.min(6, city.rank + Number(hasPort) + Number(city.capital));
}

export function cityVisibilityMultiplier(zoomRank: number): number {
  return 1 + (6 - zoomRank) * 0.2;
}

export function cityVisibilityMultiplierForCity(city: Pick<City, 'rank' | 'capital'>, hasPort: boolean): number {
  return cityVisibilityMultiplier(cityVisibilityRank(city, hasPort));
}

export function isCityVisibleAtZoom(scale: number, baseScale: number, zoomRank: number): boolean {
  return scale >= baseScale * cityVisibilityMultiplier(zoomRank);
}

export function cityLabelFontSize(scale: number, baseScale: number): number {
  const zoom = scale / Math.max(baseScale, 0.0001);
  return 9 * Math.min(1.65, 1 + Math.max(0, zoom - 1) * 0.1);
}
