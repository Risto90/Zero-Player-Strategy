import {
  compatibleFlagProfileIds,
  createEntityEmblem,
  selectFlagProfileId,
  type FlagGenerationSelection,
} from './flagIdentity';
import { expectedHeirFor, successionOrder } from './succession';
import { flagStageRandom } from './random';
import type { Person } from './government';
import type { World } from './world';

const MIN_DYNASTY_RULERS = 3;
const MIN_DYNASTY_MEMBERS = 15;

function numericSeed(value: string | number): number {
  const direct = Number(value);
  if (Number.isFinite(direct)) return direct;
  const parts = String(value).split('+').map((part) => Number(part.replace(/^\[|\]$/g, '')));
  if (parts.length > 1 && parts.every(Number.isFinite)) {
    return Math.round(parts.reduce((sum, part) => sum + part, 0) / parts.length);
  }
  throw new TypeError(`Невозможно получить числовой сид флага: ${String(value)}.`);
}

function chooseDynastyHeraldry(world: World, familyId: number, living: Person[]) {
  const countryWeights = new Map<number, number>();
  const statusFactor = (person: Person, countryId: number): number => {
    const country = world.countries[countryId];
    if (!country) return 1;
    let factor = 1;
    const currentRuler = country.ruler?.id === person.id;
    const currentCoRuler = country.coRulerIds?.includes(person.id) ?? false;
    if (currentRuler || (currentCoRuler && country.modifiers.includes('consulate'))) factor *= 5;
    else if (currentCoRuler) factor *= 2.5;
    else if (person.formerRulerOf?.includes(countryId)) factor *= 1.5;
    const expected = expectedHeirFor(world, country, country.ruler)?.id === person.id;
    const heirList = successionOrder(world, country, country.ruler).some((candidate) => candidate.id === person.id);
    if (expected) factor *= 2;
    else if (heirList) factor *= 1.1;
    return factor;
  };

  for (const person of living) {
    const countryIds = new Set<number>([person.countryId, ...person.formerRulerOf]);
    for (const country of world.countries) {
      if (country.ruler?.id === person.id || country.coRulerIds?.includes(person.id) ||
          expectedHeirFor(world, country, country.ruler)?.id === person.id ||
          successionOrder(world, country, country.ruler).some((candidate) => candidate.id === person.id)) {
        countryIds.add(country.id);
      }
    }
    for (const countryId of countryIds) {
      const country = world.countries[countryId];
      if (!country?.styleProfile) continue;
      const ancestry = person.humanOrigin;
      const raceShare = ancestry && !person.traits.includes('Космополит')
        ? ancestry.shares.reduce((sum, share, index) => {
          const raceId = ancestry.ids[index];
          const raceEra = world.cultures.find((culture) =>
            culture.parentId === null && culture.foundingRaceId === raceId)?.styleProfile?.era;
          return sum + (raceEra === country.styleProfile!.era ? share / 100 : 0);
        }, 0)
        : 0;
      const raceFactor = ancestry && !person.traits.includes('Космополит')
        ? (1 + raceShare) * (person.traits.includes('Расист') ? 2 : 1)
        : 1;
      countryWeights.set(countryId, (countryWeights.get(countryId) ?? 0) +
        statusFactor(person, countryId) * raceFactor);
    }
  }
  const residenceCounts = new Map<number, number>();
  living.forEach((person) => residenceCounts.set(person.countryId, (residenceCounts.get(person.countryId) ?? 0) + 1));
  const eraWeights = new Map<number, number>();
  for (const [countryId, weight] of countryWeights) {
    const country = world.countries[countryId]!;
    const adjusted = weight * ((residenceCounts.get(countryId) ?? 0) > living.length / 2 ? 2 : 1);
    eraWeights.set(country.styleProfile!.era, (eraWeights.get(country.styleProfile!.era) ?? 0) + adjusted);
  }
  const eraEntries = [...eraWeights].map(([era, weight]) => ({ value: era, weight }));
  const seedBaseCountry = world.countries
    .filter((country) => living.some((person) => country.ruler.id === person.id))
    .sort((a, b) => a.id - b.id)[0] ??
    [...residenceCounts].sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .map(([id]) => world.countries[id]).find((country) => !!country?.styleProfile);
  if (!seedBaseCountry?.styleProfile) throw new Error(`У династии ${familyId} нет страны для выбора эпохи.`);
  const memberSum = living.reduce((sum, person) => sum + person.id, 0);
  const generationSeed = numericSeed(seedBaseCountry.flagIdentity?.seed ?? seedBaseCountry.styleProfile.identity.seed) +
    familyId + memberSum;
  const era = eraEntries.length
    ? (() => {
      let point = flagStageRandom(generationSeed, 'S0_ERA')() *
        eraEntries.reduce((sum, entry) => sum + entry.weight, 0);
      for (const entry of eraEntries) {
        point -= entry.weight;
        if (point < 0) return entry.value;
      }
      return eraEntries[eraEntries.length - 1].value;
    })()
    : seedBaseCountry.styleProfile.era;

  const atheistShare = living.filter((person) => person.religionId === null).length / Math.max(1, living.length);
  const weights: Record<string, number> = {};
  const tagsByProfile = new Map<string, string[]>();
  for (const person of living) {
    const relevantCountries = [...countryWeights.keys()]
      .filter((countryId) => countryId === person.countryId || person.formerRulerOf.includes(countryId) ||
        world.countries[countryId]?.ruler.id === person.id ||
        world.countries[countryId]?.coRulerIds.includes(person.id) ||
        expectedHeirFor(world, world.countries[countryId]!, world.countries[countryId]!.ruler)?.id === person.id ||
        successionOrder(world, world.countries[countryId]!, world.countries[countryId]!.ruler)
          .some((candidate) => candidate.id === person.id));
    const currentRuler = relevantCountries.some((countryId) =>
      world.countries[countryId]?.ruler.id === person.id ||
      (world.countries[countryId]?.modifiers.includes('consulate') &&
        world.countries[countryId]?.coRulerIds.includes(person.id)));
    const currentCoRuler = relevantCountries.some((countryId) =>
      world.countries[countryId]?.coRulerIds.includes(person.id));
    let roleWeight = currentRuler ? 5 : currentCoRuler ? 2.5 : 1;
    if (person.formerRulerOf.some((countryId) => !relevantCountries.some((id) =>
      id === countryId && (world.countries[id]?.ruler.id === person.id ||
        world.countries[id]?.coRulerIds.includes(person.id))))) roleWeight *= 1.5;
    for (const countryId of relevantCountries) {
      const country = world.countries[countryId]!;
      if (expectedHeirFor(world, country, country.ruler)?.id === person.id) roleWeight *= 2;
      else if (successionOrder(world, country, country.ruler).some((candidate) => candidate.id === person.id)) {
        roleWeight *= 1.1;
      }
    }
    const raceMix = person.humanOrigin;
    const sources = [
      { style: world.cultures[person.cultureId]?.styleProfile, kind: 'culture' as const },
      { style: person.religionId === null ? undefined : world.religions[person.religionId]?.styleProfile, kind: 'religion' as const },
    ];
    for (const { style, kind } of sources) {
      if (!style || !compatibleFlagProfileIds(era, style.tags).includes(style.profileId)) continue;
      const raceShare = raceMix && !person.traits.includes('Космополит')
        ? raceMix.shares.reduce((sum, share, index) => {
          const raceId = raceMix.ids[index];
          const raceCulture = world.cultures.find((culture) =>
            culture.parentId === null && culture.foundingRaceId === raceId);
          return sum + (raceCulture?.styleProfile &&
            compatibleFlagProfileIds(era, raceCulture.styleProfile.tags).includes(style.profileId)
            ? share / 100
            : 0);
        }, 0)
        : 0;
      const ancestryFactor = raceMix && !person.traits.includes('Космополит')
        ? (1 + raceShare) * (person.traits.includes('Расист') ? 2 : 1)
        : 1;
      let weight = roleWeight * ancestryFactor;
      if (kind === 'religion') {
        weight *= 1 - atheistShare;
        if (person.traits.includes('Фанатик')) weight *= 2;
        if (person.traits.includes('Циник')) weight *= 0.5;
      } else {
        if (person.traits.includes('Националист')) weight *= 2;
        if (person.traits.includes('Космополит')) weight *= 0.5;
      }
      weights[style.profileId] = (weights[style.profileId] ?? 0) + weight;
      tagsByProfile.set(style.profileId, [...style.tags]);
    }
  }
  const profiles = Object.keys(weights).filter((id) => weights[id] > 0);
  if (!profiles.length) throw new Error(`Для эпохи ${era} у династии ${familyId} нет совместимых профилей.`);
  const profileId = profiles.length === 1
    ? profiles[0]
    : selectFlagProfileId('dynasty-coat', era, [], generationSeed, weights);
  const uniqueSeed = world.generationSeedFor(era, profileId, generationSeed);
  const selection: FlagGenerationSelection = {
    era,
    profileId,
    generationSeed: uniqueSeed,
    tags: tagsByProfile.get(profileId) ?? [],
  };
  return { selection, uniqueSeed };
}

