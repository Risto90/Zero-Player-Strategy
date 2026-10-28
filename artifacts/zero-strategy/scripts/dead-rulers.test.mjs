import assert from 'node:assert/strict';
import { Game } from '../game/game.ts';
import { normalizePolitics } from '../game/characters.ts';
import { createFamilyId, createPerson, personDeathStatus } from '../game/government.ts';
import { countryCandidates, leadershipOptions, successionOrder } from '../game/succession.ts';
import { clearSaveBytes } from '../game/storage.ts';
import { World } from '../game/world.ts';
import { chronicleReference, isChronicleImportant } from '../game/chronicle.ts';

function makeFixture() {
  const world = World.create('random', 7721);
  const culture = world.newCulture(null, 1000);
  const country = world.newCountry({
    rank: 'тест',
    cultureId: culture.id,
    religionId: null,
    density: 80,
    foundedYear: 1000,
    parentId: null,
  });
  country.government = 'hereditary';
  country.modifiers = ['primogeniture', 'coRule'];
  const pixels = Array.from(world.landIndex.slice(0, 32));
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
  assert.ok(world.addCity(country.id, pixels[0], 1, true));
  return { world, country, pixels };
}

function addChild(world, country, parent, year = 1000) {
  const otherParent = createPerson(year, 30, createFamilyId(), [], country.cultureId, country.religionId);
  otherParent.countryId = country.id;
  world.people.push(otherParent);
  const child = createPerson(year, 25, parent.familyId, [parent.id, otherParent.id], country.cultureId, country.religionId);
  child.countryId = country.id;
  world.people.push(child);
  if (!country.dynastyClaims.includes(child.familyId)) country.dynastyClaims.push(child.familyId);
  return child;
}

function addChildFromOtherDynasty(world, country, parent, {
  countryId = country.id,
  age = 25,
  cultureId = country.cultureId,
  religionId = country.religionId,
} = {}) {
  const otherParent = createPerson(1000, 30, createFamilyId(), [], country.cultureId, country.religionId);
  otherParent.countryId = country.id;
  world.people.push(otherParent);
  const child = createPerson(1000, age, otherParent.familyId, [parent.id, otherParent.id],
    cultureId, religionId);
  child.countryId = countryId;
  world.people.push(child);
  return child;
}

function worldAddSecondCity(fixture) {
  const city = fixture.world.addCity(fixture.country.id, fixture.pixels[1], 1, false);
  assert.ok(city, 'the second city is added to the fixture country');
}

async function saveAndLoad(game) {
  await game.saveNow();
  const restored = await Game.load();
  assert.ok(restored, 'the in-progress game loads');
  return restored;
}

