import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { countryCharacters, normalizePolitics } from '../game/characters.ts';
import { availableModifiers, createFamilyId, createPerson, MODIFIERS } from '../game/government.ts';
import { applyReform, reformCandidates } from '../game/politics.ts';
import { demography } from '../game/demography.ts';
import { appoint, candidateAllowed, candidateWeight, countryCandidates, countryRulerHistory, ensureOffices, hasFixedHeir, leadershipOptions, refreshHeirs, successionOrder } from '../game/succession.ts';
import { World } from '../game/world.ts';

function fixture(seed = 10201) {
  const world = World.create('random', seed);
  const culture = world.newCulture(null, 1000);
  const country = world.newCountry({
    rank: 'тест',
    cultureId: culture.id,
    religionId: null,
    density: 80,
    foundedYear: 1000,
    parentId: null,
  });
  const pixel = world.landIndex[0];
  world.setOwner(pixel, country.id + 1);
  world.density[pixel] = 80;
  world.culture[pixel] = world.cultureTable.single(culture.id, 100);
  world.religion[pixel] = 0;
  world.recountCountries();
  return { world, country, culture, pixel };
}

function addPerson(world, country, { age = 30, familyId = createFamilyId(), parents = [], cultureId = country.cultureId, religionId = null, gender = 'male', countryId = country.id } = {}) {
  const p = createPerson(1000, age, familyId, parents, cultureId, religionId);
  p.age = age;
  p.bornAt = 1000 - age;
  p.gender = gender;
  p.countryId = countryId;
  world.people.push(p);
  return p;
}

function addChild(world, country, parent, options = {}) {
  const partner = addPerson(world, country, { age: 30, gender: parent.gender === 'male' ? 'female' : 'male' });
  const child = addPerson(world, country, {
    age: options.age ?? 25,
    familyId: parent.familyId,
    parents: [parent.id, partner.id],
    ...options,
  });
  if (!country.dynastyClaims.includes(child.familyId)) country.dynastyClaims.push(child.familyId);
  return { child, partner };
}

// Every living person is shown only in their current country of residence, including nomads.
{
  const { world, country } = fixture(10211);
  country.type = 'nomadic';
  country.range = [0];
  const resident = addPerson(world, country);
  const abroad = addPerson(world, country, { countryId: country.id + 1 });
  const dead = addPerson(world, country);
  dead.alive = false;
  const people = countryCharacters(world, country);
  assert.ok(people.some((p) => p.id === resident.id), 'a nomadic resident appears in the country roster');
  assert.ok(!people.some((p) => p.id === abroad.id), 'a character living in another country is excluded');
  assert.ok(!people.some((p) => p.id === dead.id), 'dead characters are excluded from the living roster');
}

// Republican oligarchy grants a twofold election weight, not an inheritance claim.
{
  const { world, country } = fixture(10212);
  country.government = 'republic';
  country.modifiers = ['oligarchy'];
  country.termCounts[country.ruler.id] = 1;
  const { child } = addChild(world, country, country.ruler);
  const peer = addPerson(world, country, { age: 25 });
  country.ruler.formerRulerOf = [country.id];
  const candidate = countryCandidates(world, country).find((entry) => entry.person.id === child.id);
  assert.ok(candidate, 'a past ruler’s eligible child can stand in the republic');
  assert.equal(candidate.expectedHeir, false, 'an election bonus never becomes an inheritance right');
  const peerCandidate = countryCandidates(world, country).find((entry) => entry.person.id === peer.id);
  assert.equal(candidate.weight, peerCandidate.weight * 2, 'oligarchy doubles the candidate’s weight relative to an equal-age peer');
  assert.match(candidate.advantages.join(' '), /вес выбора ×2/u);
  assert.deepEqual(successionOrder(world, country), [], 'republics have no succession line');
}

