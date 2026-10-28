import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useGameSnapshot } from '@/game/useGame';
import { currentGame } from '@/game/session';
import { chronicleObjectOptions, filterChronicle, chronicleReference } from '@/game/chronicle';
import { fmt } from '@/game/format';
import { cityComposition } from '@/game/settlements';
import { countryProfileRoute, cultureProfileRoute } from '@/game/profileRoutes';
import { openProfile } from '@/game/profileNavigation';
import { MissingProfile, ProfileFact, ProfileLayout, ProfileLink, ProfileSection } from '@/components/profiles/ProfileLayout';
import { ProfileEntityList } from '@/components/profiles/EntityMarks';

export default function CulturePage() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const game = currentGame();
  const id = Number(rawId);
  if (!game || !Number.isInteger(id) || id < 0) return <MissingProfile title="Этнос не найден" />;
  const snapshot = useGameSnapshot(game);
  const historyObjectOptions = useMemo(
    () => chronicleObjectOptions(game.world),
    [game, game.world.version],
  );
  const culture = game.world.cultures[id];
  if (!culture) return <MissingProfile title="Этнос не найден" />;
  const { countries, cities, branches } = useMemo(() => ({
    countries: game.world.countries.filter((country) =>
      (country.pixels > 0 || (country.type === 'nomadic' && !!country.range?.length)) &&
      game.countryComposition(country.id).cultures.some((group) => group.id === id)),
    cities: game.world.cities.filter((city) => cityComposition(game.world, city).cultures.some((group) => group.id === id)),
    branches: game.world.cultures.filter((child) => child.parentId === id),
  }), [game, id, game.world.version]);
  const population = snapshot.legend.cultures.find((row) => row.id === id)?.value ?? 0;
  const details = (
    <>
      <View style={styles.facts}>
        <ProfileFact><Text style={{ color: culture.color }}>■ </Text>Население · {fmt(population)} чел.</ProfileFact>
        <ProfileFact>Основан(а) в {culture.foundedYear} году</ProfileFact>
        {culture.styleProfile && (
          <ProfileFact>Стиль флага · профиль {culture.styleProfile.profileId}, эпоха {culture.styleProfile.era}</ProfileFact>
        )}
        {culture.styleProfile?.tags.length ? <ProfileFact>Теги стиля · {culture.styleProfile.tags.join(', ')}</ProfileFact> : null}
        {culture.traits?.length ? <ProfileFact>Черты · {culture.traits.join(', ')}</ProfileFact> : null}
      </View>
      <ProfileSection title="РОДСТВО">
        {culture.parentId !== null && game.world.cultures[culture.parentId] && (
          <ProfileLink title={`${game.world.cultures[culture.parentId].name} · исходный этнос`}
            onPress={() => openProfile(cultureProfileRoute(culture.parentId!))} />
        )}
        {branches.length ? branches.map((child) => (
          <ProfileLink key={child.id} title={`${child.name} · ветвь`}
            onPress={() => openProfile(cultureProfileRoute(child.id))} />
        )) : <ProfileFact>Другие ветви не зарегистрированы.</ProfileFact>}
      </ProfileSection>
      <ProfileSection title={`СТРАНЫ · ${countries.length}`}>
        <ProfileEntityList emptyText="Сейчас этнос не входит в состав стран." items={countries.map((country) => ({
          kind: 'country' as const,
          key: String(country.id),
          name: `${country.rank} ${country.name}`,
          spec: country.emblemSpec,
          href: countryProfileRoute(country.id),
        }))} />
      </ProfileSection>
      <ProfileSection title={`ГОРОДА · ${cities.length}`}>
        <ProfileEntityList emptyText="Городов нет." items={cities.map((city) => ({
          kind: 'city' as const,
          key: String(city.id),
          city,
          hasPort: game.world.isCoastal(city.pixel) || game.world.knownRivers[city.pixel] > 0,
          country: game.world.countries[city.countryId],
        }))} />
      </ProfileSection>
    </>
  );
  return <ProfileLayout eyebrow="КАРТОЧКА ЭТНОСА" title={culture.name}
    subtitle="Этнос" details={details}
    chronicle={filterChronicle(snapshot.chronicle, [chronicleReference('culture', culture.id)])}
    archive={snapshot.chronicle}
    world={game.world}
    initialReference={chronicleReference('culture', culture.id)}
    objectOptions={historyObjectOptions}
  />;
}

const styles = {
  facts: { padding: 12, gap: 6, borderLeftWidth: 3, borderColor: '#bf2f1d', backgroundColor: '#f6f1e4' } as const,
};
