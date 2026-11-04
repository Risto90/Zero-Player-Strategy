import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { dissolveCountryIntoNomadicCountries, settleNomadAsCountry } from '../game/nomads.ts';
import { Game } from '../game/game.ts';
import { setPersonHome } from '../game/characters.ts';
import { createPerson } from '../game/government.ts';
import { demography } from '../game/demography.ts';
import { climateSuitability } from '../game/human.ts';
import { chronicleReference, migrateChronicle } from '../game/chronicle.ts';
import { countryProfileRoute } from '../game/profileRoutes.ts';
import { World } from '../game/world.ts';
import { MAP_WIDTH } from '../game/config.ts';
import { deserializeWorld, serializeWorld } from '../game/persistence.ts';
import { densityToResidents, residentsToDensity } from '../game/populationUnits.ts';
import { CardPainter } from '../game/brush.ts';
import { autoPaint } from '../game/autoPaint.ts';
import { climateAdjustedPopulationCohorts, populationCohortsFromMixes } from '../game/populationCohorts.ts';
import { ContourArea } from '../game/contours.ts';
import { forEachNeighbour } from '../game/geography.ts';

function makeCountry({ cultures = 2, modifiers = [], religions = true } = {}) {
  const world = World.create('random', 91421);
  const cultureEntities = Array.from({ length: cultures }, () => world.newCulture(null, 0));
  const faiths = religions ? [world.newReligion(0), world.newReligion(0)] : [];
  const country = world.newCountry({
    rank: 'тест',
    cultureId: cultureEntities[0].id,
    religionId: faiths[0]?.id ?? null,
    density: residentsToDensity(100),
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
    world.density[pixel] = residentsToDensity(100);
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
    const residents = densityToResidents(cell.density);
    population += residents;
    for (let i = 0; i < mix.ids.length; i += 1) {
      totals.set(mix.ids[i], (totals.get(mix.ids[i]) ?? 0) + residents * mix.shares[i] / 100);
    }
    atheist += residents * (100 - mix.total) / 100;
  }
  return { population, totals, atheist };
}

// Страна без города превращается в кочевье только после завершения всего хода.
{
  const fixture = makeCountry({ cultures: 1, religions: false });
  const city = fixture.world.addCity(fixture.country.id, fixture.pixels[0], 1, true);
  assert.ok(city);
  fixture.world.removeCity(city.id);
  const previousPersist = Game.persist;
  const previousPause = Game.pause;
  Game.persist = false;
  Game.pause = async () => {};
  const game = new Game(fixture.world, 'observer');
  game.role = 'all';
  try {
    game.startCard({
      type: 'moveCapital', title: 'test', detail: '', ink: 0, inkTotal: 0,
      targetCountryId: fixture.country.id, newCountryId: null, newCultureId: null,
      newReligionId: null, sourceCultureId: null, newGovernmentId: null,
      newRuler: null, choices: null, selectedChoice: 0, characterEvent: null, hint: -1,
    });
    await game.nextTurn();
  } finally {
    game.discard();
    Game.persist = previousPersist;
    Game.pause = previousPause;
  }
  const created = fixture.world.countries.filter((country) =>
    country.type === 'nomadic' && country.sourceCountryId === fixture.country.id);
  assert.equal(created.length, 1);
  assert.equal(fixture.country.pixels, 0);
  assert.notEqual(created[0].id, fixture.country.id);
}

// Полностью захваченная страна не создаёт кочевников даже после завершения хода.
{
  const fixture = makeCountry({ cultures: 1, religions: false });
  const city = fixture.world.addCity(fixture.country.id, fixture.pixels[0], 1, true);
  assert.ok(city);
  fixture.world.removeCity(city.id);
  const conquerorCulture = fixture.world.newCulture(null, 1);
  const conqueror = fixture.world.newCountry({
    rank: 'тест',
    cultureId: conquerorCulture.id,
    religionId: null,
    density: residentsToDensity(100),
    foundedYear: 1,
    parentId: null,
  });
  for (const pixel of fixture.pixels) fixture.world.setOwner(pixel, conqueror.id + 1);
  assert.equal(fixture.country.pixels, 0);

  const previousPersist = Game.persist;
  const previousPause = Game.pause;
  Game.persist = false;
  Game.pause = async () => {};
  const game = new Game(fixture.world, 'observer');
  game.role = 'all';
  try {
    game.startCard({
      type: 'moveCapital', title: 'test', detail: '', ink: 0, inkTotal: 0,
      targetCountryId: fixture.country.id, newCountryId: null, newCultureId: null,
      newReligionId: null, sourceCultureId: null, newGovernmentId: null,
      newRuler: null, choices: null, selectedChoice: 0, characterEvent: null, hint: -1,
    });
    await game.nextTurn();
  } finally {
    game.discard();
    Game.persist = previousPersist;
    Game.pause = previousPause;
  }
  assert.equal(fixture.world.countries.some((country) =>
    country.type === 'nomadic' && country.sourceCountryId === fixture.country.id), false);
}

// По умолчанию каждая культура становится отдельной страной, включая случай с 16 культурами.
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

// Этническая форма правления гарантирует отдельные страны для культур даже при коммунизме или конфедерации.
{
  const fixture = makeCountry({ modifiers: ['ethnic', 'communist', 'confederation'] });
  const created = dissolveCountryIntoNomadicCountries(fixture.world, fixture.country, 10);
  assert.equal(created.length, 2);
  assert.ok(created.every((country) => groupCultureIds(country, fixture.world).size === 1));
}

// Коммунизм отменяет разделение по культурам; федерация и конфедерация сохраняют заданные вероятности.
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

// Теократия разделяет религии внутри этнических групп; атеисты присоединяются к группе верующих.
{
  const fixture = makeCountry({ modifiers: ['ethnic', 'theocracy'] });
  const created = dissolveCountryIntoNomadicCountries(fixture.world, fixture.country, 10);
  assert.equal(created.length, 4);
  const faiths = fixture.faiths.map((faith) => faith.id);
  const { population, totals, atheist } = groupFaithTotals(created, fixture.world, faiths);
  assert.ok(Math.abs(population - 200) < 1e-3);
  assert.ok(Math.abs(totals.get(faiths[0]) - 80) < 1e-3);
  assert.ok(Math.abs(totals.get(faiths[1]) - 60) < 1e-3);
  assert.ok(Math.abs(atheist - 60) < 1e-3);
  assert.ok(created.every((country) => (country.cells ?? []).every((cell) =>
    fixture.world.religionTable.entries[cell.religionMix].ids.length === 1)));
  assert.ok(created.every((country) => (country.cells ?? []).some((cell) =>
    fixture.world.religionTable.entries[cell.religionMix].total > 0)),
  'atheists never create a standalone country');
}

// Без этнической формы правления коммунизм может объединять культуры, а теократическое разделение федерации остаётся вероятностным.
{
  const combinedFaiths = makeCountry({ modifiers: ['communist', 'federation', 'theocracy'] });
  const one = withRandom(0.99, () => dissolveCountryIntoNomadicCountries(combinedFaiths.world, combinedFaiths.country, 10));
  assert.equal(one.length, 1, 'federation may keep the religions together at 50% odds');
  assert.equal(groupCultureIds(one[0], combinedFaiths.world).size, 2);

  const splitFaiths = makeCountry({ modifiers: ['communist', 'confederation', 'theocracy'] });
  const separated = withRandom(0.1, () => dissolveCountryIntoNomadicCountries(splitFaiths.world, splitFaiths.country, 10));
  assert.equal(separated.length, 2, 'confederation separates religions at 25% odds');
  const { population, atheist } = groupFaithTotals(separated, splitFaiths.world, splitFaiths.faiths.map((faith) => faith.id));
  assert.ok(Math.abs(population - 200) < 1e-3);
  assert.ok(Math.abs(atheist - 60) < 1e-3);
}

// У населения один текущий идентификатор страны; переход к оседлой форме меняет тип, сохраняя идентификатор и численность.
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
  const totalBefore = created.reduce((sum, country) =>
    sum + (country.cells ?? []).reduce((n, cell) => n + densityToResidents(cell.density), 0), 0);
  const settled = settleNomadAsCountry(fixture.world, home, home.range[0], 11);
  assert.equal(settled, home);
  assert.equal(home.id, countryId);
  assert.equal(home.type, 'settled');
  assert.equal(resident.countryId, countryId);
  assert.equal(home.cells, undefined);
  const totalAfter = fixture.world.countries
    .filter((country) => country.type === 'nomadic')
    .reduce((sum, country) => sum +
      (country.cells ?? []).reduce((n, cell) => n + densityToResidents(cell.density), 0),
    demography(fixture.world, home).population);
  assert.ok(Math.abs(totalAfter - totalBefore) < 1e-3,
    `settled and nomadic residents conserve population (${totalBefore} vs. ${totalAfter})`);
}

