import assert from 'node:assert/strict';
import { Game } from '../game/game.ts';
import { mulberry32 } from '../game/random.ts';
import { forEachNeighbour } from '../game/geography.ts';
import { marry, newCitizen, registerPerson } from '../game/characters.ts';
import { World } from '../game/world.ts';

function withSeed(seed, callback) {
  const previousRandom = Math.random;
  Math.random = mulberry32(seed);
  try {
    return callback();
  } finally {
    Math.random = previousRandom;
  }
}

function fixture() {
  return withSeed(91027, () => {
    const world = World.create('random', 7721);
    let pixels = [];
    for (const start of world.landIndex) {
      const seen = new Set([start]);
      const queue = [start];
      for (let head = 0; head < queue.length && queue.length < 48; head += 1) {
        forEachNeighbour(queue[head], (next) => {
          if (world.land[next] && !seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        });
      }
      if (queue.length >= 24) {
        pixels = queue;
        break;
      }
    }
    assert.ok(pixels.length >= 24, 'the fixed map seed has a connected land fixture');

    const culture = world.newCulture(null, 1000);
    const country = world.newCountry({
      rank: 'тест',
      cultureId: culture.id,
      religionId: null,
      density: 80,
      foundedYear: 1000,
      parentId: null,
    });
    const cultureMix = world.cultureTable.single(culture.id, 100);
    for (const pixel of pixels) {
      world.setOwner(pixel, country.id + 1);
      world.density[pixel] = 80;
      world.humidity[pixel] = 50;
      world.temperature[pixel] = 50;
      world.drainage[pixel] = 50;
      world.culture[pixel] = cultureMix;
    }
    world.recountCountries();
    const cities = [0, 4, 8, 12].map((offset, index) =>
      world.addCity(country.id, pixels[offset], 1, index === 0),
    );
    assert.ok(cities.every(Boolean), 'the fixture contains four cities');
    return { world, country, culture, pixels, cities };
  });
}

function cloneFixture(source) {
  const clone = new World(source.world.mapKind, source.world.seed, source.world.land, {
    humidity: source.world.humidity.slice(),
    temperature: source.world.temperature.slice(),
    drainage: source.world.drainage.slice(),
  });
  clone.owner.set(source.world.owner);
  clone.density.set(source.world.density);
  clone.culture.set(source.world.culture);
  clone.religion.set(source.world.religion);
  for (const entry of source.world.cultureTable.entries.slice(1)) {
    clone.cultureTable.intern(new Map(entry.ids.map((id, index) => [id, entry.shares[index]])));
  }
  for (const entry of source.world.religionTable.entries.slice(1)) {
    clone.religionTable.intern(new Map(entry.ids.map((id, index) => [id, entry.shares[index]])));
  }
  const entities = structuredClone({
    countries: source.world.countries,
    cities: source.world.cities,
    cultures: source.world.cultures,
    religions: source.world.religions,
    people: source.world.people,
    nomads: source.world.nomads,
  });
  Object.assign(clone, entities);
  clone.version = source.world.version;
  clone.nomadVersion = source.world.nomadVersion;
  for (const city of clone.cities) clone.cityIdAt[city.pixel] = city.id;
  clone.recountCountries();
  return {
    world: clone,
    country: clone.countries[source.country.id],
    culture: clone.cultures[source.culture.id],
    pixels: source.pixels,
    cities: source.cities.map((city) => clone.cities[city.id]),
  };
}

function card(type, updates = {}) {
  return {
    type,
    title: type,
    detail: type,
    ink: 12,
    inkTotal: 12,
    targetCountryId: null,
    targetNomadId: null,
    newCountryId: null,
    newCultureId: null,
    newReligionId: null,
    sourceCultureId: null,
    newGovernmentId: null,
    newRuler: null,
    choices: null,
    selectedChoice: 0,
    characterEvent: null,
    hint: -1,
    ...updates,
  };
}

let nextScenarioSeed = 120000;
function scenario(name, createCard) {
  const first = fixture();
  const card = withSeed(nextScenarioSeed++, () => createCard(first));
  const second = cloneFixture(first);
  return {
    name,
    card,
    mirrorCard: structuredClone(card),
    first,
    second,
  };
}

function worldState(world) {
  const rasterNames = ['owner', 'density', 'humidity', 'temperature', 'drainage', 'culture', 'religion'];
  const rasters = Object.fromEntries(rasterNames.map((name) => [
    name,
    Buffer.from(world[name].buffer, world[name].byteOffset, world[name].byteLength),
  ]));
  const personIds = new Map(world.people.map((person, index) => [person.id, `person-${index}`]));
  const familyIds = new Map();
  const familyKey = (id) => {
    if (!familyIds.has(id)) familyIds.set(id, `family-${familyIds.size}`);
    return familyIds.get(id);
  };
  const normalizePerson = (person) => person && ({
    ...person,
    id: personIds.get(person.id) ?? 'missing-person',
    familyId: familyKey(person.familyId),
    parents: person.parents.map((id) => personIds.get(id) ?? 'missing-person'),
    spouseIds: person.spouseIds.map((id) => personIds.get(id) ?? 'missing-person'),
    loverIds: person.loverIds.map((id) => personIds.get(id) ?? 'missing-person'),
    friendIds: person.friendIds.map((id) => personIds.get(id) ?? 'missing-person'),
  });
  const normalizePolitical = (political) => ({
    ...political,
    ruler: normalizePerson(political.ruler),
    heir: normalizePerson(political.heir),
    previousRulerIds: political.previousRulerIds.map((id) => personIds.get(id) ?? 'missing-person'),
    dynastyClaims: political.dynastyClaims.map((id) => personIds.get(id) ?? 'missing-person'),
    coRulerIds: political.coRulerIds.map((id) => personIds.get(id) ?? 'missing-person'),
    barredRulerIds: political.barredRulerIds.map((id) => personIds.get(id) ?? 'missing-person'),
    pendingDeathIds: political.pendingDeathIds.map((id) => personIds.get(id) ?? 'missing-person'),
    seatSince: Object.fromEntries(Object.entries(political.seatSince).map(([id, year]) => [
      personIds.get(Number(id)) ?? 'missing-person',
      year,
    ])),
    termCounts: Object.fromEntries(Object.entries(political.termCounts).map(([id, count]) => [
      personIds.get(Number(id)) ?? 'missing-person',
      count,
    ])),
  });
  return {
    rasters,
    countries: world.countries.map(normalizePolitical),
    cities: world.cities,
    cultures: world.cultures,
    religions: world.religions,
    people: world.people.map(normalizePerson),
    nomads: world.nomads.map(normalizePolitical),
    version: world.version,
    nomadVersion: world.nomadVersion,
  };
}

function sameWorld(first, second, message) {
  const left = worldState(first);
  const right = worldState(second);
  for (const name of Object.keys(left.rasters)) {
    assert.deepEqual(left.rasters[name], right.rasters[name], `${message}: ${name} raster`);
  }
  assert.deepEqual({ ...left, rasters: undefined }, { ...right, rasters: undefined }, `${message}: entities and counters`);
}

function recordAutomaticActions(game, card, randomSeed) {
  const actions = [];
  const originalDispatch = game.dispatchAction.bind(game);
  let randomCalls = 0;
  let lastDispatchRandomCalls = 0;
  let dispatchDepth = 0;
  const previousRandom = Math.random;
  const rng = mulberry32(randomSeed);
  Math.random = () => {
    randomCalls += 1;
    return rng();
  };
  game.dispatchAction = (action) => {
    const outermost = dispatchDepth === 0;
    const before = randomCalls;
    const entry = {
      action: structuredClone(action),
      randomCallsBefore: before - lastDispatchRandomCalls,
    };
    dispatchDepth += 1;
    try {
      return originalDispatch(action);
    } finally {
      dispatchDepth -= 1;
      if (outermost) {
        actions.push(entry);
        lastDispatchRandomCalls = randomCalls;
      }
    }
  };
  try {
    game.resolveAutomatically(card);
    return actions;
  } finally {
    Math.random = previousRandom;
  }
}

function replayAsPlayer(game, card, actions, randomSeed) {
  const previousRandom = Math.random;
  const rng = mulberry32(randomSeed);
  Math.random = () => rng();
  try {
    game.card = card;
    const setupActions = [];
    let firstNonChoice = 0;
    while (firstNonChoice < actions.length && actions[firstNonChoice].action.type === 'selectChoice') {
      setupActions.push(actions[firstNonChoice]);
      firstNonChoice += 1;
    }
    for (const entry of setupActions) {
      for (let i = 0; i < entry.randomCallsBefore; i += 1) Math.random();
      game.dispatchAction(entry.action);
    }
    game.startCard(card);
    for (const entry of actions.slice(firstNonChoice)) {
      for (let i = 0; i < entry.randomCallsBefore; i += 1) Math.random();
      game.dispatchAction(entry.action);
    }
  } finally {
    Math.random = previousRandom;
  }
}

const cases = [
  scenario('create', ({ world, country, culture }) => {
    const foundedCulture = world.newCulture(culture, 1000);
    const founded = world.newCountry({
      rank: 'тест',
      cultureId: foundedCulture.id,
      religionId: null,
      density: 80,
      foundedYear: 1000,
      parentId: country.id,
    });
    return card('create', {
      newCountryId: founded.id,
      newCultureId: foundedCulture.id,
      hint: -1,
      ink: 0,
      inkTotal: 0,
    });
  }),
  scenario('expand', ({ country }) => card('expand', {
    targetCountryId: country.id,
    hint: -1,
    ink: 0,
    inkTotal: 0,
  })),
  scenario('colonization', ({ country }) => card('colonization', {
    targetCountryId: country.id,
    hint: -1,
    ink: 0,
    inkTotal: 0,
  })),
  scenario('split', ({ world, country, cities }) => {
    const founded = world.newCountry({
      rank: 'тест',
      cultureId: country.cultureId,
      religionId: country.religionId,
      density: country.density,
      foundedYear: 1000,
      parentId: country.id,
    });
    return card('split', {
      targetCountryId: country.id,
      newCountryId: founded.id,
      hint: cities[1].pixel,
      ink: 0,
      inkTotal: 0,
      choices: null,
    });
  }),
  ...['drought', 'rain', 'desertification', 'swamping', 'warmCurrent', 'coldCurrent', 'warmWind', 'coldWind']
    .map((type) => scenario(type, ({ country, pixels }) => card(type, {
      targetCountryId: type.includes('Current') ? null : country.id,
      hint: pixels[0],
    }))),
  scenario('faith', ({ world, country, pixels }) => {
    const religion = world.newReligion(1000);
    return card('faith', {
      targetCountryId: country.id,
      newReligionId: religion.id,
      hint: pixels[0],
    });
  }),
  scenario('culture', ({ world, country, culture, pixels }) => {
    const branch = world.newCulture(culture, 1000);
    return card('culture', {
      targetCountryId: country.id,
      newCultureId: branch.id,
      sourceCultureId: culture.id,
      hint: pixels[0],
    });
  }),
  scenario('buildCity', ({ country, pixels }) => card('buildCity', {
    targetCountryId: country.id,
    hint: pixels[2],
    ink: 0,
    inkTotal: 0,
  })),
  scenario('upgradeCity', ({ country, cities }) => card('upgradeCity', {
    targetCountryId: country.id,
    hint: -1,
    ink: 0,
    inkTotal: 0,
    choices: [cities[2], cities[3]].map((city, index) => ({
      label: `Город ${index}`,
      detail: `Город ${index}`,
      cityId: city.id,
    })),
  })),
  scenario('government', ({ country }) => card('government', {
    targetCountryId: country.id,
    hint: -1,
    ink: 0,
    inkTotal: 0,
    choices: [{ label: 'Республика', detail: 'Республика', government: 'republic' }],
  })),
  scenario('moveCapital', ({ country, cities }) => card('moveCapital', {
    targetCountryId: country.id,
    hint: -1,
    ink: 0,
    inkTotal: 0,
    choices: [{ label: 'Новая столица', detail: 'Новая столица', cityId: cities[2].id }],
  })),
  scenario('nomadExpand', ({ world, country, pixels }) => {
    world.nomads.push({
      ...structuredClone(country),
      id: 0,
      name: 'Тестовое кочевье',
      cells: [{ pixel: pixels[0], population: 80, cultureMix: world.culture[pixels[0]], religionMix: 0 }],
      range: [pixels[0]],
      sourceCountryId: country.id,
      pixels: 1,
    });
    return card('nomadExpand', {
      targetNomadId: 0,
      hint: -1,
      ink: 0,
      inkTotal: 0,
    });
  }),
  ...['succession', 'election'].map((type) => scenario(type, ({ country }) => card(type, {
    targetCountryId: country.id,
    hint: -1,
    ink: 0,
    inkTotal: 0,
    choices: [{
      label: 'Действующий правитель',
      detail: 'Действующий правитель',
      ruler: country.ruler,
      seatId: country.ruler.id,
    }],
  }))),
  scenario('marriage', ({ world, country }) => {
    const partner = registerPerson(world, country, newCitizen(world, country, 1000));
    return card('marriage', {
      targetCountryId: country.id,
      hint: -1,
      ink: 0,
      inkTotal: 0,
      characterEvent: { kind: 'marriage', personIds: [country.ruler.id, partner.id] },
    });
  }),
  scenario('birth', ({ world, country }) => {
    const mother = registerPerson(world, country, newCitizen(world, country, 1000));
    const father = registerPerson(world, country, newCitizen(world, country, 1000));
    mother.gender = 'female';
    father.gender = 'male';
    marry(world, country, mother, father);
    return card('birth', {
      targetCountryId: country.id,
      hint: -1,
      ink: 0,
      inkTotal: 0,
      characterEvent: { kind: 'birth', personIds: [mother.id, father.id] },
    });
  }),
  scenario('death', ({ world, country }) => {
    const person = registerPerson(world, country, newCitizen(world, country, 1000));
    return card('death', {
      targetCountryId: country.id,
      hint: -1,
      ink: 0,
      inkTotal: 0,
      characterEvent: { kind: 'death', personIds: [person.id] },
    });
  }),
  scenario('character', ({ world, country }) => {
    const friend = registerPerson(world, country, newCitizen(world, country, 1000));
    return card('character', {
      targetCountryId: country.id,
      hint: -1,
      ink: 0,
      inkTotal: 0,
      characterEvent: { kind: 'friendship', personIds: [country.ruler.id, friend.id] },
    });
  }),
  scenario('revolt', ({ country }) => card('revolt', {
    targetCountryId: country.id,
    hint: -1,
    ink: 0,
    inkTotal: 0,
    choices: [{
      label: 'Переворот',
      detail: 'Переворот',
      government: 'republic',
      violent: true,
      ruler: country.ruler,
    }],
  })),
  scenario('union', ({ world, country, pixels, culture }) => {
    const incoming = world.newCountry({
      rank: 'тест',
      cultureId: culture.id,
      religionId: null,
      density: 80,
      foundedYear: 1000,
      parentId: country.id,
    });
    let incomingPixel = -1;
    for (const pixel of pixels) {
      forEachNeighbour(pixel, (next) => {
        if (incomingPixel < 0 && world.land[next] && world.owner[next] === 0) incomingPixel = next;
      });
      if (incomingPixel >= 0) break;
    }
    assert.ok(incomingPixel >= 0, 'the fixture has an adjacent land point for a neighboring country');
    world.setOwner(incomingPixel, incoming.id + 1);
    world.density[incomingPixel] = 80;
    world.culture[incomingPixel] = world.cultureTable.single(culture.id, 100);
    world.recountCountries();
    world.addCity(incoming.id, incomingPixel, 1, true);
    return card('union', {
      targetCountryId: country.id,
      newCountryId: incoming.id,
      hint: -1,
      ink: 0,
      inkTotal: 0,
    });
  }),
];

for (const [index, testCase] of cases.entries()) {
  const seed = 620000 + index;
  const automatic = new Game(testCase.first.world, 'observer');
  const manual = new Game(testCase.second.world, 'all');
  try {
    const trace = recordAutomaticActions(automatic, testCase.card, seed);
    replayAsPlayer(manual, testCase.mirrorCard, trace, seed);
    sameWorld(testCase.first.world, testCase.second.world, testCase.name);
    assert.deepEqual(automatic.log, manual.log, `${testCase.name}: event log`);
    assert.equal(testCase.card.ink, testCase.mirrorCard.ink, `${testCase.name}: ink spent`);
    assert.equal(testCase.card.selectedChoice, testCase.mirrorCard.selectedChoice,
      `${testCase.name}: selected option`);
    assert.equal(testCase.card.cityPlaced, testCase.mirrorCard.cityPlaced,
      `${testCase.name}: city placement state`);
  } finally {
    automatic.discard();
    manual.discard();
  }
}

console.log(`Action parity passed for ${cases.length} deterministic scenarios.`);
