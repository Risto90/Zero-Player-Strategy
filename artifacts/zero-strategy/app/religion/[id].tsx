import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useGameSnapshot } from '@/game/useGame';
import { currentGame } from '@/game/session';
import { chronicleObjectOptions, filterChronicle, chronicleReference } from '@/game/chronicle';
import { fmt } from '@/game/format';
import { cityComposition } from '@/game/settlements';
import { countryProfileRoute, religionProfileRoute } from '@/game/profileRoutes';
import { MissingProfile, ProfileFact, ProfileIntro, ProfileLayout, ProfileSection } from '@/components/profiles/ProfileLayout';
import { EmblemPreview } from '@/components/profiles/EmblemPreview';
import { ProfileEntityList } from '@/components/profiles/EntityMarks';

export default function ReligionPage() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const game = currentGame();
  const id = Number(rawId);
  if (!game || !Number.isInteger(id) || id < 0) return <MissingProfile title="Религия не найдена" />;
  const snapshot = useGameSnapshot(game);
  const historyObjectOptions = useMemo(
    () => chronicleObjectOptions(game.world),
    [game, game.world.version],
  );
  const religion = game.world.religions[id];
  if (!religion) return <MissingProfile title="Религия не найдена" />;
  const { countries, cities, branches } = useMemo(() => ({
    countries: game.world.countries.filter((country) =>
      (country.pixels > 0 || (country.type === 'nomadic' && !!country.range?.length)) &&
      game.countryComposition(country.id).religions.some((group) => group.id === id)),
    cities: game.world.cities.filter((city) => cityComposition(game.world, city).religions.some((group) => group.id === id)),
    branches: game.world.religions.filter((child) => child.parentId === id),
  }), [game, id, game.world.version]);
  const population = snapshot.legend.religions.find((row) => row.id === id)?.value ?? 0;
  const relationItems = [
    ...(religion.parentId !== null && game.world.religions[religion.parentId] ? [{
      kind: 'religion' as const,
      key: `parent-${religion.parentId}`,
      name: game.world.religions[religion.parentId].name,
      note: 'Исходная вера',
      spec: game.world.religions[religion.parentId].emblemSpec,
      href: religionProfileRoute(religion.parentId),
    }] : []),
    ...branches.map((child) => ({
      kind: 'religion' as const,
      key: `branch-${child.id}`,
      name: child.name,
      note: 'Ветвь',
      spec: child.emblemSpec,
      href: religionProfileRoute(child.id),
    })),
  ];
  const details = (
    <>
      <ProfileIntro mark={<EmblemPreview spec={religion.emblemSpec} label={`Флаг ${religion.name}`} />}>
        <View style={styles.facts}>
          <ProfileFact><Text style={{ color: religion.color }}>■ </Text>Население · {fmt(population)} чел.</ProfileFact>
          <ProfileFact>Возникла в {religion.foundedYear} году</ProfileFact>
          {religion.styleProfile && (
            <ProfileFact>Стилевой профиль · {religion.styleProfile.profileId}, эпоха {religion.styleProfile.era}</ProfileFact>
          )}
          {religion.traits?.length ? <ProfileFact>Традиции · {religion.traits.join(', ')}</ProfileFact> : null}
        </View>
      </ProfileIntro>
      <ProfileSection title="РОДСТВО">
        <ProfileEntityList items={relationItems} emptyText="Другие ветви не зарегистрированы." />
      </ProfileSection>
      <ProfileSection title={`СТРАНЫ · ${countries.length}`}>
        <ProfileEntityList emptyText="Сейчас вера не входит в состав стран." items={countries.map((country) => ({
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
  return <ProfileLayout eyebrow="КАРТОЧКА РЕЛИГИИ" title={religion.name}
    subtitle="Религия" details={details}
    chronicle={filterChronicle(snapshot.chronicle, [chronicleReference('religion', religion.id)])}
    archive={snapshot.chronicle}
    world={game.world}
    initialReference={chronicleReference('religion', religion.id)}
    objectOptions={historyObjectOptions}
  />;
}

const styles = {
  facts: { padding: 12, gap: 6, borderLeftWidth: 3, borderColor: '#bf2f1d', backgroundColor: '#f6f1e4' } as const,
};