// Republican pornocracy doubles eligible resident partners' election weight without creating heirs.
{
  const { world, country } = fixture(10213);
  country.government = 'republic';
  country.modifiers = ['pornocracy'];
  country.termCounts[country.ruler.id] = 1;
  const spouse = addPerson(world, country, { gender: country.ruler.gender === 'male' ? 'female' : 'male' });
  country.ruler.spouseIds.push(spouse.id);
  spouse.spouseIds.push(country.ruler.id);
  const candidate = countryCandidates(world, country).find((entry) => entry.person.id === spouse.id);
  assert.ok(candidate, 'a qualified resident partner of the ruler remains an election candidate');
  assert.equal(candidate.weight, 2, 'republican pornocracy doubles the election weight');
  assert.equal(candidate.expectedHeir, false, 'republican partners are not heirs');
  assert.match(candidate.advantages.join(' '), /права наследования нет/u);
  assert.ok(availableModifiers('republic', []).includes('pornocracy'), 'republican reforms can add the clarified modifier');
  assert.ok(MODIFIERS.pornocracy.forms.includes('republic'), 'modifier metadata includes the clarified republican effect');
}

// Republican partner bonus also applies to lovers and stacks independently with oligarchy.
{
  const { world, country } = fixture(10231);
  country.government = 'republic';
  country.modifiers = ['oligarchy', 'pornocracy'];
  country.termCounts[country.ruler.id] = 1;
  const { child } = addChild(world, country, country.ruler);
  const peer = addPerson(world, country, { age: child.age });
  child.loverIds.push(peer.id);
  peer.loverIds.push(child.id);
  country.ruler.formerRulerOf = [country.id];
  const candidates = countryCandidates(world, country);
  const heirLine = candidates.find((entry) => entry.person.id === child.id);
  const ordinaryPartner = candidates.find((entry) => entry.person.id === peer.id);
  assert.ok(heirLine && ordinaryPartner, 'both eligible lovers remain election candidates');
  assert.equal(heirLine.weight, ordinaryPartner.weight * 2, 'oligarchy and pornocracy bonuses remain distinct and stack');
  assert.ok(heirLine.advantages.some((reason) => reason.startsWith('Олигархия:')));
  assert.ok(heirLine.advantages.some((reason) => reason.startsWith('Порнократия:')));
  assert.equal(heirLine.expectedHeir, false);
}

// The clarified republican modifier survives government reforms.
{
  const { country } = fixture(10214);
  country.government = 'hereditary';
  country.modifiers = ['pornocracy'];
  applyReform(country, { government: 'republic', weight: 1 });
  assert.equal(country.government, 'republic');
  assert.ok(country.modifiers.includes('pornocracy'), 'the republican election effect is not discarded during reform');
}

// Republican pornocracy can be proposed by the reform system, and modifier forms remain enforced.
{
  const { world, country } = fixture(10232);
  country.government = 'republic';
  country.modifiers = [];
  assert.ok(reformCandidates(world, country, 1000).some((proposal) => proposal.add === 'pornocracy'),
    'the government reform path can propose republican pornocracy');
  for (const form of ['tribal', 'hereditary', 'republic', 'tyranny']) {
    for (const [id, modifier] of Object.entries(MODIFIERS)) {
      if (modifier.forms && !modifier.forms.includes(form)) {
        assert.ok(!availableModifiers(form, []).includes(id),
          `${id} is not available for ${form} outside its documented forms`);
      }
    }
  }
  assert.ok(!availableModifiers('republic', []).includes('continuous'), 'continuous rule requires the term limit law');
  assert.ok(availableModifiers('republic', ['term', 'termLimit']).includes('continuous'),
    'continuous rule becomes available with multiple-term limits');
}

// Tribal children of current/former chiefs are candidates, but never fixed heirs.
{
  const { world, country } = fixture(10215);
  country.government = 'tribal';
  country.modifiers = ['oligarchy', 'primogeniture'];
  const { child } = addChild(world, country, country.ruler, { age: 14 });
  const candidate = countryCandidates(world, country).find((entry) => entry.person.id === child.id);
  assert.ok(candidate, 'a suitable child of the current tribal ruler appears');
  assert.equal(candidate.expectedHeir, false, 'tribal succession remains non-guaranteed');
  assert.equal(hasFixedHeir(country), false, 'tribal modifiers do not create a fixed heir');
}

