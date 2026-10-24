import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dissolveCountryIntoNomads, settleNomadAsCountry } from '../game/nomads.ts';
import { CardPainter } from '../game/brush.ts';
import { INK, MAP_WIDTH } from '../game/config.ts';
import { forEachNeighbour } from '../game/geography.ts';
import { advancePeople, birth, marry, newCitizen, registerPerson } from '../game/characters.ts';
import { leadershipOptions } from '../game/succession.ts';
import { applyReform, marriageCandidates, reformCandidates } from '../game/politics.ts';
import { demography } from '../game/demography.ts';
import { cityInfluenceRadius } from '../game/settlements.ts';
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
    density: 20,
    cultureId: culture.id,
    religionId: null,
    cells: [],
    range: [nomadPixel],
    personIds: [country.ruler.id],
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

// The nomad brush grows the range's population and the density mode grows population in place.
{
  const fixture = makeCountry();
  const nomad = dissolveCountryIntoNomads(fixture.world, fixture.country)[0];
  const originalRange = new Set(nomad.range);
  const originalPopulation = nomad.cells.reduce((sum, cell) => sum + cell.population, 0);
  let target = -1;
  for (const pixel of nomad.range) {
    forEachNeighbour(pixel, (next) => {
      if (target < 0 && fixture.world.land[next] && !originalRange.has(next)) target = next;
    });
    if (target >= 0) break;
  }
  assert.ok(target >= 0, 'fixture has free land next to the nomad range');
  const card = {
    type: 'nomadExpand', title: 'expand', detail: '', ink: INK.expand, inkTotal: INK.expand,
    targetCountryId: null, targetNomadId: nomad.id, newCountryId: null,
    newCultureId: null, newReligionId: null, sourceCultureId: null, newGovernmentId: null,
    newRuler: null, choices: null, selectedChoice: 0, characterEvent: null, hint: target,
    nomadDensityOnly: false,
  };
  const rangePainter = new CardPainter(fixture.world, card, 'respect');
  rangePainter.setNomadMode('range');
  rangePainter.dab(target % MAP_WIDTH + 0.5, Math.floor(target / MAP_WIDTH) + 0.5, 1);
  rangePainter.dispose();
  assert.ok(nomad.range.length > originalRange.size, 'range mode claims new land');
  const afterRange = nomad.cells.reduce((sum, cell) => sum + cell.population, 0);
  assert.ok(afterRange > originalPopulation, 'range mode adds population instead of only extending the outline');
  assert.ok(Math.abs(afterRange - originalPopulation - (nomad.range.length - originalRange.size) * nomad.density) < 1e-5,
    'each new range point receives the same baseline density as state expansion');

  const densityPainter = new CardPainter(fixture.world, { ...card, ink: 20 }, 'respect');
  densityPainter.setNomadMode('density');
  const home = nomad.range[0];
  densityPainter.dab(home % MAP_WIDTH + 0.5, Math.floor(home / MAP_WIDTH) + 0.5, 1);
  densityPainter.dispose();
  assert.ok(nomad.cells.reduce((sum, cell) => sum + cell.population, 0) > afterRange,
    'density mode increases population inside the existing range');
}

// Foreign city spheres apply the documented rank-based cost/strength factor to nomad expansion.
{
  const fixture = makeCountry();
  const nomad = dissolveCountryIntoNomads(fixture.world, fixture.country)[0];
  const pixel = nomad.range[0];
  const x = pixel % MAP_WIDTH, y = Math.floor(pixel / MAP_WIDTH);
  const cityPixel = [...fixture.world.landIndex].find((candidate) => {
    if (candidate === pixel || fixture.world.cityAt(candidate)) return false;
    const distance = Math.hypot(candidate % MAP_WIDTH - x, Math.floor(candidate / MAP_WIDTH) - y);
    return distance < 10;
  });
  assert.ok(cityPixel !== undefined, 'fixture has a nearby point for a foreign city');
  const city = fixture.world.addCity(fixture.country.id, cityPixel, 2, false);
  assert.ok(city, 'foreign city is created');
  assert.ok(Math.hypot(city.pixel % MAP_WIDTH - x, Math.floor(city.pixel / MAP_WIDTH) - y) <
    cityInfluenceRadius(fixture.world, city), 'the nomad point lies inside the city influence');

  const cell = nomad.cells.find((entry) => entry.pixel === pixel);
  assert.ok(cell, 'nomad has population at its range point');
  const before = cell.population;
  const card = {
    type: 'nomadExpand', title: 'expand', detail: '', ink: 2, inkTotal: 2,
    targetCountryId: null, targetNomadId: nomad.id, newCountryId: null,
    newCultureId: null, newReligionId: null, sourceCultureId: null, newGovernmentId: null,
    newRuler: null, choices: null, selectedChoice: 0, characterEvent: null, hint: pixel,
  };
  const painter = new CardPainter(fixture.world, card, 'respect');
  painter.setNomadMode('density');
  painter.dab(x + 0.5, y + 0.5, 1);
  painter.dispose();
  assert.equal(card.ink, 0, 'rank-two foreign influence doubles the brush cost');
  assert.ok(Math.abs(cell.population - before - 0.5) < 1e-8,
    'rank-two foreign influence halves the population added by the brush');
}

