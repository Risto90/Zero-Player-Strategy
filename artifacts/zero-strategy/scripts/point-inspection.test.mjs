import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Game } from '../game/game.ts';
import { MAP_WIDTH } from '../game/config.ts';
import { World } from '../game/world.ts';

const world = World.create('random', 1042);
const cultureA = world.newCulture(null, 0);
const cultureB = world.newCulture(null, 0);
const faithA = world.newReligion(0);
const faithB = world.newReligion(0);
const country = world.newCountry({
  rank: 'тест',
  cultureId: cultureA.id,
  religionId: faithA.id,
  density: 1,
  foundedYear: 0,
  parentId: null,
});
const selectedPixel = world.landIndex[0];
const otherPixel = world.landIndex[1];
const emptyPixel = world.landIndex[2];
const seaPixel = world.land.findIndex((isLand) => isLand === 0);

world.setOwner(selectedPixel, country.id + 1);
world.density[selectedPixel] = 23;
world.culture[selectedPixel] = world.cultureTable.intern(new Map([[cultureA.id, 70], [cultureB.id, 30]]));
world.religion[selectedPixel] = world.religionTable.intern(new Map([[faithA.id, 40]]));
const city = world.addCity(country.id, selectedPixel);
city.population = 12_345;
city.populationGroups = [{ cultureId: cultureB.id, religionId: faithB.id, population: 12_345 }];

world.setOwner(otherPixel, country.id + 1);
world.density[otherPixel] = 80;
world.culture[otherPixel] = world.cultureTable.single(cultureB.id, 100);
world.religion[otherPixel] = world.religionTable.single(faithB.id, 100);

world.setOwner(emptyPixel, country.id + 1);
const game = new Game(world, 'observer');
const inspectAt = (pixel) => game.inspect(pixel % MAP_WIDTH, Math.floor(pixel / MAP_WIDTH));

const selected = inspectAt(selectedPixel);
assert.equal(selected.density, 23, 'inspection reports the selected point population, not the city population');
assert.deepEqual(selected.cultures.map(({ id, share }) => [id, share]), [[cultureA.id, 70], [cultureB.id, 30]]);
assert.deepEqual(selected.religions.map(({ id, share }) => [id, share]), [[faithA.id, 40]]);
assert.equal(selected.nonBelievers, 60, 'religion share remainder is reported as non-believers');
assert.equal(selected.city.population, 12_345, 'city profile data remains available only through the city link');

const other = inspectAt(otherPixel);
assert.deepEqual(other.cultures.map(({ id, share }) => [id, share]), [[cultureB.id, 100]], 'composition follows the inspected point');
assert.deepEqual(other.religions.map(({ id, share }) => [id, share]), [[faithB.id, 100]]);

const empty = inspectAt(emptyPixel);
assert.equal(empty.density, 0);
assert.equal(empty.cultures.length, 0);
assert.equal(empty.religions.length, 0);
assert.equal(empty.nonBelievers, 100, 'the UI must suppress empty-point composition despite the empty mix remainder');

const unclaimed = inspectAt(world.landIndex[3]);
assert.equal(unclaimed.country, null);
assert.equal(unclaimed.density, 0);
assert.deepEqual(unclaimed.cultures, []);

const sea = inspectAt(seaPixel);
assert.equal(sea.land, false);
assert.equal(sea.density, 0);
assert.deepEqual(sea.cultures, []);
assert.deepEqual(sea.religions, []);

const cardSource = readFileSync(resolve(process.cwd(), 'components/game/InspectCard.tsx'), 'utf8');
assert.match(cardSource, /info\.land && info\.country && info\.density > 0/u, 'only populated owned land shows demographics');
assert.match(cardSource, /info\.cultures\.map/u, 'the point culture mix is displayed');
assert.match(cardSource, /info\.religions\.map/u, 'the point religion mix is displayed');
assert.match(cardSource, /info\.nonBelievers/u, 'the point non-believer share is displayed');
assert.match(cardSource, /link-inspect-city/u, 'city remains a link');
assert.match(cardSource, /link-inspect-country/u, 'country remains a link');
assert.doesNotMatch(cardSource, /info\.city\.(?:population|populationGroups)|info\.countryPopulation|info\.family/u, 'city and country details are not rendered in inspection');

console.log('Point inspection regressions passed.');
