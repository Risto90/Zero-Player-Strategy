import { strict as assert } from 'node:assert';
import { Game } from '../game/game.ts';
import { drawSplitCard } from '../game/cards.ts';
import { MAP_HEIGHT, MAP_WIDTH } from '../game/config.ts';
import { createPerson } from '../game/government.ts';
import { canAssignSplitPixel, validateSplitPartition, validateSplitTerritory } from '../game/brush.ts';
import { World } from '../game/world.ts';

function patchWorld(width, height, cityColumns) {
  const world = World.create('random', 482048);
  const x0 = Math.floor((MAP_WIDTH - width) / 2);
  const y0 = Math.floor((MAP_HEIGHT - height) / 2);
  const pixels = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = (y0 + y) * MAP_WIDTH + x0 + x;
      pixels.push(pixel);
      world.land[pixel] = 1;
    }
  }
  const existingLand = new Set(world.landIndex);
  const addedLand = pixels.filter((pixel) => !existingLand.has(pixel));
  world.landIndex = Int32Array.from([...world.landIndex, ...addedLand]);
  const culture = world.newCulture(null, 0);
  const country = world.newCountry({
    rank: 'тест',
    cultureId: culture.id,
    religionId: null,
    density: 10,
    foundedYear: 0,
    parentId: null,
    government: 'hereditary',
  });
  const mix = world.cultureTable.single(culture.id, 100);
  for (const pixel of pixels) {
    world.setOwner(pixel, country.id + 1);
    world.density[pixel] = 10;
    world.culture[pixel] = mix;
  }
  const cities = cityColumns.map(({ column, rank }, index) => {
    const pixel = pixels[Math.min(pixels.length - 1, column)];
    return world.addCity(country.id, pixel, rank, index === 0);
  });
  assert.ok(cities.every(Boolean), 'the fixture cities are created on the connected land patch');
  return { world, country, pixels, cities, x0, y0, width, height };
}

function paintAt(game, pixel) {
  game.dispatchAction({
    type: 'dab',
    x: (pixel % MAP_WIDTH) + 0.5,
    y: Math.floor(pixel / MAP_WIDTH) + 0.5,
    radius: 1,
  });
  game.dispatchAction({ type: 'endStroke' });
}

