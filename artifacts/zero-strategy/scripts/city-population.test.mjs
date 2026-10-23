import { strict as assert } from 'node:assert';
import { World } from '../game/world.ts';
import { deserializeWorld, serializeWorld } from '../game/persistence.ts';
import { ColonizationDonorHeap, transferColonizationPopulation } from '../game/colonization.ts';
import { cityComposition, movePopulationToCity, populationAtPixel, resizeCityPopulation } from '../game/settlements.ts';
import { demography } from '../game/demography.ts';
import { MAP_PIXELS } from '../game/config.ts';

function assertEqual(actual, expected, message) {
  assert.equal(actual, expected, message);
}

function setUp() {
  const world = World.create('random', 4321);
  const culture = world.newCulture(null, 0);
  const country = world.newCountry({
    rank: 'тест',
    cultureId: culture.id,
    religionId: null,
    density: 1,
    foundedYear: 0,
    parentId: null,
  });
  let next = 0;
  const pixel = () => world.landIndex[next++];
  const ownPixel = (density, cityPopulation) => {
    const p = pixel();
    world.setOwner(p, country.id + 1);
    world.density[p] = density;
    world.culture[p] = world.cultureTable.single(culture.id, 100);
    const city = cityPopulation === null ? null : world.addCity(country.id, p, 1, false);
    if (city) resizeCityPopulation(world, city, cityPopulation);
    return { p, city };
  };
  return { world, country, ownPixel, pixel };
}

function transfer(world, donor, target, amount) {
  const ideal = world.density[donor] * 0.1;
  const result = transferColonizationPopulation(world, donor, target, amount / ideal);
  if (result) world.setOwner(target, world.owner[donor]);
  return result;
}

const { world, country, ownPixel, pixel } = setUp();

// A city-free donor still transfers only rural density and conserves the raster total.
const rural = ownPixel(14, null);
const ruralTarget = pixel();
const ruralTotalBefore = world.density[rural.p];
assert.ok(transfer(world, rural.p, ruralTarget, 1));
assertEqual(world.density[rural.p], 13, 'ordinary donor density');
assertEqual(world.density[ruralTarget], 1, 'ordinary target density');
assertEqual(world.density[rural.p] + world.density[ruralTarget], ruralTotalBefore, 'ordinary transfer total');
assertEqual(populationAtPixel(world, rural.p), 13, 'city-free point has no city population');

// Every unit removed from rural density removes the same fraction of city residents.
const urban = ownPixel(14, 1400);
for (let i = 0; i < 4; i += 1) {
  assert.ok(transfer(world, urban.p, pixel(), 1));
}
assertEqual(world.density[urban.p], 10, 'city contour density after four transfers');
assertEqual(urban.city.population, 1000, 'city population after 14 to 10 density reduction');
assertEqual(Math.round(1400 - urban.city.population), 400, 'exact number removed from city');
assertEqual(populationAtPixel(world, urban.p), urban.city.population, 'city population replaces rural density at its pixel in totals');

// Two cities on equal-density contours scale independently; no-city pixels remain rural-only.
const firstCity = ownPixel(14, 1400);
const secondCity = ownPixel(14, 700);
const mixedContour = ownPixel(14, null);
assert.ok(transfer(world, firstCity.p, pixel(), 1));
assert.ok(transfer(world, secondCity.p, pixel(), 1));
assertEqual(firstCity.city.population, 1300, 'first city proportional removal');
assertEqual(secondCity.city.population, 650, 'second city proportional removal');
assertEqual(populationAtPixel(world, mixedContour.p), 14, 'no-city pixel has no urban addition');

// Donor choice stays based on rural contour density, never the city population.
const denseRuralDonor = ownPixel(14, null);
const lessDenseCityDonor = ownPixel(10, 10000);
assertEqual(
  new ColonizationDonorHeap(world, [lessDenseCityDonor.p, denseRuralDonor.p]).peek(),
  denseRuralDonor.p,
  'donor heap ranks rural density above city headcount',
);

// Concentrating rural residents between two city points preserves the total population.
const sourceCity = ownPixel(8, 800);
const targetCity = ownPixel(5, 500);
const totalBeforeConcentration = populationAtPixel(world, sourceCity.p) + populationAtPixel(world, targetCity.p);
assertEqual(movePopulationToCity(world, sourceCity.p, targetCity.p, 1), 1, 'one resident moved between city points');
assertEqual(sourceCity.city.population, 799, 'source city count follows its reduced rural component');
assertEqual(targetCity.city.population, 501, 'receiving city count includes concentrated residents');
assertEqual(
  populationAtPixel(world, sourceCity.p) + populationAtPixel(world, targetCity.p),
  totalBeforeConcentration,
  'city concentration conserves the population total',
);

