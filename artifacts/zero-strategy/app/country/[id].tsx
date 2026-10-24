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
import type { Country } from '@/game/world';
import type { Person } from '@/game/government';
import { cityProfileRoute, cultureProfileRoute, religionProfileRoute } from '@/game/profileRoutes';
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
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const game = currentGame();
  if (!game) return <MissingProfile title="Игра не открыта" />;
  return <CountryProfile game={game} countryId={Number(rawId)} />;
}

function CountryProfile({ game, countryId }: { game: Game; countryId: number }) {
  const country = game.world.countries[countryId];
  if (!country) return <MissingProfile title="Страна не найдена" />;
  return <CountryDetails game={game} country={country} />;
}

function CountryDetails({ game, country }: { game: Game; country: Country }) {
  const snapshot = useGameSnapshot(game);
  const composition = useMemo(() => game.countryComposition(country.id), [game, country.id, game.world.version]);
  const cities = useMemo(() => game.world.cities.filter((city) => city.countryId === country.id), [game, country.id, game.world.version]);
  const references = [
    chronicleReference('country', country.id),
    ...cities.map((city) => chronicleReference('city', city.id)),
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
        <ProfileFact>Тип · {country.type === 'nomadic' ? 'кочевая страна' : 'оседлая страна'}</ProfileFact>
        <ProfileFact>Площадь · {fmt(country.type === 'nomadic' ? country.range?.length ?? 0 : country.pixels)} земель</ProfileFact>
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

      {country.type === 'nomadic' && <ProfileSection title="АРЕАЛ">
        <ProfileFact>Ареал кочевой страны может пересекаться с границами других стран.</ProfileFact>
      </ProfileSection>}

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

const styles = {
  facts: { padding: 12, gap: 6, borderLeftWidth: 3, borderColor: c.primary, backgroundColor: c.card } as const,
  note: { fontFamily: fonts.sans, fontSize: 12, color: c.mutedForeground } as const,
  mapButton: { alignSelf: 'flex-start' as const, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginTop: 4, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: c.primary },
  mapButtonText: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: c.primaryForeground } as const,
};
