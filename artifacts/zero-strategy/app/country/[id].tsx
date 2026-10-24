import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import colors, { fonts } from '@/constants/colors';
import { filterChronicle, chronicleReference } from '@/game/chronicle';
import { fmt, pct } from '@/game/format';
import { ageStage, GOVERNMENTS, MODIFIERS, personDeathStatus } from '@/game/government';
import { currentGame } from '@/game/session';
import { useGameSnapshot } from '@/game/useGame';
import { expectedHeirFor, rulers } from '@/game/succession';
import type { Game } from '@/game/game';
import type { NomadGroup } from '@/game/world';
import type { Person } from '@/game/government';
import { cityProfileRoute, cultureProfileRoute, nomadProfileRoute, religionProfileRoute } from '@/game/profileRoutes';
import {
  MissingProfile,
  ProfileFact,
  ProfileLayout,
  ProfileLink,
  ProfileScrollList,
  ProfileSection,
} from '@/components/profiles/ProfileLayout';

const c = colors.light;

export default function CountryPage() {
  const { id: rawId, type: entityType } = useLocalSearchParams<{ id: string; type?: string }>();
  const game = currentGame();
  if (!game) return <MissingProfile title="Игра не открыта" />;
  return <CountryProfile game={game} countryId={Number(rawId)} entityType={entityType === 'nomad' ? 'nomad' : 'country'} />;
}

function CountryProfile({ game, countryId, entityType }: { game: Game; countryId: number; entityType: 'country' | 'nomad' }) {
  if (entityType === 'nomad') {
    const nomad = game.world.nomads.find((group) => group.id === countryId);
    return nomad ? <NomadProfile game={game} nomad={nomad} /> : <MissingProfile title="Кочевье не найдено" />;
  }
  const country = game.world.countries[countryId];
  if (!country) return <MissingProfile title="Страна не найдена" />;
  return <CountryDetails game={game} country={country} />;
}

