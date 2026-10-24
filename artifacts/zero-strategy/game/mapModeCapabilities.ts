import type { MapMode } from './render';

export function hasMapObjectList(mode: MapMode): boolean {
  switch (mode) {
    case 'political':
    case 'cities':
    case 'cultures':
    case 'religions':
    case 'nomads':
    case 'origins':
      return true;
    default:
      return false;
  }
}
