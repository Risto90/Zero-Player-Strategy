import type { City } from '@/game/world';

export const CITY_ICON_SOURCES = [
  require('../../assets/images/city-rank-1.png'),
  require('../../assets/images/city-rank-2.png'),
  require('../../assets/images/city-rank-3.png'),
  require('../../assets/images/city-rank-4.png'),
  require('../../assets/images/city-rank-5.png'),
  require('../../assets/images/city-rank-6.png'),
  require('../../assets/images/port-rank-1.png'),
  require('../../assets/images/port-rank-2.png'),
  require('../../assets/images/port-rank-3.png'),
  require('../../assets/images/port-rank-4.png'),
  require('../../assets/images/port-rank-5.png'),
  require('../../assets/images/port-rank-6.png'),
  require('../../assets/images/capital.png'),
] as const;

export function cityIconIndex(city: Pick<City, 'rank' | 'capital'>, hasPort: boolean): number {
  if (city.capital) return 12;
  return city.rank - 1 + (hasPort ? 6 : 0);
}

export function cityVisibilityRank(city: Pick<City, 'rank' | 'capital'>, hasPort: boolean): number {
  return Math.min(6, city.rank + (city.capital ? 2 : hasPort ? 1 : 0));
}

export function cityIconSource(index: number): number {
  return CITY_ICON_SOURCES[index] ?? CITY_ICON_SOURCES[0];
}
