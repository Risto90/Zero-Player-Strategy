import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { dissolveCountryIntoNomadicCountries, settleNomadAsCountry } from '../game/nomads.ts';
import { Game } from '../game/game.ts';
import { setPersonHome } from '../game/characters.ts';
import { createPerson } from '../game/government.ts';
import { demography } from '../game/demography.ts';
import { chronicleReference, migrateChronicle } from '../game/chronicle.ts';
import { countryProfileRoute } from '../game/profileRoutes.ts';
import { World } from '../game/world.ts';
import { deserializeWorld, serializeWorld } from '../game/persistence.ts';

function makeCountry({ cultures = 2, modifiers = [], religions = true } = {}) {
  const world = World.create('random', 91421);
  const cultureEntities = Array.from({ length: cultures }, () => world.newCulture(null, 0));
  const faiths = religions ? [world.newReligion(0), world.newReligion(0)] : [];
  const country = world.newCountry({
    rank: 'тест',
    cultureId: cultureEntities[0].id,
    religionId: faiths[0]?.id ?? null,
    density: 100,
    foundedYear: 0,
    parentId: null,
  });
  country.modifiers = [...modifiers];
  const pixels = Array.from(world.landIndex.slice(0, cultures));
  const faithMix = religions
    ? world.religionTable.intern(new Map([[faiths[0].id, 40], [faiths[1].id, 30]]))
    : 0;
  pixels.forEach((pixel, index) => {
    world.setOwner(pixel, country.id + 1);
    world.density[pixel] = 100;
    world.culture[pixel] = world.cultureTable.single(cultureEntities[index].id, 100);
    world.religion[pixel] = faithMix;
  });
  return { world, country, pixels, cultures: cultureEntities, faiths };
}

function withRandom(value, action) {
  const original = Math.random;
  Math.random = () => value;
  try { return action(); } finally { Math.random = original; }
}

function groupCultureIds(country, world) {
  const ids = new Set();
  for (const cell of country.cells ?? []) {
    for (const id of world.cultureTable.entries[cell.cultureMix].ids) ids.add(id);
  }
  return ids;
}

function groupFaithTotals(countries, world, faiths) {
  const totals = new Map(faiths.map((id) => [id, 0]));
  let atheist = 0;
  let population = 0;
  for (const country of countries) for (const cell of country.cells ?? []) {
    const mix = world.religionTable.entries[cell.religionMix];
    population += cell.population;
    for (let i = 0; i < mix.ids.length; i += 1) {
      totals.set(mix.ids[i], (totals.get(mix.ids[i]) ?? 0) + cell.population * mix.shares[i] / 100);
    }
    atheist += cell.population * (100 - mix.total) / 100;
  }
  return { population, totals, atheist };
}

// The last-city loss path retires the settled country and appends new country IDs.
{
  const fixture = makeCountry({ cultures: 1, religions: false });
  const city = fixture.world.addCity(fixture.country.id, fixture.pixels[0], 1, true);
  assert.ok(city);
  fixture.world.removeCity(city.id);
  const previousPersist = Game.persist;
  Game.persist = false;
  const game = new Game(fixture.world, 'observer');
  try {
    game.startCard({
      type: 'moveCapital', title: 'test', detail: '', ink: 0, inkTotal: 0,
      targetCountryId: fixture.country.id, newCountryId: null, newCultureId: null,
      newReligionId: null, sourceCultureId: null, newGovernmentId: null,
      newRuler: null, choices: null, selectedChoice: 0, characterEvent: null, hint: -1,
    });
    game.dispatchAction({ type: 'completeCard' });
  } finally {
    game.discard();
    Game.persist = previousPersist;
  }
  const created = fixture.world.countries.filter((country) =>
    country.type === 'nomadic' && country.sourceCountryId === fixture.country.id);
  assert.equal(created.length, 1);
  assert.equal(fixture.country.pixels, 0);
  assert.notEqual(created[0].id, fixture.country.id);
}