/** Создаёт гербы только для династий, достигших обоих порогов. */
export function ensureDynastyEmblems(world: World): number[] {
  world.dynastyEmblems ??= {};
  const peopleById = new Map(world.people.map((person) => [person.id, person]));
  const memberIds = new Map<number, Set<number>>();
  const rulerIds = new Map<number, Set<number>>();
  const formerRulersByCountry = new Map<number, Person[]>();

  const addMember = (person: Person | undefined) => {
    if (!person || !Number.isFinite(person.familyId)) return;
    let members = memberIds.get(person.familyId);
    if (!members) {
      members = new Set();
      memberIds.set(person.familyId, members);
    }
    members.add(person.id);
  };

  const addRuler = (personId: number, fallback?: Person) => {
    const person = peopleById.get(personId) ?? (fallback?.id === personId ? fallback : undefined);
    if (!person) return;
    addMember(person);
    let rulers = rulerIds.get(person.familyId);
    if (!rulers) {
      rulers = new Set();
      rulerIds.set(person.familyId, rulers);
    }
    rulers.add(person.id);
  };

  for (const person of world.people) {
    addMember(person);
    for (const countryId of person.formerRulerOf ?? []) {
      const formerRulers = formerRulersByCountry.get(countryId);
      if (formerRulers) formerRulers.push(person);
      else formerRulersByCountry.set(countryId, [person]);
    }
  }
  for (const country of world.countries) {
    for (const term of country.rulerTerms ?? []) addRuler(term.personId, country.ruler);
    for (const personId of country.previousRulerIds ?? []) addRuler(personId, country.ruler);
    if (country.ruler) addRuler(country.ruler.id, country.ruler);
    for (const personId of country.coRulerIds ?? []) addRuler(personId);
    for (const person of formerRulersByCountry.get(country.id) ?? []) addRuler(person.id);
  }

  const created: number[] = [];
  for (const [familyId, rulers] of rulerIds) {
    if (rulers.size < MIN_DYNASTY_RULERS ||
      (memberIds.get(familyId)?.size ?? 0) < MIN_DYNASTY_MEMBERS ||
      world.dynastyEmblems[familyId]?.emblemSpec) continue;
    const living = world.people.filter((person) => person.familyId === familyId && person.alive);
    if (!living.length) continue;
    const { selection, uniqueSeed } = chooseDynastyHeraldry(world, familyId, living);
    world.dynastyEmblems[familyId] = {
      id: familyId,
      ...createEntityEmblem(
        world.seed,
        'dynasty',
        familyId,
        'dynasty-coat',
        undefined,
        undefined,
        undefined,
        world.flagSeed,
        selection,
      ),
    };
    world.reserveGeneratedFlag(selection.era!, selection.profileId!, uniqueSeed);
    created.push(familyId);
  }
  return created;
}

/** Возвращает старшего живого члена, а если живых нет — старшего известного члена. */
export function dynastyFocusPersonId(people: readonly Person[], familyId: number): number | undefined {
  const members = people.filter((person) => person.familyId === familyId);
  const living = members.filter((person) => person.alive);
  const candidates = living.length ? living : members;
  return candidates.sort((first, second) => first.bornAt - second.bornAt || first.id - second.id)[0]?.id;
}