// Доступная историческая ветвь возвращается в старую страну без потери её государственного строя и герба.
{
  const fixture = makeCountry({ cultures: 1, religions: false, modifiers: ['ethnic'] });
  const city = fixture.world.addCity(fixture.country.id, fixture.pixels[0], 1, true);
  assert.ok(city);
  fixture.world.removeCity(city.id);
  fixture.country.government = 'republic';
  const original = {
    id: fixture.country.id,
    name: fixture.country.name,
    color: fixture.country.color,
    government: fixture.country.government,
    modifiers: [...fixture.country.modifiers],
    emblemSpec: structuredClone(fixture.country.emblemSpec),
    foundedYear: fixture.country.foundedYear,
  };
  const nomad = dissolveCountryIntoNomadicCountries(fixture.world, fixture.country, 10)[0];
  const rulerId = nomad.ruler.id;
  const restored = settleNomadAsCountry(
    fixture.world, nomad, nomad.range[0], 11, 'revive',
  );
  assert.equal(restored, fixture.country);
  assert.equal(restored.id, original.id);
  assert.equal(restored.name, original.name);
  assert.equal(restored.color, original.color);
  assert.equal(restored.government, original.government);
  assert.deepEqual(restored.modifiers, original.modifiers);
  assert.deepEqual(restored.emblemSpec, original.emblemSpec);
  assert.equal(restored.foundedYear, original.foundedYear);
  assert.equal(restored.ruler.id, rulerId);
  assert.ok(restored.rulerTerms.some((term) =>
    term.personId === rulerId && term.endYear === null && term.startYear === 11));
  assert.ok(restored.pixels > 0);
  assert.ok(fixture.world.cities.some((item) => item.countryId === restored.id));
  assert.equal(nomad.type, 'settled');
  assert.equal(nomad.pixels, 0);
  assert.equal(nomad.range, undefined);
  assert.equal(nomad.cells, undefined);

  const laterNomad = fixture.world.newCountry({
    rank: 'кочевье',
    cultureId: fixture.cultures[0].id,
    religionId: null,
    density: residentsToDensity(100),
    foundedYear: 11,
    parentId: original.id,
  });
  laterNomad.type = 'nomadic';
  laterNomad.sourceCountryId = original.id;
  laterNomad.range = [fixture.world.landIndex.find((pixel) => fixture.world.owner[pixel] === 0)];
  laterNomad.cells = [];
  const newState = settleNomadAsCountry(
    fixture.world, laterNomad, laterNomad.range[0], 12, 'revive',
  );
  assert.equal(newState, laterNomad,
    'если историческая страна уже действует, ветвь автоматически основывает новое государство');
  assert.equal(laterNomad.type, 'settled');
  assert.ok(laterNomad.pixels > 0);
}