// Hereditary primogeniture displays a guaranteed heir separately from relative election weights.
{
  const { world, country } = fixture(10233);
  country.government = 'hereditary';
  country.modifiers = ['primogeniture'];
  const { child } = addChild(world, country, country.ruler, { age: 12 });
  const candidates = countryCandidates(world, country);
  assert.equal(hasFixedHeir(country), true);
  assert.equal(candidates[0]?.person.id, child.id, 'при первородстве первой рассматривается старшая подходящая ветвь');
  assert.equal(candidates[0]?.expectedHeir, true);
  assert.equal(candidates[0]?.weight, null, 'гарантированное наследование не отображается как вероятностный вес');
  assert.ok(candidates[0]?.basis.some((reason) => reason.includes('родственная связь подтверждена родословной')),
    'основание кандидата указывает на подтверждённое родство родителя и ребёнка');
  assert.ok(candidates[0]?.basis.some((reason) => reason.includes('Ожидаемый наследник по действующему закону')),
    'основание отдельно указывает на действующий порядок первородства');
}

// Порнократия добавляет партнёров к исходной линии, не дублируя наследников и правителя.
{
  const { world, country } = fixture(10237);
  country.government = 'hereditary';
  country.modifiers = ['primogeniture'];
  const ruler = country.ruler;
  const { child: firstHeir } = addChild(world, country, ruler, { age: 35 });
  const { child: secondHeir } = addChild(world, country, ruler, { age: 25 });
  const sourceOrder = successionOrder(world, country).map((p) => p.id);
  assert.ok(sourceOrder.indexOf(firstHeir.id) < sourceOrder.indexOf(secondHeir.id),
    'первородство задаёт исходный порядок до добавления партнёров');

  const rulerPartner = addPerson(world, country, { gender: 'female' });
  ruler.spouseIds.push(rulerPartner.id);
  rulerPartner.spouseIds.push(ruler.id);
  const heirPartner = addPerson(world, country, { gender: 'female' });
  firstHeir.loverIds.push(heirPartner.id);
  heirPartner.loverIds.push(firstHeir.id);
  firstHeir.spouseIds.push(secondHeir.id);
  secondHeir.spouseIds.push(firstHeir.id);

  country.modifiers = ['primogeniture', 'pornocracy'];
  const order = successionOrder(world, country);
  const orderIds = order.map((p) => p.id);
  assert.equal(orderIds[0], rulerPartner.id, 'партнёр правителя, не входивший в исходный список, стоит первым');
  assert.deepEqual(
    orderIds.filter((id) => sourceOrder.includes(id)),
    sourceOrder,
    'партнёры, уже входящие в исходный список, не меняют порядок по закону наследования',
  );
  assert.equal(orderIds.indexOf(heirPartner.id) + 1, orderIds.indexOf(firstHeir.id),
    'новый партнёр кандидата стоит непосредственно перед ним');
  assert.equal(orderIds.filter((id) => id === secondHeir.id).length, 1,
    'наследник, который также является партнёром другого кандидата, не дублируется');
  assert.ok(!orderIds.includes(ruler.id), 'правитель не добавляется повторно как партнёр кандидата');
  assert.equal(new Set(orderIds).size, orderIds.length, 'в итоговой линии нет повторов');

  refreshHeirs(world);
  assert.equal(country.heir?.id, order[0]?.id, 'сохранённый ожидаемый наследник совпадает с общей линией');
  const displayedCandidates = countryCandidates(world, country);
  assert.equal(displayedCandidates[0]?.person.id, order[0]?.id,
    'карточка страны показывает первого человека из общей линии наследования');
  assert.equal(displayedCandidates[0]?.expectedHeir, true,
    'первый кандидат отмечен ожидаемым наследником');
  assert.equal(leadershipOptions(world, country, 1000)[0]?.id, order[0]?.id,
    'выбор нового правителя использует того же первого преемника');
}