// Default: every culture becomes its own country, including the 16-culture case.
{
  const fixture = makeCountry({ cultures: 16, religions: false });
  const oldId = fixture.country.id;
  const created = dissolveCountryIntoNomadicCountries(fixture.world, fixture.country, 10);
  assert.equal(created.length, 16);
  assert.ok(created.every((country) => country.type === 'nomadic'));
  assert.ok(created.every((country) => country.id !== oldId));
  assert.equal(fixture.world.countries.length, 17);
  assert.equal(fixture.country.type, 'settled');
  assert.equal(fixture.country.pixels, 0);
  assert.ok(created.every((country) => groupCultureIds(country, fixture.world).size === 1));
  assert.equal('nomads' in fixture.world, false);
  assert.equal('nomadVersion' in fixture.world, false);
}

// Ethnic government guarantees per-culture countries even with communism/confederation.
{
  const fixture = makeCountry({ modifiers: ['ethnic', 'communist', 'confederation'] });
  const created = dissolveCountryIntoNomadicCountries(fixture.world, fixture.country, 10);
  assert.equal(created.length, 2);
  assert.ok(created.every((country) => groupCultureIds(country, fixture.world).size === 1));
}

// Communism suppresses culture separation; federation and confederation retain their stated chances.
{
  const communist = makeCountry({ modifiers: ['communist', 'federation'] });
  const one = withRandom(0, () => dissolveCountryIntoNomadicCountries(communist.world, communist.country, 10));
  assert.equal(one.length, 1);
  assert.equal(groupCultureIds(one[0], communist.world).size, 2);

  const federationSplit = makeCountry({ modifiers: ['federation'] });
  assert.equal(withRandom(0, () => dissolveCountryIntoNomadicCountries(federationSplit.world, federationSplit.country, 10)).length, 2);
  const federationCombined = makeCountry({ modifiers: ['federation'] });
  const combined = withRandom(0.99, () => dissolveCountryIntoNomadicCountries(federationCombined.world, federationCombined.country, 10));
  assert.equal(combined.length, 1);
  assert.equal(groupCultureIds(combined[0], federationCombined.world).size, 2);

  const confederationSplit = makeCountry({ modifiers: ['confederation'] });
  assert.equal(withRandom(0.1, () => dissolveCountryIntoNomadicCountries(confederationSplit.world, confederationSplit.country, 10)).length, 2);
  const confederationCombined = makeCountry({ modifiers: ['confederation'] });
  assert.equal(withRandom(0.99, () => dissolveCountryIntoNomadicCountries(confederationCombined.world, confederationCombined.country, 10)).length, 1);
}

// Theocracy splits religions within ethnic groups; atheists are attached to a faithful group.
{
  const fixture = makeCountry({ modifiers: ['ethnic', 'theocracy'] });
  const created = dissolveCountryIntoNomadicCountries(fixture.world, fixture.country, 10);
  assert.equal(created.length, 4);
  const faiths = fixture.faiths.map((faith) => faith.id);
  const { population, totals, atheist } = groupFaithTotals(created, fixture.world, faiths);
  assert.equal(population, 200);
  assert.ok(Math.abs(totals.get(faiths[0]) - 80) < 1e-6);
  assert.ok(Math.abs(totals.get(faiths[1]) - 60) < 1e-6);
  assert.ok(Math.abs(atheist - 60) < 1e-6);
  assert.ok(created.every((country) => (country.cells ?? []).every((cell) =>
    fixture.world.religionTable.entries[cell.religionMix].ids.length === 1)));
  assert.ok(created.every((country) => (country.cells ?? []).some((cell) =>
    fixture.world.religionTable.entries[cell.religionMix].total > 0)),
  'atheists never create a standalone country');
}

// Without ethnic form, communism can combine cultures while a theocratic federal split remains probabilistic.
{
  const combinedFaiths = makeCountry({ modifiers: ['communist', 'federation', 'theocracy'] });
  const one = withRandom(0.99, () => dissolveCountryIntoNomadicCountries(combinedFaiths.world, combinedFaiths.country, 10));
  assert.equal(one.length, 1, 'federation may keep the religions together at 50% odds');
  assert.equal(groupCultureIds(one[0], combinedFaiths.world).size, 2);

  const splitFaiths = makeCountry({ modifiers: ['communist', 'confederation', 'theocracy'] });
  const separated = withRandom(0.1, () => dissolveCountryIntoNomadicCountries(splitFaiths.world, splitFaiths.country, 10));
  assert.equal(separated.length, 2, 'confederation separates religions at 25% odds');
  const { population, atheist } = groupFaithTotals(separated, splitFaiths.world, splitFaiths.faiths.map((faith) => faith.id));
  assert.equal(population, 200);
  assert.ok(Math.abs(atheist - 60) < 1e-6);
}