// Игрок может выбрать новую страну, а ИИ всегда возрождает доступную историческую страну.
{
  const fixture = makeCountry({ cultures: 1, religions: false });
  const nomad = dissolveCountryIntoNomadicCountries(fixture.world, fixture.country, 10)[0];
  const previousPersist = Game.persist;
  Game.persist = false;
  const game = new Game(fixture.world, 'observer');
  try {
    game.startCard({
      type: 'buildCity', title: 'Город', detail: '', ink: 0, inkTotal: 0,
      targetCountryId: nomad.id, newCountryId: null, newCultureId: null,
      newReligionId: null, sourceCultureId: null, newGovernmentId: null,
      newRuler: null, choices: null, selectedChoice: 0, characterEvent: null, hint: -1,
    });
    game.selectNomadSettlement('new');
    assert.equal(game.getSnapshot().card.nomadSettlementChoice, 'new');
    assert.equal(
      game.selectCityAt(nomad.range[0] % MAP_WIDTH, Math.floor(nomad.range[0] / MAP_WIDTH)),
      true,
    );
    assert.equal(nomad.type, 'settled', 'выбранная новая ветвь становится оседлой');
    assert.equal(fixture.country.pixels, 0, 'выбор новой страны не возрождает прежнюю');
  } finally {
    game.discard();
    Game.persist = previousPersist;
  }
}