function CountryDetails({ game, country }: { game: Game; country: Game['world']['countries'][number] }) {
  const snapshot = useGameSnapshot(game);
  const composition = useMemo(() => game.countryComposition(country.id), [game, country.id, game.world.version]);
  const cities = useMemo(() => game.world.cities.filter((city) => city.countryId === country.id), [game, country.id, game.world.version]);
  const countryNomads = useMemo(() => game.world.nomads.map((nomad) => {
    let overlap = 0;
    for (const pixel of nomad.range) if (game.world.owner[pixel] === country.id + 1) overlap += 1;
    return { nomad, overlap };
  }).filter(({ overlap }) => overlap > 0), [game, country.id, game.world.version]);
  const references = [
    chronicleReference('country', country.id),
    ...cities.map((city) => chronicleReference('city', city.id)),
    ...countryNomads.map(({ nomad }) => chronicleReference('nomad', nomad.id)),
    ...composition.cultures.flatMap(({ id }) => id === null ? [] : [chronicleReference('culture', id)]),
    ...composition.religions.flatMap(({ id }) => id === null ? [] : [chronicleReference('religion', id)]),
  ];

  const personLink = (personId: number, name: string, note?: string) => (
    <ProfileLink key={`${personId}-${name}`} title={name} note={note}
      onPress={() => router.push({ pathname: '/person/[id]', params: { id: String(personId) } })} />
  );
  const details = (
    <>
      <View style={styles.facts}>
        <ProfileFact>Площадь · {fmt(country.pixels)} земель</ProfileFact>
        <ProfileFact>Население · {fmt(composition.population)} чел.</ProfileFact>
        <ProfileFact>Форма правления · {GOVERNMENTS[country.government].name}</ProfileFact>
        <ProfileFact>Основана в {country.foundedYear} году · {country.rank}</ProfileFact>
        {country.modifiers.map((modifier) => (
          <Text key={modifier} style={styles.note}>· {modifier === 'consulate' ? `Консулат ${country.consulCount}` : MODIFIERS[modifier].name}: {MODIFIERS[modifier].effect}</Text>
        ))}
      </View>

      <ProfileSection title={country.modifiers.includes('consulate') ? 'ПРАВИТЕЛИ' : 'ПРАВИТЕЛЬ'}>
        {rulers(game.world, country).map((leader) => (
          <View key={leader.id}>
            {personLink(leader.id, leader.name, `${leader.age} лет · ${ageStage(leader.age)}${personDeathStatus(leader) ? ` · ${personDeathStatus(leader)}` : ''}`)}
            {country.heir && !country.modifiers.includes('consulate') &&
              personLink(country.heir.id, `Ожидаемый наследник · ${country.heir.name}`, `${country.heir.age} лет · ${ageStage(country.heir.age)}${personDeathStatus(country.heir) ? ` · ${personDeathStatus(country.heir)}` : ''}`)}
            {country.modifiers.includes('consulate') && (() => {
              const heir = expectedHeirFor(game.world, country, leader);
              return heir ? personLink(heir.id, `Наследник консула · ${heir.name}`, `${heir.age} лет · ${ageStage(heir.age)}${personDeathStatus(heir) ? ` · ${personDeathStatus(heir)}` : ''}`) : null;
            })()}
          </View>
        ))}
      </ProfileSection>

      <ProfileSection title="ЭТНИЧЕСКИЙ СОСТАВ">
        <ProfileScrollList>
          {composition.cultures.length ? composition.cultures.map((group) => {
            if (group.id === null) return <ProfileFact key="unknown-culture">{group.name} · {pct(group.percent)}</ProfileFact>;
            const cultureId = group.id;
            return <ProfileLink key={cultureId} title={group.name} note={pct(group.percent)}
              onPress={() => router.push(cultureProfileRoute(cultureId))} />;
          }) : <ProfileFact>Нет данных.</ProfileFact>}
        </ProfileScrollList>
      </ProfileSection>

      <ProfileSection title="РЕЛИГИОЗНЫЙ СОСТАВ">
        <ProfileScrollList>
          {composition.religions.length ? composition.religions.map((group) => {
            if (group.id === null) return <ProfileFact key="atheists">{group.name} · {pct(group.percent)}</ProfileFact>;
            const religionId = group.id;
            return <ProfileLink key={religionId} title={group.name} note={pct(group.percent)}
              onPress={() => router.push(religionProfileRoute(religionId))} />;
          }) : <ProfileFact>Нет данных.</ProfileFact>}
        </ProfileScrollList>
      </ProfileSection>

      <ProfileSection title={`ГОРОДА · ${cities.length}`}>
        <ProfileScrollList>
          {cities.length ? cities.map((city) => (
            <ProfileLink key={city.id} title={`${city.capital ? 'Столица · ' : ''}${city.name ?? 'Город'}`}
              note={`${['городок', 'город', 'вольный город', 'полис', 'мегаполис', 'конгломерация'][city.rank - 1]} · ${fmt(Math.round(city.population))} чел.`}
              onPress={() => router.push(cityProfileRoute(city.id))} />
          )) : <ProfileFact>Городов нет.</ProfileFact>}
        </ProfileScrollList>
      </ProfileSection>

      <ProfileSection title="КОЧЕВЬЯ НА ТЕРРИТОРИИ">
        <ProfileScrollList>
          {countryNomads.length ? countryNomads.map(({ nomad, overlap }) => (
            <ProfileLink key={nomad.id} title={nomad.name}
              note={overlap === nomad.range.length ? 'полностью' : 'частично'}
              onPress={() => router.push(nomadProfileRoute(nomad.id))} />
          )) : <ProfileFact>Нет кочевий.</ProfileFact>}
        </ProfileScrollList>
      </ProfileSection>

      <Pressable onPress={() => {
        game.showCountryOnMap(country.id);
        router.replace('/play');
      }} style={styles.mapButton}>
        <Feather name="map" size={16} color={c.primaryForeground} />
        <Text style={styles.mapButtonText}>Показать на карте</Text>
      </Pressable>
    </>
  );
  return (
    <ProfileLayout eyebrow="КАРТОЧКА СТРАНЫ" title={country.name}
      subtitle={`${country.rank} · основана в ${country.foundedYear} году`}
      details={details} chronicle={filterChronicle(snapshot.chronicle, references)} />
  );
}