// People have one current country ID; settlement changes type but preserves that ID and population.
{
  const fixture = makeCountry();
  const resident = createPerson(0, 24, undefined, [], fixture.cultures[0].id, fixture.faiths[0].id);
  setPersonHome(resident, fixture.country);
  fixture.world.people.push(resident);
  const created = dissolveCountryIntoNomadicCountries(fixture.world, fixture.country, 10);
  const home = fixture.world.countries[resident.countryId];
  assert.ok(home && home.type === 'nomadic');
  assert.equal('nomadId' in resident, false);
  const countryId = home.id;
  const totalBefore = created.reduce((sum, country) => sum + (country.cells ?? []).reduce((n, cell) => n + cell.population, 0), 0);
  const settled = settleNomadAsCountry(fixture.world, home, home.range[0], 11);
  assert.equal(settled, home);
  assert.equal(home.id, countryId);
  assert.equal(home.type, 'settled');
  assert.equal(resident.countryId, countryId);
  assert.equal(home.cells, undefined);
  const totalAfter = fixture.world.countries
    .filter((country) => country.type === 'nomadic')
    .reduce((sum, country) => sum + (country.cells ?? []).reduce((n, cell) => n + cell.population, 0), demography(fixture.world, home).population);
  assert.ok(Math.abs(totalAfter - totalBefore) < 1e-5);
}

// New saves serialize the unified list; legacy nomad arrays and person IDs migrate into it.
{
  const fixture = makeCountry();
  const resident = createPerson(0, 24, undefined, [], fixture.cultures[1].id, fixture.faiths[1].id);
  setPersonHome(resident, fixture.country);
  fixture.world.people.push(resident);
  dissolveCountryIntoNomadicCountries(fixture.world, fixture.country, 10);
  const saved = serializeWorld(fixture.world);
  assert.equal('nomads' in saved, false);
  const roundTrip = deserializeWorld(saved);
  assert.ok(roundTrip.countries.some((country) => country.type === 'nomadic'));
  assert.equal(roundTrip.people.find((person) => person.id === resident.id).countryId, resident.countryId);

  const legacy = structuredClone(saved);
  const legacyGroups = legacy.countries.filter((country) => country.type === 'nomadic');
  const nominalIdByCountryId = new Map(legacyGroups.map((country, index) => [country.id, index]));
  legacy.nomads = legacyGroups.map((country, id) => ({
    ...country,
    id,
    personIds: legacy.people.filter((person) => person.countryId === country.id).map((person) => person.id),
  }));
  legacy.countries = legacy.countries.filter((country) => country.type !== 'nomadic').map((country) => {
    const { type, range, cells, sourceCountryId, ...settled } = country;
    return settled;
  });
  legacy.people = legacy.people.map((person) => {
    const id = nominalIdByCountryId.get(person.countryId);
    if (id === undefined) return person;
    return { ...person, countryId: -1, nomadId: id };
  });
  const migrated = deserializeWorld(legacy);
  const migratedResident = migrated.people.find((person) => person.id === resident.id);
  assert.equal(migratedResident.countryId, legacy.countries.length + nominalIdByCountryId.get(resident.countryId));
  assert.equal('nomadId' in migratedResident, false);
  const newSave = serializeWorld(migrated);
  assert.equal('nomads' in newSave, false);
  assert.ok(newSave.countries.every((country) => country.type === 'settled' || country.type === 'nomadic'));

  const migratedChronicle = migrateChronicle([{
    year: 5, text: 'legacy nomad entry', objects: [{ type: 'nomad', id: 1 }],
  }], new Map([[1, 42]]));
  assert.deepEqual(migratedChronicle[0].objects, [chronicleReference('country', 42)]);
}

// Nomadic overlays and links use the shared country page; no separate route exists.
{
  assert.deepEqual(countryProfileRoute(7), {
    pathname: '/country/[id]',
    params: { id: '7' },
  });
  assert.ok(!existsSync(resolve(process.cwd(), 'app/nomad/[id].tsx')));
}

console.log('Unified country conversion, splitting, resident, migration, and profile regressions passed.');
