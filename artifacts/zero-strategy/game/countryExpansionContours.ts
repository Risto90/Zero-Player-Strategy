import { MAP_WIDTH } from './config';
import { ContourArea } from './contours';
import type { City, Country, World } from './world';

/** Контурная геометрия расширения страны и её береговых бассейнов. */
export class CountryExpansionContourIndex {
  readonly territory: ContourArea;
  readonly border: ContourArea;
  private frontierCache: ContourArea | null = null;
  private seaBodiesCache: Set<number> | null = null;

  constructor(private readonly world: World, private readonly country: Country) {
    const [x0, y0, x1, y1] = country.box;
    this.territory = world.contours.layer('owner').select(
      (value) => value === country.id + 1,
      { x0, y0, x1, y1 },
      `expansion-territory:${country.id}`,
    );
    this.border = this.territory.border();
  }

  frontier(): ContourArea {
    if (this.frontierCache) return this.frontierCache;
    if (!this.border.size) return this.frontierCache = new ContourArea();
    const bounds = this.border.bounds;
    const freeLand = this.world.contours.layer('owner').select(
      (value) => value === 0,
      bounds,
      `expansion-free:${this.country.id}`,
    ).intersect(this.world.contours.layer('land').select(
      (value) => value === 1,
      bounds,
      'land',
    ));
    this.frontierCache = this.border.intersect(freeLand);
    return this.frontierCache;
  }

  seaBodies(): Set<number> {
    if (this.seaBodiesCache) return this.seaBodiesCache;
    const bodies = new Set<number>();
    for (const span of this.border.spans) {
      const row = span.y * MAP_WIDTH;
      for (let x = span.start; x < span.end; x += 1) {
        const body = this.world.water.bodyOf[row + x];
        if (body >= 0) bodies.add(body);
      }
    }
    this.seaBodiesCache = bodies;
    return bodies;
  }

  static averageNonCityDensity(
    world: World,
    country: Country,
    totalDensity: number,
    cities: readonly City[],
  ): number {
    const owner = country.id + 1;
    let cityCount = 0;
    let cityDensity = 0;
    for (const city of cities) {
      if (world.owner[city.pixel] !== owner) continue;
      cityCount += 1;
      cityDensity += world.density[city.pixel];
    }
    const nonCityPixels = Math.max(0, country.pixels - cityCount);
    return nonCityPixels > 0 ? (totalDensity - cityDensity) / nonCityPixels : 0;
  }
}