// Несвязанные заявленные династии не становятся наследниками; совпадающие жители только заменяют случайные варианты.
{
  const { world, country } = fixture(10235);
  country.government = 'hereditary';
  country.modifiers = [];
  const demographics = demography(world, country);
  const pair = demographics.pairs[0];
  const residents = [0, 1].map(() => {
    const resident = addPerson(world, country, {
      cultureId: pair.cultureId,
      religionId: pair.religionId,
    });
    resident.humanOrigin = demographics.humanOrigin;
    country.dynastyClaims.push(resident.familyId);
    return resident;
  });

  const actualCandidates = countryCandidates(world, country);
  assert.equal(actualCandidates.length, 0,
    'без подтверждённой родословной случайные жители не попадают в список наследников');
  assert.ok(!residents.some((resident) => actualCandidates.some((candidate) =>
    candidate.person.id === resident.id)),
  'заявление страны на династию без родственной цепочки не создаёт право наследования');

  const peopleBefore = world.people.length;
  const options = leadershipOptions(world, country, 1000);
  assert.equal(options.length, 2, 'для выбора по-прежнему предлагаются два персонажа');
  assert.deepEqual(new Set(options.map((option) => option.id)), new Set(residents.map((resident) => resident.id)),
    'совпадающие живые жители заменяют два случайных варианта выбора');
  assert.equal(world.people.length, peopleBefore, 'невыбранные случайные персонажи не добавляются в мир');
}

// Консулат с разделением ставит родственника конкретного консула выше, даже если его династия не заявлена правителем.
{
  const { world, country } = fixture(10236);
  country.government = 'hereditary';
  country.modifiers = ['consulate', 'partition'];
  const parent = addPerson(world, country);
  country.ruler.parents = [parent.id];
  const sibling = addPerson(world, country, { parents: [parent.id] });

  const order = successionOrder(world, country);
  assert.equal(order[0]?.id, sibling.id,
    'брат или сестра действующего консула получает приоритет независимо от dynastyClaims');
  const candidate = countryCandidates(world, country).find((entry) => entry.person.id === sibling.id);
  assert.ok(candidate);
  assert.match(candidate.basis.join(' '), /Консулат с разделением/u,
    'основание в интерфейсе описывает правило консулата, а не выдумывает родословную');
}

// Tyranny may succeed to a spouse if no eligible child exists, subject to sex restrictions.
{
  const { world, country } = fixture(10216);
  country.government = 'tyranny';
  country.modifiers = [];
  const spouse = addPerson(world, country, { countryId: -1, gender: 'female' });
  country.ruler.spouseIds.push(spouse.id);
  spouse.spouseIds.push(country.ruler.id);
  assert.ok(successionOrder(world, country).some((p) => p.id === spouse.id), 'a ruler’s spouse is in the tyranny succession pool');
  country.modifiers = ['patriarchal'];
  assert.ok(!successionOrder(world, country).some((p) => p.id === spouse.id), 'ordinary spouse succession obeys sex restrictions');
}

// Country-level culture/sex and repeat-election restrictions remove otherwise living residents.
{
  const { world, country, culture } = fixture(10217);
  country.government = 'republic';
  country.modifiers = ['patriarchal', 'ethnic', 'term', 'termLimit'];
  country.maxTerms = 1;
  country.barredRulerIds = [country.ruler.id];
  const female = addPerson(world, country, { gender: 'female' });
  const wrongCulture = world.newCulture(culture, 1000);
  const otherCulture = addPerson(world, country, { gender: 'male', cultureId: wrongCulture.id });
  const exhausted = addPerson(world, country, { gender: 'male' });
  country.termCounts[exhausted.id] = 1;
  const eligible = addPerson(world, country, { gender: 'male' });
  const ids = countryCandidates(world, country).map((entry) => entry.person.id);
  assert.ok(ids.includes(eligible.id), 'a resident meeting all active restrictions can run');
  assert.ok(!ids.includes(female.id), 'patriarchy excludes women from candidacy');
  assert.ok(!ids.includes(otherCulture.id), 'ethnic rule excludes non-leading culture');
  assert.ok(!ids.includes(exhausted.id), 'term limits exclude a candidate who used all terms');
  assert.ok(!ids.includes(country.ruler.id), 'barred leaders cannot return');
}

