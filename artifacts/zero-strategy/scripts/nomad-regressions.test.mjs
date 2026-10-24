import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dissolveCountryIntoNomads } from '../game/nomads.ts';
import { hexToRgb, MapRenderer } from '../game/render.ts';
import { nomadProfileRoute } from '../game/profileRoutes.ts';
import { World } from '../game/world.ts';

function makeCountry(modifiers = []) {
  const world = World.create('random', 91421);
  const firstCulture = world.newCulture(null, 0);
  const secondCulture = world.newCulture(null, 0);
  const firstReligion = world.newReligion(0);
  const secondReligion = world.newReligion(0);
  const country = world.newCountry({
    rank: 'тест',
    cultureId: firstCulture.id,
    religionId: firstReligion.id,
    density: 100,
    foundedYear: 0,
    parentId: null,
  });
  country.modifiers = [...modifiers];
  const pixels = Array.from(world.landIndex.slice(0, 2));
  const firstFaithMix = world.religionTable.intern(new Map([[firstReligion.id, 40], [secondReligion.id, 30]]));
  const secondFaithMix = world.religionTable.intern(new Map([[firstReligion.id, 20], [secondReligion.id, 70]]));
  [firstCulture.id, secondCulture.id].forEach((cultureId, index) => {
    const pixel = pixels[index];
    world.setOwner(pixel, country.id + 1);
    world.density[pixel] = 100;
    world.culture[pixel] = world.cultureTable.single(cultureId, 100);
    world.religion[pixel] = index === 0 ? firstFaithMix : secondFaithMix;
  });
  return { world, country, pixels, firstCulture, secondCulture, firstReligion, secondReligion };
}

function withRandom(value, action) {
  const original = Math.random;
  Math.random = () => value;
  try {
    return action();
  } finally {
    Math.random = original;
  }
}

function cultureIds(nomad, world) {
  const ids = new Set();
  for (const cell of nomad.cells) {
    for (const id of world.cultureTable.entries[cell.cultureMix].ids) ids.add(id);
  }
  return ids;
}

function assertPopulationAndFaithPreserved(nomads, world, religions) {
  const expectedPopulation = 200;
  let population = 0;
  const totals = new Map(religions.map((id) => [id, 0]));
  let atheists = 0;
  for (const nomad of nomads) {
    for (const cell of nomad.cells) {
      population += cell.population;
      const mix = world.religionTable.entries[cell.religionMix];
      for (let index = 0; index < mix.ids.length; index += 1) {
        totals.set(mix.ids[index], (totals.get(mix.ids[index]) ?? 0) +
          cell.population * mix.shares[index] / 100);
      }
      atheists += cell.population * (100 - mix.total) / 100;
    }
  }
  assert.ok(Math.abs(population - expectedPopulation) < 1e-6, 'all population remains after cultural/religious grouping');
  assert.ok(Math.abs(totals.get(religions[0]) - 60) < 1e-6, `first religion retains its full population: ${totals.get(religions[0])}`);
  assert.ok(Math.abs(totals.get(religions[1]) - 100) < 1e-6, `second religion retains its full population: ${totals.get(religions[1])}`);
  assert.ok(Math.abs(atheists - 40) < 1e-6, `atheist population is retained without becoming a religion: ${atheists}`);
}

// With no modifier authorizing mixed ethnicity, each national group becomes its own nomad.
{
  const fixture = makeCountry();
  const nomads = dissolveCountryIntoNomads(fixture.world, fixture.country);
  assert.equal(nomads.length, 2, 'ordinary dissolution separates every culture');
  assert.ok(nomads.every((nomad) => cultureIds(nomad, fixture.world).size === 1),
    'ordinary nomads do not contain multiple cultures');
  assertPopulationAndFaithPreserved(nomads, fixture.world, [fixture.firstReligion.id, fixture.secondReligion.id]);
}

// Ethnic separation takes precedence over communism.
{
  const fixture = makeCountry(['ethnic', 'communist']);
  const nomads = dissolveCountryIntoNomads(fixture.world, fixture.country);
  assert.equal(nomads.length, 2, 'ethnic countries still split under communism');
  assert.ok(nomads.every((nomad) => cultureIds(nomad, fixture.world).size === 1),
    'communism does not merge an ethnic country');
  assertPopulationAndFaithPreserved(nomads, fixture.world, [fixture.firstReligion.id, fixture.secondReligion.id]);
}

// Federation allows cultures that fail the per-group separation chance to stay together.
{
  const fixture = makeCountry(['federation']);
  const nomads = withRandom(0.99, () => dissolveCountryIntoNomads(fixture.world, fixture.country));
  assert.equal(nomads.length, 1, 'federation can leave unseparated cultures in one group');
  assert.equal(cultureIds(nomads[0], fixture.world).size, 2, 'the documented mixed-culture exception is retained');
  assertPopulationAndFaithPreserved(nomads, fixture.world, [fixture.firstReligion.id, fixture.secondReligion.id]);
}

