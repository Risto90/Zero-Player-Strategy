import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useGameSnapshot } from '@/game/useGame';
import { currentGame } from '@/game/session';
import { filterChronicle, chronicleReference } from '@/game/chronicle';
import { fmt } from '@/game/format';
import { cityComposition } from '@/game/settlements';
import { cityProfileRoute, countryProfileRoute, cultureProfileRoute, nomadProfileRoute } from '@/game/profileRoutes';
import { MissingProfile, ProfileFact, ProfileLayout, ProfileLink, ProfileSection, ProfileScrollList } from '@/components/profiles/ProfileLayout';

export default function CulturePage() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const game = currentGame();
  const id = Number(rawId);
  if (!game || !Number.isInteger(id) || id < 0) return <MissingProfile title="Этнос не найден" />;
  const snapshot = useGameSnapshot(game);
  const culture = game.world.cultures[id];
  if (!culture) return <MissingProfile title="Этнос не найден" />;
  const { countries, cities, nomads, branches } = useMemo(() => ({
    countries: game.world.countries.filter((country) =>
      country.pixels > 0 && game.countryComposition(country.id).cultures.some((group) => group.id === id)),
    cities: game.world.cities.filter((city) => cityComposition(game.world, city).cultures.some((group) => group.id === id)),
    nomads: game.world.nomads.filter((nomad) =>
      nomad.cells.some((cell) => game.world.cultureTable.shareOf(cell.cultureMix, id) > 0)),
    branches: game.world.cultures.filter((child) => child.parentId === id),
  }), [game, id, game.world.version]);
  const references = [
    chronicleReference('culture', id),
    ...(culture.parentId === null ? [] : [chronicleReference('culture', culture.parentId)]),
    ...branches.map((child) => chronicleReference('culture', child.id)),
    ...countries.map((country) => chronicleReference('country', country.id)),
    ...cities.map((city) => chronicleReference('city', city.id)),
    ...nomads.map((nomad) => chronicleReference('nomad', nomad.id)),
  ];
  const population = snapshot.legend.cultures.find((row) => row.id === id)?.value ?? 0;
  const details = (
    <>
      <View style={styles.facts}>
        <ProfileFact><Text style={{ color: culture.color }}>■ </Text>Население · {fmt(population)} чел.</ProfileFact>
        <ProfileFact>Основан(а) в {culture.foundedYear} году</ProfileFact>
        {culture.traits?.length ? <ProfileFact>Черты · {culture.traits.join(', ')}</ProfileFact> : null}
      </View>
      <ProfileSection title="РОДСТВО">
        {culture.parentId !== null && game.world.cultures[culture.parentId] && (
          <ProfileLink title={`${game.world.cultures[culture.parentId].name} · исходный этнос`}
            onPress={() => router.push(cultureProfileRoute(culture.parentId!))} />
        )}
        {branches.length ? branches.map((child) => (
          <ProfileLink key={child.id} title={`${child.name} · ветвь`}
            onPress={() => router.push(cultureProfileRoute(child.id))} />
        )) : <ProfileFact>Другие ветви не зарегистрированы.</ProfileFact>}
      </ProfileSection>
      <ProfileSection title={`СТРАНЫ · ${countries.length}`}>
        <ProfileScrollList>
          {countries.length ? countries.map((country) => (
            <ProfileLink key={country.id} title={`${country.rank} ${country.name}`}
              onPress={() => router.push(countryProfileRoute(country.id))} />
          )) : <ProfileFact>Сейчас этнос не входит в состав стран.</ProfileFact>}
        </ProfileScrollList>
      </ProfileSection>
      <ProfileSection title={`ГОРОДА · ${cities.length}`}>
        <ProfileScrollList>
          {cities.length ? cities.map((city) => (
            <ProfileLink key={city.id} title={city.name ?? 'Город'}
              note={game.world.countries[city.countryId]?.name ?? 'Страна распущена'}
              onPress={() => router.push(cityProfileRoute(city.id))} />
          )) : <ProfileFact>Городов нет.</ProfileFact>}
        </ProfileScrollList>
      </ProfileSection>
      <ProfileSection title={`КОЧЕВЬЯ · ${nomads.length}`}>
        <ProfileScrollList>
          {nomads.length ? nomads.map((nomad) => (
            <ProfileLink key={nomad.id} title={nomad.name}
              onPress={() => router.push(nomadProfileRoute(nomad.id))} />
          )) : <ProfileFact>Сейчас этнос не входит в состав кочевий.</ProfileFact>}
        </ProfileScrollList>
      </ProfileSection>
    </>
  );
  return <ProfileLayout eyebrow="КАРТОЧКА ЭТНОСА" title={culture.name}
    subtitle="Этнос" details={details} chronicle={filterChronicle(snapshot.chronicle, references)} />;
}

const styles = {
  facts: { padding: 12, gap: 6, borderLeftWidth: 3, borderColor: '#bf2f1d', backgroundColor: '#f6f1e4' } as const,
};