// Nomad families retain ordinary marriage, birth, aging, and leadership-option mechanics.
{
  const fixture = makeCountry();
  const nomad = dissolveCountryIntoNomads(fixture.world, fixture.country)[0];
  const leader = nomad.ruler;
  const options = leadershipOptions(fixture.world, nomad, 12, leader);
  assert.equal(options.length, 2, 'a nomad ruler has two succession candidates');
  assert.notEqual(options[0].id, options[1].id, 'succession candidates are distinct');
  const spouses = marriageCandidates(fixture.world, nomad, leader, 12);
  assert.equal(spouses.length, 2, 'a nomad can receive two marriage candidates');

  const mother = newCitizen(fixture.world, nomad, 0);
  mother.gender = 'female'; mother.age = 25; mother.bornAt = -25;
  registerPerson(fixture.world, nomad, mother);
  const father = newCitizen(fixture.world, nomad, 0);
  father.gender = 'male'; father.age = 27; father.bornAt = -27;
  registerPerson(fixture.world, nomad, father);
  marry(fixture.world, nomad, mother, father);
  assert.ok(mother.spouseIds.includes(father.id) && father.spouseIds.includes(mother.id),
    'nomad marriage is recorded reciprocally');
  const child = birth(fixture.world, nomad, mother, father, 1);
  assert.ok(child, 'a nomad couple can have a child');
  assert.deepEqual(child.parents, [mother.id, father.id], 'nomad child keeps both married parents');
  assert.ok(nomad.personIds.includes(child.id), 'the newborn joins the nomad family registry');
  const ageBefore = mother.age;
  advancePeople(fixture.world, 10, () => 1);
  assert.ok(mother.age > ageBefore, 'nomad residents age during annual simulation');
}

// Nomad political reforms use tribal modifiers but can never change the nomad out of tribal government.
{
  const fixture = makeCountry();
  const nomad = dissolveCountryIntoNomads(fixture.world, fixture.country)[0];
  const proposals = reformCandidates(fixture.world, nomad, 20);
  const modifier = proposals.find((proposal) => proposal.add);
  assert.ok(modifier, 'nomads receive tribal modifier reform proposals');
  assert.ok(!proposals.some((proposal) => proposal.government),
    'nomad reforms do not offer a change away from tribal government');
  applyReform(nomad, modifier);
  assert.equal(nomad.government, 'tribal');
  assert.ok(nomad.modifiers.includes(modifier.add), 'tribal modifier effect applies to a nomad');
}

// Founding a city converts one nomad into a country and conserves its whole population.
{
  const fixture = makeCountry();
  const nomads = dissolveCountryIntoNomads(fixture.world, fixture.country);
  const nomad = nomads[0];
  const totalBefore = nomads.reduce((sum, group) =>
    sum + group.cells.reduce((cellSum, cell) => cellSum + cell.population, 0), 0);
  const cityPixel = nomad.range[0];
  const settled = settleNomadAsCountry(fixture.world, nomad, cityPixel, 20);
  assert.ok(settled, 'nomad can found a city on its unclaimed range');
  assert.equal(fixture.world.owner[cityPixel], settled.id + 1, 'the city point becomes country territory');
  assert.ok(fixture.world.cityAt(cityPixel)?.capital, 'the founded city is the new country capital');
  assert.ok(!fixture.world.nomads.includes(nomad), 'the settled nomad is removed');
  const totalAfter = fixture.world.nomads.reduce((sum, group) =>
    sum + group.cells.reduce((cellSum, cell) => cellSum + cell.population, 0), 0) +
    demography(fixture.world, settled).population;
  assert.ok(Math.abs(totalAfter - totalBefore) < 1e-5,
    `settlement preserves the total population (${totalBefore} → ${totalAfter})`);
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