// Continuous terms permit the sitting ruler but do not revive a former barred leader.
{
  const { world, country } = fixture(10234);
  country.government = 'republic';
  country.modifiers = ['term', 'termLimit', 'continuous'];
  country.maxTerms = 2;
  const former = addPerson(world, country);
  country.previousRulerIds = [former.id];
  country.barredRulerIds = [];
  assert.equal(candidateAllowed(world, country, former, country.ruler), false,
    'continuous terms do not let a previous non-incumbent return');
  assert.equal(candidateAllowed(world, country, country.ruler, country.ruler), true,
    'continuous terms permit the current leader to run again');
}

// An empty candidate set remains a real, directly addressable page with a clear empty state.
{
  const { world, country } = fixture(10218);
  country.government = 'republic';
  country.modifiers = ['term', 'termLimit'];
  country.maxTerms = 1;
  country.barredRulerIds = [country.ruler.id];
  const exhausted = addPerson(world, country);
  country.termCounts[exhausted.id] = 1;
  assert.deepEqual(countryCandidates(world, country), [], 'a country with no eligible residents has no candidates');
  const route = readFileSync(resolve(process.cwd(), 'app/country/[id]/candidates.tsx'), 'utf8');
  const list = readFileSync(resolve(process.cwd(), 'components/profiles/CountryLists.tsx'), 'utf8');
  assert.match(route, /CountryCandidatesList/u, 'the dedicated candidates route renders the list even when empty');
  assert.match(list, /Сейчас нет живых персонажей/u, 'the empty candidate page explains why it is empty');
}

// Historical ruler and current co-ruler records are sorted using saved appointment years.
{
  const { world, country } = fixture(10219);
  const former = country.ruler;
  const current = addPerson(world, country, { age: 35 });
  const coRuler = addPerson(world, country, { age: 28 });
  former.formerRulerOf = [country.id];
  current.formerRulerOf = [country.id];
  coRuler.formerRulerOf = [country.id];
  country.previousRulerIds = [former.id];
  country.ruler = current;
  country.rulerSince = 1015;
  country.coRulerIds = [coRuler.id];
  country.seatSince[former.id] = 1000;
  country.seatSince[coRuler.id] = 1012;
  country.seatSince[current.id] = 1015;
  const history = countryRulerHistory(world, country);
  assert.deepEqual(history.map(({ person }) => person.id), [former.id, coRuler.id, current.id]);
  assert.equal(history[1].currentCoRuler, true, 'the current co-ruler appears in office history');
  assert.equal(history[1].startYear, 1012);
}

// Reappointments create separate, bounded terms for rulers and co-rulers.
{
  const { world, country } = fixture(10220);
  const firstRuler = country.ruler;
  const secondRuler = addPerson(world, country);
  appoint(world, country, secondRuler, 1005);
  appoint(world, country, firstRuler, 1010);
  const coRuler = addPerson(world, country);
  country.heir = coRuler;
  country.modifiers.push('coRule');
  ensureOffices(world, country, 1020);
  const replacementCoRuler = addPerson(world, country);
  appoint(world, country, replacementCoRuler, 1025, coRuler.id);

  const terms = countryRulerHistory(world, country);
  assert.deepEqual(terms.map(({ person, startYear, endYear, office }) =>
    [person.id, startYear, endYear, office]), [
    [firstRuler.id, 1000, 1005, 'ruler'],
    [secondRuler.id, 1005, 1010, 'ruler'],
    [firstRuler.id, 1010, null, 'ruler'],
    [coRuler.id, 1020, 1025, 'coRuler'],
    [replacementCoRuler.id, 1025, null, 'coRuler'],
  ]);
}

// Legacy saves migrate their known former and current office records.
{
  const { world, country } = fixture(10221);
  const currentRulerId = country.ruler.id;
  const former = addPerson(world, country);
  former.formerRulerOf = [country.id];
  country.previousRulerIds = [former.id];
  country.seatSince[former.id] = 1001;
  country.rulerSince = 1020;
  country.seatSince[currentRulerId] = 1020;
  delete country.rulerTerms;
  normalizePolitics(world, 1020);

  assert.equal(country.ruler.id, currentRulerId, 'migration keeps the current ruler');
  assert.deepEqual(countryRulerHistory(world, country).map(({ person, startYear }) =>
    [person.id, startYear]), [[former.id, 1001], [currentRulerId, 1020]]);
}

console.log('Country character, candidate, succession, and ruler-history regressions passed.');