const previousPersist = Game.persist;
const previousPause = Game.pause;
Game.persist = true;
Game.pause = async () => {};
try {
  // Преемник сохраняет настоящее происхождение; должность и закон наследования
  // не переписывают familyId, чтобы подогнать его под династию прежнего правителя.
  {
    const fixture = makeFixture();
    const { world, country } = fixture;
    const parentA = createPerson(1000, 50, createFamilyId(), [], country.cultureId, country.religionId);
    const parentB = createPerson(1000, 48, createFamilyId(), [], country.cultureId, country.religionId);
    parentA.countryId = country.id;
    parentB.countryId = country.id;
    world.people.push(parentA, parentB);
    const heir = createPerson(1000, 20, parentB.familyId, [parentA.id, parentB.id],
      country.cultureId, country.religionId);
    heir.countryId = country.id;
    world.people.push(heir);
    country.heir = heir;
    const disconnectedRoot = createPerson(1000, 18, country.ruler.familyId, [],
      country.cultureId, country.religionId);
    disconnectedRoot.countryId = country.id;
    world.people.push(disconnectedRoot);

    normalizePolitics(world, 1000);

    const normalizedHeir = world.people.find((person) => person.id === heir.id);
    const normalizedParentB = world.people.find((person) => person.id === parentB.id);
    const normalizedRoot = world.people.find((person) => person.id === disconnectedRoot.id);
    assert.equal(country.heir?.id, heir.id, 'действительный наследник остаётся в данных о должностях');
    assert.equal(normalizedHeir?.familyId, normalizedParentB?.familyId,
      'нормализация сохраняет династию, унаследованную от одного из настоящих родителей');
    assert.notEqual(normalizedRoot?.familyId, country.ruler.familyId,
      'неродственные основатели не могут оставаться членами одной династии');
    assert.equal(normalizedRoot?.parents.length, 0,
      'нормализация не выдумывает родство, чтобы объединить несвязанные ветви');
  }

  // Новый запасной кандидат начинает собственную династию, а не получает
  // familyId прежнего правителя без родителей.
  {
    const fixture = makeFixture();
    const { world, country } = fixture;
    country.government = 'tribal';
    country.modifiers = ['partition'];
    worldAddSecondCity(fixture);
    addChild(world, country, country.ruler);
    addChild(world, country, country.ruler);
    const knownIds = new Set(world.people.map((p) => p.id));
    const options = leadershipOptions(world, country, 1000, country.ruler);
    assert.equal(options.length, 2, 'наследование по-прежнему предлагает двух кандидатов');
    const generated = options.find((candidate) => !knownIds.has(candidate.id));
    if (generated) {
      assert.deepEqual(generated.parents, [], 'новому кандидату не приписывают выдуманных родителей');
      assert.notEqual(generated.familyId, country.ruler.familyId,
        'новый кандидат начинает династию вместо притворства родственником правителя');
    } else {
      assert.equal(new Set(options.map((candidate) => candidate.id)).size, 2,
        'existing demographic matches replace generated candidates without duplicating an option');
    }
  }

  // Племенной пул определяется прямым родством с нынешними и прежними правителями,
  // а не совпадением династии; обычные ограничения возраста, пола и проживания сохраняются.
  {
    const fixture = makeFixture();
    const { world, country } = fixture;
    country.government = 'tribal';
    country.modifiers = ['ethnic', 'theocracy', 'matriarchal'];

    const differentCulture = world.newCulture(null, 1000);
    const currentRulerChild = addChildFromOtherDynasty(world, country, country.ruler, {
      cultureId: differentCulture.id,
    });
    currentRulerChild.gender = 'female';
    assert.notEqual(currentRulerChild.familyId, country.ruler.familyId,
      'ребёнок наследует династию другого родителя');
    assert.ok(!country.dynastyClaims.includes(currentRulerChild.familyId),
      'династия ребёнка не заявлена страной');

    const formerRuler = createPerson(1000, 40, createFamilyId(), [], country.cultureId, country.religionId);
    formerRuler.countryId = country.id;
    formerRuler.formerRulerOf.push(country.id);
    world.people.push(formerRuler);
    const formerRulerChild = addChildFromOtherDynasty(world, country, formerRuler);
    country.previousRulerIds = [];

    const claimedDynastyStranger = createPerson(1000, 25, country.ruler.familyId, [],
      country.cultureId, country.religionId);
    claimedDynastyStranger.countryId = country.id;
    world.people.push(claimedDynastyStranger);

    const underageChild = addChildFromOtherDynasty(world, country, country.ruler, { age: 11 });
    const wrongGenderChild = addChildFromOtherDynasty(world, country, country.ruler);
    wrongGenderChild.gender = 'male';
    const outOfCountryChild = addChildFromOtherDynasty(world, country, country.ruler, { countryId: country.id + 1 });

    const candidates = countryCandidates(world, country);
    const candidateIds = candidates.map(({ person: candidate }) => candidate.id);
    assert.ok(candidateIds.includes(currentRulerChild.id),
      'ребёнок действующего правителя с династией другого родителя учитывается при культурных и религиозных модификаторах');
    assert.ok(candidateIds.includes(formerRulerChild.id),
      'ребёнок прежнего правителя найден по истории правителей');
    assert.ok(!candidateIds.includes(claimedDynastyStranger.id),
      'одно совпадение с династией не делает чужого персонажа племенным кандидатом');
    assert.ok(!candidateIds.includes(underageChild.id), 'минимальный возраст племенного кандидата сохраняется');
    assert.ok(!candidateIds.includes(wrongGenderChild.id), 'ограничение по полу сохраняется');
    assert.ok(!candidateIds.includes(outOfCountryChild.id), 'действующее ограничение по проживанию сохраняется');
    assert.equal(new Set(candidateIds).size, candidateIds.length, 'в списке кандидатов нет повторов');
    assert.ok(successionOrder(world, country).some(({ id }) => id === currentRulerChild.id),
      'прямой ребёнок включён в список преемства');
    const tribalChildIds = new Set([currentRulerChild.id, formerRulerChild.id]);
    assert.ok(leadershipOptions(world, country, 1000).some(({ id }) => tribalChildIds.has(id)),
      'ребёнок с династией другого родителя может быть предложен для передачи власти');
  }

  // Совпадение династии не отменяет наследственные правила родословной.
  {
    const fixture = makeFixture();
    const { world, country } = fixture;
    country.government = 'hereditary';
    country.modifiers = ['primogeniture'];
    const unrelatedClaimant = createPerson(1000, 25, country.ruler.familyId, [],
      country.cultureId, country.religionId);
    unrelatedClaimant.countryId = country.id;
    world.people.push(unrelatedClaimant);
    assert.ok(!successionOrder(world, country).some(({ id }) => id === unrelatedClaimant.id),
      'чужой персонаж с заявленной династией не включается в наследственное преемство');
  }

  // После смерти правителя должность переходит подходящему потомку, а запись о смерти сохраняется.
  const deathFixture = makeFixture();
  const ruler = deathFixture.country.ruler;
  const heir = addChild(deathFixture.world, deathFixture.country, ruler);
  const deathGame = new Game(deathFixture.world, 'all');
  deathGame.applyCharacterEvent(deathFixture.country, { kind: 'death', personIds: [ruler.id] }, null);
  assert.equal(deathFixture.country.ruler.id, heir.id, 'the eligible descendant succeeds the dead ruler');
  assert.equal(ruler.alive, false, 'succession preserves the ruler death');
  assert.equal(personDeathStatus(ruler), `умер${ruler.gender === 'female' ? 'ла' : ''} в 1000 году`,
    'the deceased ruler biography retains the year');
  // Фактическая передача власти после смерти использует ту же линию порнократии.
  {
    const pornocracyFixture = makeFixture();
    const { world, country } = pornocracyFixture;
    country.modifiers = ['primogeniture', 'pornocracy'];
    const formerRuler = country.ruler;
    const firstHeir = addChild(world, country, formerRuler);
    addChild(world, country, formerRuler);
    formerRuler.spouseIds.push(firstHeir.id);
    firstHeir.spouseIds.push(formerRuler.id);
    const expectedSuccessor = successionOrder(world, country, formerRuler)[0];
    assert.ok(expectedSuccessor, 'перед смертью правителя линия содержит допустимого преемника');
    assert.notEqual(expectedSuccessor.id, formerRuler.id, 'правитель не включён в собственную линию наследования');
    const game = new Game(world, 'all');
    game.applyCharacterEvent(country, { kind: 'death', personIds: [formerRuler.id] }, null);
    assert.equal(country.ruler.id, expectedSuccessor.id,
      'после смерти назначается первый допустимый преемник из той же линии');
  }
  const deathEntry = deathGame.log.find(({ text }) => text.includes(ruler.name) && text.includes('умер'));
  assert.ok(deathEntry, 'the ruler death is present in the chronicle');
   assert.equal(isChronicleImportant(deathEntry, chronicleReference('person', ruler.id)), true,
     'death is important in the deceased person profile');
   assert.equal(isChronicleImportant(deathEntry, chronicleReference('person', heir.id)), true,
     'the successor is marked important for taking the office');
   assert.equal(isChronicleImportant(deathEntry, chronicleReference('country', deathFixture.country.id)), false,
     'a person death is not marked important in the country profile');
  assert.ok(deathEntry.objects.some(({ type, id }) => type === 'person' && id === ruler.id),
    'a death record links to the typed person profile');
  assert.ok(deathEntry.objects.some(({ type, id }) => type === 'person' && id === heir.id),
    'a succession record links to the new office holder');

  // Умерший соправитель заменяется, а живой основной правитель сохраняет должность.
  const coFixture = makeFixture();
  const primary = coFixture.country.ruler;
  const coRuler = createPerson(1000, 30, primary.familyId, [], coFixture.country.cultureId, null);
  coRuler.countryId = coFixture.country.id;
  coFixture.world.people.push(coRuler);
  coFixture.country.coRulerIds = [coRuler.id];
  const coSuccessor = addChild(coFixture.world, coFixture.country, coRuler);
  const coGame = new Game(coFixture.world, 'all');
  coGame.applyCharacterEvent(coFixture.country, { kind: 'death', personIds: [coRuler.id] }, null);
  assert.equal(coFixture.country.ruler.id, primary.id, 'the living primary ruler is unchanged');
  assert.equal(coFixture.country.coRulerIds[0], coSuccessor.id, 'the eligible descendant succeeds the dead co-ruler');
  assert.equal(coRuler.alive, false, 'the co-ruler death remains in the record');

  // Если у формы правления нет подходящего кандидата, используется прежний запасной вариант с новым персонажем.
  const fallbackFixture = makeFixture();
  const deceased = fallbackFixture.country.ruler;
  fallbackFixture.country.government = 'republic';
  fallbackFixture.country.modifiers = [];
  const fallbackGame = new Game(fallbackFixture.world, 'all');
  fallbackGame.applyCharacterEvent(fallbackFixture.country, { kind: 'death', personIds: [deceased.id] }, null);
  assert.notEqual(fallbackFixture.country.ruler.id, deceased.id, 'the fallback replaces a deceased ruler');
  assert.equal(fallbackFixture.country.ruler.alive, true, 'the fallback leader is alive');

  // Загрузка несогласованного сохранения исправляет должности умерших персонажей и сохраняет историю.
  await clearSaveBytes();
  const staleFixture = makeFixture();
  const oldRuler = staleFixture.country.ruler;
  addChild(staleFixture.world, staleFixture.country, oldRuler);
  const oldCoRuler = createPerson(1000, 30, oldRuler.familyId, [], staleFixture.country.cultureId, null);
  oldCoRuler.countryId = staleFixture.country.id;
  staleFixture.world.people.push(oldCoRuler);
  addChild(staleFixture.world, staleFixture.country, oldCoRuler);
  staleFixture.country.coRulerIds = [oldCoRuler.id];
  const oldNomadRuler = createPerson(1000, 35, createFamilyId(), [], staleFixture.country.cultureId, null);
  oldNomadRuler.countryId = staleFixture.country.id;
  staleFixture.world.people.push(oldNomadRuler);
  const nomadHeir = addChild(staleFixture.world, staleFixture.country, oldNomadRuler);
  const nomad = staleFixture.world.newCountry({
    rank: 'кочевье',
    cultureId: staleFixture.country.cultureId,
    religionId: null,
    density: 80,
    foundedYear: 1000,
    parentId: staleFixture.country.id,
  });
  nomad.type = 'nomadic';
  nomad.government = 'tribal';
  nomad.modifiers = ['oligarchy'];
  nomad.ruler = oldNomadRuler;
  nomad.heir = null;
  nomad.previousRulerIds = [];
  nomad.dynastyClaims = [oldNomadRuler.familyId];
  nomad.coRulerIds = [];
  nomad.cells = [{
    pixel: staleFixture.pixels[1],
    population: 80,
    cultureMix: staleFixture.world.cultureTable.single(staleFixture.country.cultureId, 100),
    religionMix: 0,
  }];
  nomad.range = [staleFixture.pixels[1]];
  nomad.sourceCountryId = staleFixture.country.id;
  nomad.pixels = 0;
  oldNomadRuler.countryId = nomad.id;
  nomadHeir.countryId = nomad.id;
  const expectedRuler = successionOrder(staleFixture.world, staleFixture.country, oldRuler)[0];
  const expectedCoRuler = successionOrder(staleFixture.world, staleFixture.country, oldCoRuler)[0];
  oldRuler.alive = false;
  oldRuler.deathYear = 997;
  oldRuler.deathReason = 'старость';
  oldCoRuler.alive = false;
  oldCoRuler.deathYear = 998;
  oldCoRuler.deathReason = 'болезнь';
  oldNomadRuler.alive = false;
  oldNomadRuler.deathYear = 996;
  oldNomadRuler.deathReason = 'старость';
  const staleGame = new Game(staleFixture.world, 'all');
  const restored = await saveAndLoad(staleGame);
  const restoredCountry = restored.world.countries[staleFixture.country.id];
  assert.ok(expectedRuler, 'the fixture has an eligible successor for the main ruler');
  assert.ok(expectedCoRuler, 'the fixture has an eligible successor for the co-ruler');
  assert.equal(restoredCountry.ruler.id, expectedRuler.id, 'load restores the main ruler using succession');
  assert.equal(restoredCountry.coRulerIds[0], expectedCoRuler.id, 'load restores the co-ruler using succession');
  assert.equal(restored.world.countries[nomad.id].ruler.id, nomadHeir.id, 'load restores a dead nomadic-country ruler using succession');
  const restoredDead = restored.world.people.find((person) => person.id === oldRuler.id);
  assert.equal(restoredDead.alive, false, 'load does not revive the deceased ruler');
  assert.equal(restoredDead.deathYear, 997, 'load preserves the death year');
  assert.equal(personDeathStatus(restoredDead),
    `умер${restoredDead.gender === 'female' ? 'ла' : ''} в 997 году`,
    'the death biography remains available after load');
  const restoredDeadNomadRuler = restored.world.people.find((person) => person.id === oldNomadRuler.id);
  assert.equal(restoredDeadNomadRuler.alive, false, 'nomad load does not revive the deceased ruler');
  assert.equal(restoredDeadNomadRuler.deathYear, 996, 'nomad load preserves the death year');

  // При восстановлении сохранения действующий живой правитель не меняется.
  await clearSaveBytes();
  const livingFixture = makeFixture();
  const livingRulerId = livingFixture.country.ruler.id;
  const livingGame = new Game(livingFixture.world, 'all');
  const livingRestored = await saveAndLoad(livingGame);
  assert.equal(livingRestored.world.countries[livingFixture.country.id].ruler.id, livingRulerId,
    'load keeps an ordinary living ruler unchanged');
} finally {
  await clearSaveBytes();
  Game.persist = previousPersist;
  Game.pause = previousPause;
}

console.log('Dead ruler and save recovery regressions passed.');