function assertConnected(world, countryId) {
  const owned = [];
  for (const pixel of world.landIndex) {
    if (world.owner[pixel] === countryId + 1) owned.push(pixel);
  }
  assert.ok(owned.length > 0, `country ${countryId} owns land`);
  const visited = new Set([owned[0]]);
  const queue = [owned[0]];
  for (let head = 0; head < queue.length; head += 1) {
    const pixel = queue[head];
    for (const next of [pixel - 1, pixel + 1, pixel - MAP_WIDTH, pixel + MAP_WIDTH]) {
      if (world.owner[next] === countryId + 1 && !visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  assert.equal(visited.size, owned.length, `country ${countryId} is connected`);
}

// Player card split: no city choice, a missing-city territory blocks both
// next-turn and direct completion, and the largest transferred city becomes capital.
{
  const { world, country, pixels, cities } = patchWorld(80, 50, [
    { column: 5, rank: 1 },
    { column: 1700, rank: 2 },
    { column: 3800, rank: 4 },
  ]);
  const card = drawSplitCard(world, country, 1000);
  assert.equal(card?.type, 'split');
  assert.equal(card?.choices, null);
  assert.equal('requiredCityId' in card, false);

  const game = new Game(world, 'country');
  game.focusCountryId = country.id;
  game.startCard(card);
  world.setOwner(pixels[900], card.newCountryId + 1);
  const year = game.getSnapshot().year;
  await game.nextTurn();
  assert.equal(game.card, card, 'the card stays active while its territory has no city');
  assert.equal(game.getSnapshot().year, year, 'an invalid split does not end the turn');
  assert.match(game.getSnapshot().message, /город/i, 'the blocked action explains the missing city');
  game.dispatchAction({ type: 'completeCard' });
  assert.equal(game.card, card, 'direct completion cannot bypass the common validation');
  world.setOwner(pixels[900], country.id + 1);

  assert.equal(canAssignSplitPixel(world, country.id, card.newCountryId, cities[0].pixel), false,
    'the original capital cannot be transferred');
  game.dispatchAction({
    type: 'line',
    ax: (cities[1].pixel % MAP_WIDTH) + 0.5,
    ay: Math.floor(cities[1].pixel / MAP_WIDTH) + 0.5,
    bx: (cities[2].pixel % MAP_WIDTH) + 0.5,
    by: Math.floor(cities[2].pixel / MAP_WIDTH) + 0.5,
    radius: 1,
  });
  game.dispatchAction({ type: 'endStroke' });
  game.dispatchAction({ type: 'completeCard' });
  const destination = world.countries[card.newCountryId];
  assert.equal(destination.pixels > 0, true);
  assert.equal(world.owner[cities[0].pixel], country.id + 1, 'the original capital stays in the source');
  assert.equal(cities[0].capital, true);
  assert.equal(cities[1].countryId, destination.id, 'the player can choose a city other than the card hint');
  assert.equal(cities[2].countryId, destination.id);
  assert.equal(cities[2].capital, true, 'the largest transferred city becomes the capital');
  assertConnected(world, destination.id);
  game.discard();
}

// The automatic country turn uses the same split card and shared validators.
{
  const { world, country, cities } = patchWorld(80, 50, [
    { column: 5, rank: 1 },
    { column: 1700, rank: 2 },
    { column: 3800, rank: 4 },
  ]);
  const card = drawSplitCard(world, country, 1000);
  const game = new Game(world, 'observer');
  game.resolveAutomatically(card);
  const destination = world.countries[card.newCountryId];
  assert.ok(destination.pixels > 0, 'automatic brush paints the new country');
  assert.equal(world.owner[cities[0].pixel], country.id + 1, 'automatic brush also preserves the source capital');
  assert.equal(cities[2].countryId, destination.id, 'automatic brush includes a city');
  assert.equal(cities[2].capital, true, 'automatic split assigns the largest city as capital');
  assert.equal(validateSplitTerritory(world, country.id, destination.id).valid, true);
  assertConnected(world, destination.id);
  game.discard();
}

function makePartitionFixture(role) {
  const fixture = patchWorld(60, 1, [
    { column: 5, rank: 1 },
    { column: 15, rank: 2 },
    { column: 30, rank: 4 },
    { column: 45, rank: 3 },
    { column: 55, rank: 2 },
  ]);
  const { world, country } = fixture;
  country.modifiers = ['partition'];
  country.government = 'hereditary';
  const deceased = country.ruler;
  const children = Array.from({ length: 4 }, (_, index) => {
    const child = createPerson(1000, 25, 900000 + index, [deceased.id], country.cultureId, country.religionId);
    child.countryId = country.id;
    world.people.push(child);
    return child;
  });
  const game = new Game(world, role);
  game.focusCountryId = country.id;
  return { ...fixture, game, deceased, children };
}

function deathCard(country, deceased, heir) {
  return {
    type: 'death',
    title: 'Смерть',
    detail: 'Тест наследственного разделения.',
    ink: 0,
    inkTotal: 0,
    targetCountryId: country.id,
    newCountryId: null,
    newCultureId: null,
    newReligionId: null,
    sourceCultureId: null,
    newGovernmentId: null,
    newRuler: null,
    choices: [{ label: heir.name, detail: 'Наследник', ruler: heir }],
    selectedChoice: 0,
    characterEvent: { kind: 'death', personIds: [deceased.id] },
    hint: -1,
  };
}

function paintInheritancePart(game, world, card, startPixel) {
  const centerX = startPixel % MAP_WIDTH;
  const y = Math.floor(startPixel / MAP_WIDTH);
  const rowPixels = [];
  for (let distance = 0; distance < 60; distance += 1) {
    for (const x of distance === 0 ? [centerX] : [centerX + distance, centerX - distance]) {
      if (x >= 0 && x < MAP_WIDTH) rowPixels.push(y * MAP_WIDTH + x);
    }
  }
  for (const pixel of rowPixels) {
    if (card.ink <= 0) break;
    paintAt(game, pixel);
  }
  assert.equal(card.ink, 0, 'the full inheritance quota was painted');
}

// A player-controlled succession opens a manual brush stage for each new state.
{
  const { world, country, cities, game, deceased, children } = makePartitionFixture('country');
  game.startCard(deathCard(country, deceased, children[0]));
  game.dispatchAction({ type: 'completeCard' });
  const initialYear = game.getSnapshot().year;
  await game.nextTurn();
  assert.equal(game.card?.type, 'split', 'inheritance starts a brush-based split card');
  assert.equal(game.card?.splitBatch?.destinationIds.length, 2, 'each detached inheritance part has its own stage');
  const firstCard = game.card;
  await game.nextTurn();
  assert.equal(game.card, firstCard, 'an empty inheritance part blocks turn completion');
  assert.match(game.getSnapshot().message, /территори|город/i);
  paintInheritancePart(game, world, firstCard, cities[1].pixel);
  await game.nextTurn();
  assert.equal(game.card?.type, 'split', 'the next heir receives a manual brush stage');
  assert.equal(game.card.splitBatch.nextIndex, 1);
  assert.equal(game.getSnapshot().year, initialYear, 'the year does not advance between heirs');

  const secondCard = game.card;
  await game.nextTurn();
  assert.equal(game.card, secondCard, 'the last heir also must paint a valid territory');
  paintInheritancePart(game, world, secondCard, cities[3].pixel);
  game.dispatchAction({ type: 'completeCard' });
  assert.equal(validateSplitPartition(world, country.id, secondCard.splitBatch.destinationIds, secondCard.splitBatch.quotas).valid, true);
  for (const id of secondCard.splitBatch.destinationIds) {
    const capital = world.cities.find((city) => city.countryId === id && city.capital);
    assert.ok(capital, 'every detached inheritance country has a capital city');
    assertConnected(world, id);
  }
  assert.equal(world.owner[cities[0].pixel], country.id + 1, 'the original capital remains with the source country');
  assert.equal(cities[0].capital, true);
  game.discard();
}

// AI inheritance uses the same transfer guard, quotas, connectivity, city checks,
// and largest-city capital rule without requiring a player interaction.
{
  const { world, country, cities, game, deceased, children } = makePartitionFixture('observer');
  country.ruler = children[0];
  children[0].formerRulerOf.push(country.id);
  const preferredCulture = world.newCulture(null, 1000);
  const preferredReligion = world.newReligion(1000);
  const cultureMix = world.cultureTable.single(preferredCulture.id, 100);
  const religionMix = world.religionTable.single(preferredReligion.id, 100);
  for (const child of children.slice(1)) {
    child.cultureId = preferredCulture.id;
    child.religionId = preferredReligion.id;
  }
  world.culture[cities[3].pixel + 1] = cultureMix;
  world.religion[cities[3].pixel + 1] = religionMix;
  game.partitionCountry(country, deceased, children[0]);
  const detached = world.countries.filter((item) => item.id !== country.id && item.parentId === country.id && item.pixels > 0);
  assert.equal(detached.length, 2, 'automatic inheritance creates the same number of heir countries');
  assert.equal(validateSplitPartition(world, country.id, detached.map((item) => item.id), detached.map((item) => item.pixels)).valid, true);
  for (const state of detached) {
    const stateCities = world.cities.filter((city) => city.countryId === state.id);
    assert.ok(stateCities.length > 0, 'every automatic heir territory contains a city');
    assert.equal(stateCities.filter((city) => city.capital).length, 1);
    assert.equal(stateCities.find((city) => city.capital).rank, Math.max(...stateCities.map((city) => city.rank)),
      'the largest city is the automatic capital');
    assertConnected(world, state.id);
  }
  const preferredNeighbor = cities[3].pixel + 1;
  assert.equal(world.owner[preferredNeighbor] - 1, world.owner[cities[3].pixel] - 1,
    'the heir whose city seeds the region receives the adjacent matching culture-and-faith tile first');
  assert.equal(world.owner[cities[0].pixel], country.id + 1);
  assert.equal(cities[0].capital, true);
  game.discard();
}

// An heir who co-rules an adjacent country keeps that country's land and
// city baseline; the common brush still allocates the unchanged source quota.
{
  const { world, country, pixels, cities } = patchWorld(40, 1, [
    { column: 2, rank: 1 },
    { column: 10, rank: 2 },
    { column: 25, rank: 4 },
  ]);
  country.modifiers = ['partition', 'seniority'];
  country.government = 'hereditary';
  const deceased = country.ruler;
  const children = Array.from({ length: 4 }, (_, index) => {
    const child = createPerson(1000, 25, 920000 + index, [deceased.id], country.cultureId, country.religionId);
    child.countryId = country.id;
    world.people.push(child);
    return child;
  });
  country.ruler = children[0];
  children[0].formerRulerOf.push(country.id);

  const homePixels = [];
  const x0 = pixels[0] % MAP_WIDTH;
  const y = Math.floor(pixels[0] / MAP_WIDTH);
  for (let x = x0 + 40; x < x0 + 46; x += 1) {
    const pixel = y * MAP_WIDTH + x;
    world.land[pixel] = 1;
    homePixels.push(pixel);
  }
  world.landIndex = Int32Array.from([...world.landIndex, ...homePixels]);
  const home = world.newCountry({
    rank: 'тест',
    cultureId: country.cultureId,
    religionId: country.religionId,
    density: 10,
    foundedYear: 0,
    parentId: null,
  });
  for (const pixel of homePixels) {
    world.setOwner(pixel, home.id + 1);
    world.culture[pixel] = world.cultureTable.single(country.cultureId, 100);
  }
  home.modifiers = ['consulate'];
  home.coRulerIds.push(children[1].id);
  const homeCity = world.addCity(home.id, homePixels[0], 1, true);

  const game = new Game(world, 'observer');
  game.partitionCountry(country, deceased, children[2]);
  const detached = world.countries.filter((item) => item.parentId === country.id && item.pixels > 0);
  assert.equal(detached.length, 2, JSON.stringify(game.getSnapshot().log));
  const homeHeirStateId = world.owner[homePixels[0]] - 1;
  assert.ok(detached.some((state) => state.id === homeHeirStateId), 'the heir keeps their existing country');
  assert.equal(homeCity.countryId, homeHeirStateId, 'the existing city remains in the heir state');
  assert.equal(world.countries[homeHeirStateId].pixels, 16, 'the heir receives the same 10 source tiles plus 6 existing tiles');
  assert.equal(validateSplitPartition(world, country.id, detached.map((state) => state.id), [10, 10], [6, 0]).valid, true);
  assert.equal(country.pixels, 20, 'the seniority quota for the original country remains unchanged');
  for (const state of detached) assertConnected(world, state.id);
  assert.equal(world.owner[cities[0].pixel], country.id + 1);
  game.discard();
}

// If an AI heir cannot receive its full connected quota, no territory or empty
// country is left partially committed.
{
  const { world, country, pixels, cities } = patchWorld(30, 1, [
    { column: 2, rank: 1 },
    { column: 28, rank: 2 },
  ]);
  country.modifiers = ['partition'];
  country.government = 'hereditary';
  const deceased = country.ruler;
  const children = Array.from({ length: 3 }, (_, index) => {
    const child = createPerson(1000, 25, 910000 + index, [deceased.id], country.cultureId, country.religionId);
    child.countryId = country.id;
    world.people.push(child);
    return child;
  });
  country.ruler = children[0];
  children[0].formerRulerOf.push(country.id);
  world.setOwner(pixels[20], 0);
  world.land[pixels[20]] = 0;
  const ownersBefore = pixels.map((pixel) => world.owner[pixel]);
  const game = new Game(world, 'observer');
  game.partitionCountry(country, deceased, children[0]);
  assert.equal(world.countries.length, 1, 'failed automatic partition discards every unused heir country');
  assert.deepEqual(pixels.map((pixel) => world.owner[pixel]), ownersBefore,
    'failed automatic partition restores every original source tile');
  assert.ok(game.getSnapshot().log[0].includes('отменено'), 'the failed partition is logged rather than silently applied');
  assert.equal(cities[0].countryId, country.id);
  game.discard();
}

// A failed automatic split also restores an heir's pre-existing country instead
// of discarding its land together with the temporary inheritance state.
{
  const { world, country, pixels, cities } = patchWorld(30, 1, [
    { column: 2, rank: 1 },
    { column: 28, rank: 2 },
  ]);
  country.modifiers = ['partition', 'seniority'];
  country.government = 'hereditary';
  const deceased = country.ruler;
  const children = Array.from({ length: 4 }, (_, index) => {
    const child = createPerson(1000, 25, 930000 + index, [deceased.id], country.cultureId, country.religionId);
    child.countryId = country.id;
    world.people.push(child);
    return child;
  });
  country.ruler = children[0];
  children[0].formerRulerOf.push(country.id);
  world.setOwner(pixels[20], 0);
  world.land[pixels[20]] = 0;
  const sourceOwners = pixels.map((pixel) => world.owner[pixel]);

  const x0 = pixels[0] % MAP_WIDTH;
  const y = Math.floor(pixels[0] / MAP_WIDTH);
  const homePixels = Array.from({ length: 6 }, (_, index) => y * MAP_WIDTH + x0 + 30 + index);
  for (const pixel of homePixels) world.land[pixel] = 1;
  world.landIndex = Int32Array.from([...world.landIndex, ...homePixels]);
  const home = world.newCountry({
    rank: 'тест',
    cultureId: country.cultureId,
    religionId: country.religionId,
    density: 10,
    foundedYear: 0,
    parentId: null,
  });
  for (const pixel of homePixels) world.setOwner(pixel, home.id + 1);
  home.modifiers = ['consulate'];
  home.coRulerIds.push(children[1].id);
  const homeCity = world.addCity(home.id, homePixels[0], 1, true);
  const countryCount = world.countries.length;
  const game = new Game(world, 'observer');
  game.partitionCountry(country, deceased, children[2]);
  assert.equal(world.countries.length, countryCount, 'failed partition removes its temporary heir countries');
  assert.deepEqual(pixels.map((pixel) => world.owner[pixel]), sourceOwners, 'all source tiles return to the source country');
  assert.ok(homePixels.every((pixel) => world.owner[pixel] === home.id + 1), 'all original home-country tiles are restored');
  assert.equal(home.pixels, 6);
  assert.equal(homeCity.countryId, home.id);
  assert.ok(game.getSnapshot().log[0].includes('отменено'), 'the impossible quota is reported');
  assert.equal(world.owner[cities[0].pixel], country.id + 1);
  game.discard();
}

// Shared end-state checks reject a cityless territory and disconnected islands.
{
  const { world, country, pixels, cities } = patchWorld(30, 1, [
    { column: 3, rank: 1 },
    { column: 15, rank: 2 },
  ]);
  const destination = world.newCountry({
    rank: 'тест',
    cultureId: country.cultureId,
    religionId: country.religionId,
    density: 10,
    foundedYear: 1000,
    parentId: country.id,
  });
  world.setOwner(pixels[10], destination.id + 1);
  assert.match(validateSplitTerritory(world, country.id, destination.id).reason, /город/i);
  world.setOwner(pixels[10], country.id + 1);
  world.setOwner(pixels[12], destination.id + 1);
  assert.equal(world.owner[cities[0].pixel], country.id + 1);
  assert.match(validateSplitTerritory(world, country.id, destination.id).reason, /город/i);
  world.setOwner(pixels[15], destination.id + 1);
  assert.match(validateSplitTerritory(world, country.id, destination.id).reason, /связн/i);
  assert.equal(canAssignSplitPixel(world, country.id, destination.id, cities[0].pixel), false);
}

console.log('Unified split-brush regressions passed.');
