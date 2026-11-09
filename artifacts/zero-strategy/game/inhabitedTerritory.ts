import { MAP_HEIGHT, MAP_WIDTH } from './config';
import { ContourArea } from './contours';
import type { GeometryPath, PathCommand } from '../kernel/geometry';
import type { World } from './world';

export interface InhabitedTerritory {
  area: ContourArea;
  path: GeometryPath;
}

const territoryCache = new WeakMap<World, {
  revision: number;
  territory: InhabitedTerritory;
}>();

/**
 * Географические объекты доступны только там, где сейчас есть территория,
 * населённая оседлой или кочевой страной. Составляется из контуров владельцев
 * и ареалов кочевых стран; исторические открытия не сохраняются.
 */
export function inhabitedTerritory(world: World): InhabitedTerritory {
  const cached = territoryCache.get(world);
  if (cached?.revision === world.territoryVersion) return cached.territory;

  const area = world.contours.layer('owner').select(
    (owner) => owner > 0,
    { x0: 0, y0: 0, x1: MAP_WIDTH - 1, y1: MAP_HEIGHT - 1 },
    'inhabited-territory',
  );
  let combined = area;
  for (const country of world.countries) {
    if (country.type !== 'nomadic' || !country.range?.length) continue;
    combined = combined.union(ContourArea.pixels(country.range));
  }

  const commands: PathCommand[] = [];
  for (const ring of combined.rings()) {
    const count = ring.length / 2;
    if (count < 3) continue;
    commands.push({ type: 'move', point: { x: ring[0], y: ring[1] } });
    for (let index = 1; index < count; index += 1) {
      commands.push({
        type: 'line',
        point: { x: ring[index * 2], y: ring[index * 2 + 1] },
      });
    }
    commands.push({ type: 'close' });
  }
  const territory = { area: combined, path: commands };
  territoryCache.set(world, { revision: world.territoryVersion, territory });
  return territory;
}
