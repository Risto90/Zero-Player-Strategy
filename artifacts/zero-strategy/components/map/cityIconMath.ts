import type { City } from '@/game/world';

export function cityIconIndex(city: Pick<City, 'rank' | 'capital'>, hasPort: boolean): number {
  return city.rank - 1 + (hasPort ? 6 : 0);
}

export function cityVisibilityRank(city: Pick<City, 'rank' | 'capital'>, hasPort: boolean): number {
  return Math.min(6, city.rank + (city.capital ? 2 : hasPort ? 1 : 0));
}

/** Relative to the map's initial phone zoom; rank 6 is visible immediately. */
export function cityVisibilityMultiplier(zoomRank: number): number {
  return 1 + (6 - zoomRank) * 0.2;
}

export function cityVisibilityMultiplierForCity(city: Pick<City, 'rank' | 'capital'>, hasPort: boolean): number {
  return cityVisibilityMultiplier(cityVisibilityRank(city, hasPort));
}

export function isCityVisibleAtZoom(scale: number, baseScale: number, zoomRank: number): boolean {
  return scale >= baseScale * cityVisibilityMultiplier(zoomRank);
}