{
  const fixture = makeCountry({ cultures: 1, religions: false });
  const nomad = dissolveCountryIntoNomadicCountries(fixture.world, fixture.country, 10)[0];
  const rulerId = nomad.ruler.id;
  const previousPersist = Game.persist;
  Game.persist = false;
  const game = new Game(fixture.world, 'observer');
  const branchEntry = {
    year: 10,
    text: 'Событие кочевой ветви',
    objects: [chronicleReference('country', nomad.id)],
    importantObjects: [chronicleReference('country', nomad.id)],
    scope: 'world',
  };
  game.log = [branchEntry];
  try {
    const card = {
      type: 'buildCity', title: 'Город', detail: '', ink: 0, inkTotal: 0,
      targetCountryId: nomad.id, newCountryId: null, newCultureId: null,
      newReligionId: null, sourceCultureId: null, newGovernmentId: null,
      newRuler: null, choices: null, selectedChoice: 0, characterEvent: null, hint: -1,
    };
    game.resolveAutomatically(card);
    assert.equal(card.nomadSettlementChoice, 'revive', 'ИИ выбирает возрождение, если оно доступно');
    assert.ok(fixture.country.pixels > 0, 'ИИ возвращает территорию старой сущности');
    assert.equal(fixture.country.ruler.id, rulerId);
    assert.equal(nomad.pixels, 0, 'кочевая ветвь перестаёт быть активной после слияния');
    const archivedBranchEntry = game.log.find((entry) =>
      typeof entry !== 'string' && entry.text === 'Событие кочевой ветви');
    assert.ok(archivedBranchEntry.objects.some((reference) =>
      reference.type === 'country' && reference.id === fixture.country.id));
    assert.equal(archivedBranchEntry.objects.some((reference) =>
      reference.type === 'country' && reference.id === nomad.id), false,
    'летопись кочевой ветви переносится в возрождённую страну');
  } finally {
    game.discard();
    Game.persist = previousPersist;
  }
}

