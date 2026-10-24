import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';
import { MAP_WIDTH } from '@/game/config';
import { useGameSnapshot } from '@/game/useGame';
import { currentGame } from '@/game/session';
import { filterChronicle, chronicleReference } from '@/game/chronicle';
import { fmt, pct } from '@/game/format';
import { cityComposition, cityRankName } from '@/game/settlements';
import { countryProfileRoute, cultureProfileRoute, religionProfileRoute } from '@/game/profileRoutes';
import { MissingProfile, ProfileFact, ProfileLayout, ProfileLink, ProfileSection, ProfileScrollList } from '@/components/profiles/ProfileLayout';

export default function CityPage() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const game = currentGame();
  const id = Number(rawId);
  if (!game || !Number.isInteger(id) || id < 0) return <MissingProfile title="Город не найден" />;
  const snapshot = useGameSnapshot(game);
  const city = game.world.cities.find((item) => item.id === id);
  if (!city) return <MissingProfile title="Город не найден" />;
  const country = game.world.countries[city.countryId];
  const composition = useMemo(() => cityComposition(game.world, city), [game, city, game.world.version]);
  const details = (
    <>
      <View style={styles.facts}>
        <ProfileFact>Ранг · {cityRankName(city.rank)}</ProfileFact>
        <ProfileFact>Население · {fmt(Math.round(city.population))} чел.</ProfileFact>
        <ProfileFact>Сельская плотность · {fmt(Math.round(game.world.density[city.pixel]))} чел. на участок</ProfileFact>
        <ProfileFact>Положение · x {city.pixel % MAP_WIDTH}, y {Math.floor(city.pixel / MAP_WIDTH)}</ProfileFact>
        <ProfileFact>{game.world.isCoastal(city.pixel) ? 'Побережье' : game.world.rivers[city.pixel] > 0 ? 'У реки' : 'Внутренний город'}{city.capital ? ' · столица' : ''}</ProfileFact>
      </View>
      <ProfileSection title="СТРАНА">
        {country ? (
          <ProfileLink title={`${country.rank} ${country.name}`} onPress={() => router.push(countryProfileRoute(country.id))} />
        ) : <ProfileFact>Страна не найдена.</ProfileFact>}
      </ProfileSection>
      <ProfileSection title="ЭТНИЧЕСКИЙ СОСТАВ">
        <ProfileScrollList>
          {composition.cultures.length ? composition.cultures.map(({ id: cultureId, percent }) => (
            <ProfileLink key={cultureId} title={game.world.cultures[cultureId]?.name ?? 'Неизвестная культура'}
              note={pct(percent)} onPress={() => router.push(cultureProfileRoute(cultureId))} />
          )) : <ProfileFact>Нет данных.</ProfileFact>}
        </ProfileScrollList>
      </ProfileSection>
      <ProfileSection title="РЕЛИГИОЗНЫЙ СОСТАВ">
        <ProfileScrollList>
          {composition.religions.length ? composition.religions.map(({ id: religionId, percent }) => religionId === null ? (
            <ProfileFact key="atheists">Атеисты · {pct(percent)}</ProfileFact>
          ) : (
            <ProfileLink key={religionId} title={game.world.religions[religionId]?.name ?? 'Неизвестная вера'}
              note={pct(percent)} onPress={() => router.push(religionProfileRoute(religionId))} />
          )) : <ProfileFact>Нет данных.</ProfileFact>}
        </ProfileScrollList>
      </ProfileSection>
    </>
  );
  return <ProfileLayout eyebrow="КАРТОЧКА ГОРОДА" title={city.name ?? 'Город'}
    subtitle={`${cityRankName(city.rank)}${city.capital ? ' · столица' : ''}`}
    details={details} chronicle={filterChronicle(snapshot.chronicle, [chronicleReference('city', city.id)])} />;
}

const styles = {
  facts: { padding: 12, gap: 6, borderLeftWidth: 3, borderColor: '#bf2f1d', backgroundColor: '#f6f1e4' } as const,
};
