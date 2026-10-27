export { cityIconIndex, cityVisibilityMultiplier, cityVisibilityMultiplierForCity, cityVisibilityRank } from './cityIconMath';

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
] as const;

export function cityIconSource(index: number): number {
  return CITY_ICON_SOURCES[index] ?? CITY_ICON_SOURCES[0];
}