// Новые сохранения записывают единую коллекцию; старые массивы кочевников и идентификаторы персонажей переносятся в неё.
{
  const fixture = makeCountry();
  const resident = createPerson(0, 24, undefined, [], fixture.cultures[1].id, fixture.faiths[1].id);
  setPersonHome(resident, fixture.country);
  fixture.world.people.push(resident);
  dissolveCountryIntoNomadicCountries(fixture.world, fixture.country, 10);
  const nomad = fixture.world.countries.find((country) => country.type === 'nomadic');
  assert.ok(nomad?.cells?.length);
  const rasterCultureMixes = new Set(fixture.world.culture);
  let nomadCultureMix;
  for (let share = 5; share < 100; share += 5) {
    const id = fixture.world.cultureTable.intern(new Map([
      [fixture.cultures[0].id, share],
      [fixture.cultures[1].id, 100 - share],
    ]));
    if (!rasterCultureMixes.has(id)) {
      nomadCultureMix = id;
      break;
    }
  }
  assert.notEqual(nomadCultureMix, undefined);
  const rasterReligionMixes = new Set(fixture.world.religion);
  let nomadReligionMix;
  for (let share = 5; share < 100; share += 5) {
    const id = fixture.world.religionTable.intern(new Map([
      [fixture.faiths[0].id, share],
      [fixture.faiths[1].id, 100 - share],
    ]));
    if (!rasterReligionMixes.has(id)) {
      nomadReligionMix = id;
      break;
    }
  }
  assert.notEqual(nomadReligionMix, undefined);
  nomad.cells[0].cultureMix = nomadCultureMix;
  nomad.cells[0].religionMix = nomadReligionMix;
  const expectedCulture = structuredClone(fixture.world.cultureTable.entries[nomadCultureMix]);
  const expectedReligion = structuredClone(fixture.world.religionTable.entries[nomadReligionMix]);
  const saved = serializeWorld(fixture.world);
  assert.equal('nomads' in saved, false);
  const roundTrip = deserializeWorld(saved);
  assert.ok(roundTrip.countries.some((country) => country.type === 'nomadic'));
  assert.equal(roundTrip.people.find((person) => person.id === resident.id).countryId, resident.countryId);
  const roundTripNomad = roundTrip.countries.find((country) => country.type === 'nomadic');
  assert.deepEqual(roundTrip.cultureTable.entries[roundTripNomad.cells[0].cultureMix], expectedCulture);
  assert.deepEqual(roundTrip.religionTable.entries[roundTripNomad.cells[0].religionMix], expectedReligion);

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

// Слои кочевников и ссылки используют общую страницу страны; отдельного маршрута нет.
{
  assert.deepEqual(countryProfileRoute(7), {
    pathname: '/country/[id]',
    params: { id: '7' },
  });
  assert.ok(!existsSync(resolve(process.cwd(), 'app/nomad/[id].tsx')));
}

// ИИ расширяет контур кочевья без подсказки-пикселя через общий контурный путь.
{
  const fixture = makeCountry({ cultures: 1, religions: false });
  const nomad = dissolveCountryIntoNomadicCountries(fixture.world, fixture.country, 10)[0];
  assert.ok(nomad?.range?.length);
  const range = new Set(nomad.range);
  const origin = nomad.range[0];
  let adjacent = -1;
  forEachNeighbour(origin, (pixel) => {
    if (adjacent < 0 && fixture.world.land[pixel] && !range.has(pixel)) adjacent = pixel;
  });
  assert.ok(adjacent >= 0, 'у ареала кочевья есть соседняя точка суши');
  const card = {
    type: 'nomadExpand', title: 'Тест', detail: '', ink: 2, inkTotal: 2,
    targetCountryId: nomad.id, newCountryId: null, newCultureId: null, newReligionId: null,
    sourceCultureId: null, newGovernmentId: null, newRuler: null, choices: null,
    selectedChoice: 0, characterEvent: null, hint: -1,
  };
  const painter = new CardPainter(fixture.world, card, 'respect');
  assert.ok(painter.strategyImpactAt(adjacent) > 0, 'соседняя точка допустима для кисти');
  autoPaint(painter, {
    beginStroke: (x, y) => painter.dab(x, y, 8),
    dab: (x, y, radius) => painter.dab(x, y, radius),
    line: (ax, ay, bx, by, radius) => painter.line(ax, ay, bx, by, radius),
    endStroke: () => painter.endStroke(),
    contour: (area, seed) => painter.paintContour(area, seed),
    contours: (areas) => painter.paintContours(areas),
  });
  const paintedNeighbor = painter.changed.find((pixel) => {
    let linked = false;
    forEachNeighbour(pixel, (neighbor) => { if (range.has(neighbor)) linked = true; });
    return linked;
  });
  assert.ok(paintedNeighbor !== undefined, 'контурная стратегия заселяет соседнюю точку');
  assert.ok(nomad.range.includes(paintedNeighbor), 'новая точка добавлена в ареал кочевья');
}

// Создание и уплотнение кочевого населения учитывают климат и сохраняют состав групп.
{
  const fixture = makeCountry({ cultures: 1, religions: false });
  const nomad = dissolveCountryIntoNomadicCountries(fixture.world, fixture.country, 10)[0];
  assert.ok(nomad?.range?.length);
  const range = new Set(nomad.range);
  const origin = nomad.range[0];
  let target = -1;
  forEachNeighbour(origin, (pixel) => {
    if (target < 0 && fixture.world.land[pixel] && !range.has(pixel)) target = pixel;
  });
  assert.ok(target >= 0, 'у ареала есть доступная соседняя точка суши');
  fixture.world.temperature[target] = -30;
  fixture.world.humidity[target] = 50;
  fixture.world.drainage[target] = 50;
  const sourceGroupsForNomad = () => nomad.cells.flatMap((cell) => {
    const residents = densityToResidents(cell.density);
    return cell.populationGroups?.length
      ? cell.populationGroups.map((group) => ({
        cultureId: group.cultureId,
        religionId: group.religionId,
        originProfileId: group.originProfileId,
        weight: residents * group.share / 100,
      }))
      : populationCohortsFromMixes(
        fixture.world,
        cell.cultureMix,
        cell.religionMix,
        cell.humanOriginMix,
        residents,
      );
  });
  const sourceGroups = sourceGroupsForNomad();
  const expectedGrowth = climateAdjustedPopulationCohorts(
    sourceGroups,
    fixture.world.temperature[target],
    fixture.world.humidity[target],
    fixture.world.drainage[target],
  );
  assert.ok(expectedGrowth.growthFactor > 0 && expectedGrowth.growthFactor < 1);
  const card = {
    type: 'nomadExpand', title: 'Тест', detail: '', ink: 100, inkTotal: 100,
    targetCountryId: nomad.id, newCountryId: null, newCultureId: null, newReligionId: null,
    sourceCultureId: null, newGovernmentId: null, newRuler: null, choices: null,
    selectedChoice: 0, characterEvent: null, hint: target,
  };
  const painter = new CardPainter(fixture.world, card, 'respect');
  const originMix = demography(fixture.world, nomad).humanOrigin;
  const leaderIndex = originMix.shares.reduce(
    (leader, share, index, shares) => share > shares[leader] ? index : leader,
    0,
  );
  const leadingRaceId = originMix.ids[leaderIndex] ?? 0;
  assert.equal(
    painter.strategyClimateFit(23, 50, 50),
    climateSuitability({ ids: [leadingRaceId], shares: [100] }, 23, 50, 50),
  );
  const expectedDensity = painter.strategyImpactAt(target) * expectedGrowth.growthFactor;
  assert.ok(expectedDensity > 0);
  assert.ok(painter.paintContour(ContourArea.pixels([target]), target) > 0);
  const created = nomad.cells.find((cell) => cell.pixel === target);
  assert.ok(created);
  assert.ok(Math.abs(created.density - expectedDensity) < 1e-10);
  assert.ok(created.populationGroups?.length);
  assert.ok(Math.abs(created.populationGroups.reduce((sum, group) => sum + group.share, 0) - 100) < 1e-6);
  const densityTarget = nomad.range[0];
  fixture.world.temperature[densityTarget] = -30;
  fixture.world.humidity[densityTarget] = 50;
  fixture.world.drainage[densityTarget] = 50;
  const densityGrowth = climateAdjustedPopulationCohorts(
    sourceGroupsForNomad(),
    fixture.world.temperature[densityTarget],
    fixture.world.humidity[densityTarget],
    fixture.world.drainage[densityTarget],
  );
  const densityCard = { ...card, ink: 100, inkTotal: 100, hint: densityTarget };
  const densityPainter = new CardPainter(fixture.world, densityCard, 'respect');
  densityPainter.setNomadMode('density');
  const densityBefore = nomad.cells.find((cell) => cell.pixel === densityTarget).density;
  const expectedDensityIncrease = densityPainter.strategyImpactAt(densityTarget) * densityGrowth.growthFactor;
  assert.ok(expectedDensityIncrease > 0);
  assert.ok(densityPainter.paintContour(ContourArea.pixels([densityTarget]), densityTarget) > 0);
  const denserCell = nomad.cells.find((cell) => cell.pixel === densityTarget);
  assert.ok(Math.abs(denserCell.density - densityBefore - expectedDensityIncrease) < 1e-10);
  const restored = deserializeWorld(serializeWorld(fixture.world));
  const restoredCell = restored.countries[nomad.id].cells.find((cell) => cell.pixel === densityTarget);
  assert.deepEqual(restoredCell.populationGroups, denserCell.populationGroups);
}

console.log('Проверки преобразования страны, раздела, населения, миграции, профилей и контурного расширения кочевья пройдены.');
