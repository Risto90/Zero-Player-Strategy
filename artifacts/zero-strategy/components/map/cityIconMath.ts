import type { City } from '@/game/world';

export function cityIconIndex(city: Pick<City, 'rank' | 'capital'>, hasPort: boolean): number {
  return city.rank - 1 + (hasPort ? 6 : 0);
}

export function cityVisibilityRank(city: Pick<City, 'rank' | 'capital'>, hasPort: boolean): number {
  // Порт и столица независимо сдвигают появление на один ранг:
  // столица-порт поэтому видна на два ранга раньше обычного города.
  return Math.min(6, city.rank + Number(hasPort) + Number(city.capital));
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