// City cohorts change independently from the rural mix at the city pixel.
const newCulture = world.newCulture(world.cultures[country.cultureId], 0);
const newReligion = world.newReligion(0);
const incomingRural = ownPixel(10, null);
const receivingCity = ownPixel(5, 500);
world.culture[incomingRural.p] = world.cultureTable.single(newCulture.id, 100);
world.religion[incomingRural.p] = world.religionTable.single(newReligion.id, 100);
const ruralCultureBefore = world.culture[receivingCity.p];
const ruralReligionBefore = world.religion[receivingCity.p];
assertEqual(movePopulationToCity(world, incomingRural.p, receivingCity.p, 2), 2, 'two rural residents concentrated into the city');
const urbanMix = cityComposition(world, receivingCity.city);
assert.ok(urbanMix.cultures.some((group) => group.id === newCulture.id && group.percent > 0), 'incoming culture is recorded in city cohorts');
assert.ok(urbanMix.religions.some((group) => group.id === newReligion.id && group.percent > 0), 'incoming religion is recorded in city cohorts');
assertEqual(world.culture[receivingCity.p], ruralCultureBefore, 'urban culture change does not overwrite rural pixel culture');
assertEqual(world.religion[receivingCity.p], ruralReligionBefore, 'urban religion change does not overwrite rural pixel religion');
world.version += 1;
assert.ok(demography(world, country).cultures.get(newCulture.id) > 0, 'country demography includes the separate city culture cohorts');

// Colonization scales the donor city's own cohort counts without deriving them from its rural raster.
const colonizingCity = ownPixel(14, 1400);
world.culture[colonizingCity.p] = world.cultureTable.single(newCulture.id, 100);
world.religion[colonizingCity.p] = world.religionTable.single(newReligion.id, 100);
assert.ok(transfer(world, colonizingCity.p, pixel(), 1));
assertEqual(colonizingCity.city.population, 1300, 'colonization reduces the donor city population');
assert.deepEqual(cityComposition(world, colonizingCity.city).cultures, [{ id: country.cultureId, percent: 100 }], "colonization preserves the city's separate culture composition");
assert.deepEqual(cityComposition(world, colonizingCity.city).religions, [{ id: null, percent: 100 }], "colonization preserves the city's separate religion composition");
assertEqual(world.cultureTable.shareOf(world.culture[colonizingCity.p], newCulture.id), 100, 'rural donor culture remains independently updated');

let expectedCountryPopulation = 0;
let expectedRuralDensity = 0;
world.forEachCountryPixel(country, (p) => {
  expectedCountryPopulation += populationAtPixel(world, p);
  expectedRuralDensity += world.density[p];
});
const countryDemography = demography(world, country);
assertEqual(countryDemography.population, expectedCountryPopulation, 'country total uses city population without double counting');
assertEqual(countryDemography.density, expectedRuralDensity / country.pixels, 'country density remains the rural-layer average');

// Zero and tiny donor values do not create negative city counts or invalid transfers.
const boundary = ownPixel(0, 0);
assert.equal(transferColonizationPopulation(world, boundary.p, pixel(), 10), null);
assertEqual(boundary.city.population, 0, 'zero-population city stays at zero');
const tiny = ownPixel(0.05, 0.05);
assert.ok(transfer(world, tiny.p, pixel(), 0.005));
assert.ok(tiny.city.population >= 0, 'tiny city population remains nonnegative');

// New city population survives save/load; all density contours restore the exact raster.
const beforeDensity = world.density.slice();
const saved = serializeWorld(world);
const loaded = deserializeWorld(saved);
assert.ok(saved.layers.density.every((zone, i, zones) =>
  (i === 0 || zones[i - 1].value < zone.value) && zone.rings.length > 0 &&
  zone.rings.every((ring) => ring.length >= 8 && ring.length % 2 === 0),
), 'density storage consists of ordered, closed equal-value contours');
assertEqual(loaded.cities.length, world.cities.length, 'city count after save/load');
for (let i = 0; i < world.cities.length; i += 1) {
  assertEqual(loaded.cities[i].population, world.cities[i].population, `city ${i} population after save/load`);
  assert.deepEqual(loaded.cities[i].populationGroups, world.cities[i].populationGroups, `city ${i} cohorts after save/load`);
}
for (let p = 0; p < MAP_PIXELS; p += 1) {
  assertEqual(loaded.density[p], beforeDensity[p], `density raster round-trip at ${p}`);
}

// Legacy saves had no city population field; their city-point density held the saved total.
const legacy = serializeWorld(world);
const legacyCity = legacy.cities[0];
delete legacyCity.population;
delete legacyCity.populationGroups;
const migrated = deserializeWorld(legacy);
assertEqual(migrated.cities[0].population, migrated.density[legacyCity.pixel], 'legacy city count is migrated from saved density');
assert.equal(
  migrated.cities[0].populationGroups.reduce((sum, group) => sum + group.population, 0),
  migrated.cities[0].population,
  'legacy city cohorts are reconstructed from saved pixel composition',
);

console.log(`City population checks passed for ${country.name}.`);