// Confederation keeps its lower documented separation chance.
{
  const combinedFixture = makeCountry(['confederation']);
  const combined = withRandom(0.99, () => dissolveCountryIntoNomads(combinedFixture.world, combinedFixture.country));
  assert.equal(combined.length, 1, 'confederation can leave cultures that fail its 25% separation chance together');
  assert.equal(cultureIds(combined[0], combinedFixture.world).size, 2, 'confederation retains the mixed remainder');
  assertPopulationAndFaithPreserved(combined, combinedFixture.world, [
    combinedFixture.firstReligion.id,
    combinedFixture.secondReligion.id,
  ]);

  const separatedFixture = makeCountry(['confederation']);
  const separated = withRandom(0.1, () => dissolveCountryIntoNomads(separatedFixture.world, separatedFixture.country));
  assert.equal(separated.length, 2, 'confederation still separates a culture when its chance succeeds');
  assert.ok(separated.every((nomad) => cultureIds(nomad, separatedFixture.world).size === 1),
    'separated confederate nomads each have one culture');
  assertPopulationAndFaithPreserved(separated, separatedFixture.world, [
    separatedFixture.firstReligion.id,
    separatedFixture.secondReligion.id,
  ]);
}

// A communist non-ethnic country does not split culturally, even if another modifier permits it.
{
  const fixture = makeCountry(['communist', 'federation']);
  const nomads = withRandom(0, () => dissolveCountryIntoNomads(fixture.world, fixture.country));
  assert.equal(nomads.length, 1, 'communism prevents national separation');
  assert.equal(cultureIds(nomads[0], fixture.world).size, 2, 'communist nomads may include both cultures');
  assertPopulationAndFaithPreserved(nomads, fixture.world, [fixture.firstReligion.id, fixture.secondReligion.id]);
}

// Theocracy separates religions while preserving every faith and atheist cohort.
{
  const fixture = makeCountry(['ethnic', 'theocracy']);
  const nomads = dissolveCountryIntoNomads(fixture.world, fixture.country);
  assert.ok(nomads.length >= 2, 'theocratic dissolution creates separate culture/religion groups');
  assertPopulationAndFaithPreserved(nomads, fixture.world, [fixture.firstReligion.id, fixture.secondReligion.id]);
}

// Nomad map mode uses a neutral land backdrop outside ranges and colors the range itself.
{
  const world = World.create('random', 73452);
  const culture = world.newCulture(null, 0);
  const country = world.newCountry({
    rank: 'тест',
    cultureId: culture.id,
    religionId: null,
    density: 20,
    foundedYear: 0,
    parentId: null,
  });
  const candidates = [...world.landIndex].filter((pixel) =>
    !world.isCoastal(pixel) && world.rivers[pixel] === 0,
  );
  const settledPixel = candidates[0];
  const biome = world.biomeAt(settledPixel);
  const neutralPixel = candidates.find((pixel) => pixel !== settledPixel && world.biomeAt(pixel) === biome);
  const nomadPixel = candidates.find((pixel) =>
    pixel !== settledPixel && pixel !== neutralPixel && world.biomeAt(pixel) === biome,
  );
  assert.ok(neutralPixel !== undefined && nomadPixel !== undefined, 'fixture has matching neutral and nomad land cells');
  world.setOwner(settledPixel, country.id + 1);
  world.density[settledPixel] = 20;
  world.nomads.push({
    id: 0,
    name: 'Тестовое кочевье',
    color: '#3a77b8',
    cultureId: culture.id,
    religionId: null,
    cells: [],
    range: [nomadPixel],
    sourceCountryId: null,
    pixels: 1,
    government: 'tribal',
    modifiers: [],
    ruler: country.ruler,
    heir: null,
    rulerSince: 0,
    previousRulerIds: [],
    dynastyClaims: [],
    coRulerIds: [],
    termYears: 0,
    maxTerms: 0,
    consulCount: 0,
    seatSince: {},
    termCounts: {},
    barredRulerIds: [],
    pendingDeathIds: [],
    pressures: {},
  });
  world.nomadVersion += 1;
  const renderer = new MapRenderer(world);
  renderer.setView('nomads', null);
  renderer.flush();
  assert.equal(renderer.pixels[settledPixel], renderer.pixels[neutralPixel],
    'a settled-state pixel outside nomad ranges matches neutral land, with no state color or border');
  const [r, g, b] = hexToRgb('#3a77b8');
  const expectedNomadColor = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  assert.equal(renderer.pixels[nomadPixel], expectedNomadColor, 'the nomad range remains visible in nomad map mode');
}

// Both legend/profile links use the shared typed route; no duplicate nomad screen remains.
{
  assert.deepEqual(nomadProfileRoute(7), {
    pathname: '/country/[id]',
    params: { id: '7', type: 'nomad' },
  });
  const countryPage = readFileSync(resolve(process.cwd(), 'app/country/[id].tsx'), 'utf8');
  const legend = readFileSync(resolve(process.cwd(), 'components/game/LegendPanel.tsx'), 'utf8');
  assert.match(countryPage, /entityType === 'nomad'/u, 'the shared profile distinguishes nomads from countries');
  assert.match(countryPage, /nomadProfileRoute\(nomad\.id\)/u, 'country profile links use the nomad entity route');
  assert.match(legend, /nomadProfileRoute\(nomad\.id\)/u, 'legend links use the nomad entity route');
  assert.ok(!existsSync(resolve(process.cwd(), 'app/nomad/[id].tsx')), 'the separate nomad route is deleted');
}

console.log('Nomad composition, profile-route, and map regressions passed.');