function NomadProfile({ game, nomad }: { game: Game; nomad: NomadGroup }) {
  const snapshot = useGameSnapshot(game);
  const { population, cultureRows, religionRows, atheistPopulation } = useMemo(() => {
    let population = 0;
    const cultureTotals = new Map<number, number>();
    const religionTotals = new Map<number, number>();
    let atheistPopulation = 0;
    for (const cell of nomad.cells) {
      population += cell.population;
      const cultures = game.world.cultureTable.entries[cell.cultureMix];
      cultures.ids.forEach((cultureId, index) =>
        cultureTotals.set(cultureId, (cultureTotals.get(cultureId) ?? 0) + cell.population * cultures.shares[index] / 100),
      );
      const religions = game.world.religionTable.entries[cell.religionMix];
      religions.ids.forEach((religionId, index) =>
        religionTotals.set(religionId, (religionTotals.get(religionId) ?? 0) + cell.population * religions.shares[index] / 100),
      );
      atheistPopulation += cell.population * (100 - religions.total) / 100;
    }
    return {
      population,
      cultureRows: [...cultureTotals.entries()].sort((a, b) => b[1] - a[1]),
      religionRows: [...religionTotals.entries()].sort((a, b) => b[1] - a[1]),
      atheistPopulation,
    };
  }, [game, nomad, game.world.version]);
  const references = [
    chronicleReference('nomad', nomad.id),
    ...cultureRows.map(([id]) => chronicleReference('culture', id)),
    ...religionRows.map(([id]) => chronicleReference('religion', id)),
    ...(nomad.sourceCountryId === null ? [] : [chronicleReference('country', nomad.sourceCountryId)]),
  ];
  const personLink = (person: Person, label?: string) => (
    <ProfileLink key={`${person.id}-${label ?? person.name}`} title={label ?? person.name}
      note={`${person.age} лет${personDeathStatus(person) ? ` · ${personDeathStatus(person)}` : ''}`}
      onPress={() => router.push({ pathname: '/person/[id]', params: { id: String(person.id) } })} />
  );
  const details = (
    <>
      <View style={styles.facts}>
        <ProfileFact>Население · {fmt(population)} чел.</ProfileFact>
        <ProfileFact>Форма правления · {GOVERNMENTS[nomad.government].name}</ProfileFact>
        <ProfileFact>Ареал · {fmt(nomad.pixels)} земель</ProfileFact>
        {nomad.modifiers.map((modifier) => (
          <Text key={modifier} style={styles.note}>· {MODIFIERS[modifier]?.name ?? modifier}: {MODIFIERS[modifier]?.effect ?? ''}</Text>
        ))}
      </View>
      <ProfileSection title="ПРАВИТЕЛЬ">{personLink(nomad.ruler)}</ProfileSection>
      {nomad.heir && <ProfileSection title="ОЖИДАЕМЫЙ НАСЛЕДНИК">{personLink(nomad.heir, `Ожидаемый наследник · ${nomad.heir.name}`)}</ProfileSection>}
      <ProfileSection title="ЭТНИЧЕСКИЙ СОСТАВ">
        <ProfileScrollList>
          {cultureRows.length ? cultureRows.map(([id, amount]) => (
            <ProfileLink key={id} title={game.world.cultures[id]?.name ?? 'неизвестная культура'}
              note={pct(amount / Math.max(population, 1) * 100)}
              onPress={() => router.push(cultureProfileRoute(id))} />
          )) : <ProfileFact>Нет данных.</ProfileFact>}
        </ProfileScrollList>
      </ProfileSection>
      <ProfileSection title="РЕЛИГИОЗНЫЙ СОСТАВ">
        <ProfileScrollList>
          {religionRows.map(([id, amount]) => (
            <ProfileLink key={id} title={game.world.religions[id]?.name ?? 'неизвестная вера'}
              note={pct(amount / Math.max(population, 1) * 100)}
              onPress={() => router.push(religionProfileRoute(id))} />
          ))}
          {atheistPopulation > 0 && <ProfileFact>Атеисты · {pct(atheistPopulation / Math.max(population, 1) * 100)}</ProfileFact>}
          {!religionRows.length && atheistPopulation <= 0 && <ProfileFact>Нет данных.</ProfileFact>}
        </ProfileScrollList>
      </ProfileSection>
      <ProfileSection title="АРЕАЛ И ПРОИСХОЖДЕНИЕ">
        <ProfileFact>Ареал может пересекаться с государствами и другими кочевьями.</ProfileFact>
        {nomad.sourceCountryId !== null && (
          <ProfileLink title={`${game.world.countries[nomad.sourceCountryId]?.name ?? 'Распущенное государство'} · происхождение`}
            onPress={() => router.push({ pathname: '/country/[id]', params: { id: String(nomad.sourceCountryId) } })} />
        )}
      </ProfileSection>
    </>
  );
  return (
    <ProfileLayout eyebrow="КАРТОЧКА КОЧЕВЬЯ" title={nomad.name}
      subtitle={`Кочевье · ${GOVERNMENTS[nomad.government].name}`}
      details={details} chronicle={filterChronicle(snapshot.chronicle, references)} />
  );
}

const styles = {
  facts: { padding: 12, gap: 6, borderLeftWidth: 3, borderColor: c.primary, backgroundColor: c.card } as const,
  note: { fontFamily: fonts.sans, fontSize: 12, color: c.mutedForeground } as const,
  mapButton: { alignSelf: 'flex-start' as const, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginTop: 4, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: c.primary },
  mapButtonText: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: c.primaryForeground } as const,
};
