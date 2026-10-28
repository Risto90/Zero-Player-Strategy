import type { City } from '@/game/world';
import {
  cityVisibilityMultiplier,
  cityVisibilityMultiplierForCity,
  cityVisibilityRank,
  isCityVisibleAtZoom,
} from '@/game/cityVisibility';

export function cityIconIndex(city: Pick<City, 'rank' | 'capital'>, hasPort: boolean): number {
  return city.rank - 1 + (hasPort ? 6 : 0);
}

export { cityVisibilityMultiplier, cityVisibilityMultiplierForCity, cityVisibilityRank, isCityVisibleAtZoom };
