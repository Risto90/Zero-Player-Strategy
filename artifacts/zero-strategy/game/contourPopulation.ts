import { MAP_WIDTH } from './config';
import type { Country, World } from './world';

/** Суммирует население пересечений составов, отдельно сохраняя каждую точку города. */
export class ContourPopulationReader {
  constructor(private readonly world: World, private readonly country: Country) {}

  forEach(visit: (pixel: number, population: number) => void): void {
    const { world, country } = this;
    const [x0, y0, x1, y1] = country.box;
    const area = world.contours.layer('owner').select((value) => value === country.id + 1,
      { x0, y0, x1, y1 }, `demography:${country.id}`);
    const layers = ['culture', 'religion', 'humanOrigins', 'density'].map((name) =>
      world.contours.layer(name as 'culture' | 'religion' | 'humanOrigins' | 'density'));
    const cityRows = new Map<number, number[]>();
    for (const city of world.cities) {
      if (city.countryId !== country.id) continue;
      const y = Math.floor(city.pixel / MAP_WIDTH);
      const row = cityRows.get(y) ?? [];
      row.push(city.pixel % MAP_WIDTH);
      cityRows.set(y, row);
    }
    for (const row of cityRows.values()) row.sort((a, b) => a - b);
    let currentY = -1, cityIndex = 0;
    let rows: ReturnType<(typeof layers)[number]['row']>[] = [];
    let cursors = [0, 0, 0, 0];
    let cities: number[] = [];
    for (const span of area.spans) {
      if (span.y !== currentY) {
        currentY = span.y;
        rows = layers.map((layer) => layer.row(span.y));
        cursors = [0, 0, 0, 0];
        cities = cityRows.get(span.y) ?? [];
        cityIndex = 0;
      }
      let x = span.start;
      while (x < span.end) {
        for (let layer = 0; layer < 3; layer += 1) {
          while (rows[layer][cursors[layer]].end <= x) cursors[layer] += 1;
        }
        while (cityIndex < cities.length && cities[cityIndex] < x) cityIndex += 1;
        const cityX = cities[cityIndex] ?? MAP_WIDTH;
        let end = Math.min(span.end, rows[0][cursors[0]].end,
          rows[1][cursors[1]].end, rows[2][cursors[2]].end, cityX);
        if (cityX === x) {
          end = x + 1;
          cityIndex += 1;
        }
        let population = 0, densityX = x;
        const densityRows = rows[3];
        while (densityX < end) {
          while (densityRows[cursors[3]].end <= densityX) cursors[3] += 1;
          const part = densityRows[cursors[3]], partEnd = Math.min(part.end, end);
          population += part.value * (partEnd - densityX);
          densityX = partEnd;
        }
        visit(span.y * MAP_WIDTH + x, population);
        x = end;
      }
    }
  }
}
