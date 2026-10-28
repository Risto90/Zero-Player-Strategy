import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Image, View } from 'react-native';
import { MAP_WIDTH } from '@/game/config';
import { useGameSnapshot } from '@/game/useGame';
import { currentGame } from '@/game/session';
import { chronicleObjectOptions, filterChronicle, chronicleReference } from '@/game/chronicle';
import { fmt, pct } from '@/game/format';
import { humanOriginShares } from '@/game/human';
import { cityComposition, cityRankName } from '@/game/settlements';
import { countryProfileRoute, cultureProfileRoute, religionProfileRoute } from '@/game/profileRoutes';
import { openProfile } from '@/game/profileNavigation';
import { MissingProfile, ProfileFact, ProfileLayout, ProfileLink, ProfileSection, ProfileScrollList } from '@/components/profiles/ProfileLayout';
import { OriginComposition } from '@/components/profiles/OriginComposition';
import { EmblemPreview } from '@/components/profiles/EmblemPreview';
import { EntityFlagLink, ProfileEntityList } from '@/components/profiles/EntityMarks';
import { CITY_ICON_SOURCES, cityIconIndex } from '@/components/map/cityIcons';

export default function CityPage() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const game = currentGame();
  const id = Number(rawId);
  if (!game || !Number.isInteger(id) || id < 0) return <MissingProfile title="Город не найден" />;
  const snapshot = useGameSnapshot(game);
  const historyObjectOptions = useMemo(
    () => chronicleObjectOptions(game.world),
    [game, game.world.version],
  );
  const city = game.world.cities.find((item) => item.id === id);
  if (!city) return <MissingProfile title="Город не найден" />;
  const country = game.world.countries[city.countryId];
  const composition = useMemo(() => cityComposition(game.world, city), [game, city, game.world.version]);
  const hasPort = game.world.isCoastal(city.pixel) || game.world.knownRivers[city.pixel] > 0;
  const cityIcon = CITY_ICON_SOURCES[cityIconIndex(city, hasPort)] ?? CITY_ICON_SOURCES[0];
  const details = (
    <>
      <View style={styles.identityRow} testID="city-identity-marks">
        {country?.emblemSpec
          ? <EntityFlagLink spec={country.emblemSpec} href={countryProfileRoute(country.id)}
            label={country.name} size={40} fit="height" />
          : <View style={styles.markPlaceholder} />}
        <Image source={cityIcon} style={styles.cityIcon} resizeMode="contain" accessibilityLabel={`Значок города ${city.name ?? 'Город'}`} />
        {city.emblemSpec
          ? <EmblemPreview spec={city.emblemSpec} label={`Герб ${city.name ?? 'города'}`} shape="coat" frameHeight={40} />
          : country?.emblemSpec
            ? <EntityFlagLink spec={country.emblemSpec} href={countryProfileRoute(country.id)}
              label={country.name} size={40} fit="height" />
            : <View style={styles.markPlaceholder} />}
      </View>
      <View style={styles.facts}>
        <ProfileFact>Ранг · {cityRankName(city.rank)}</ProfileFact>
        <ProfileFact>Население · {fmt(Math.round(city.population))} чел.</ProfileFact>
        <ProfileFact>Сельская плотность · {fmt(Math.round(game.world.density[city.pixel]))} чел. на участок</ProfileFact>
        <ProfileFact>Положение · x {city.pixel % MAP_WIDTH}, y {Math.floor(city.pixel / MAP_WIDTH)}</ProfileFact>
        <ProfileFact>{game.world.isCoastal(city.pixel) ? 'Побережье' : game.world.rivers[city.pixel] > 0 ? 'У реки' : 'Внутренний город'}{city.capital ? ' · столица' : ''}</ProfileFact>
      </View>
      <ProfileSection title="СТРАНА">
        {country ? (
          <ProfileEntityList items={[{
            kind: 'country',
            key: String(country.id),
            name: `${country.rank} ${country.name}`,
            spec: country.emblemSpec,
            href: countryProfileRoute(country.id),
          }]} />
        ) : <ProfileFact>Страна не найдена.</ProfileFact>}
      </ProfileSection>
      <ProfileSection title="ЭТНИЧЕСКИЙ СОСТАВ">
        <ProfileScrollList>
          {composition.cultures.length ? composition.cultures.map(({ id: cultureId, percent }) => (
            <ProfileLink key={cultureId} title={game.world.cultures[cultureId]?.name ?? 'Неизвестная культура'}
              note={pct(percent)} onPress={() => openProfile(cultureProfileRoute(cultureId))} />
          )) : <ProfileFact>Нет данных.</ProfileFact>}
        </ProfileScrollList>
      </ProfileSection>
      <ProfileSection title="РЕЛИГИОЗНЫЙ СОСТАВ">
        <ProfileEntityList items={composition.religions.map(({ id: religionId, percent }, index) => religionId === null
          ? { kind: 'atheists' as const, key: `atheists-${index}`, name: 'Атеисты', note: pct(percent) }
          : {
            kind: 'religion' as const,
            key: String(religionId),
            name: game.world.religions[religionId]?.name ?? 'Неизвестная вера',
            note: pct(percent),
            spec: game.world.religions[religionId]?.emblemSpec,
            href: religionProfileRoute(religionId),
          })} />
      </ProfileSection>
      <ProfileSection title="РАСЫ">
        <OriginComposition rows={composition.humanOrigins ? humanOriginShares(composition.humanOrigins) : null} />
      </ProfileSection>
    </>
  );
  return <ProfileLayout eyebrow="КАРТОЧКА ГОРОДА" title={city.name ?? 'Город'}
    subtitle={`${cityRankName(city.rank)}${city.capital ? ' · столица' : ''}`}
    details={details}
    chronicle={filterChronicle(snapshot.chronicle, [chronicleReference('city', city.chronicleId)])}
    archive={snapshot.chronicle}
    world={game.world}
    initialReference={chronicleReference('city', city.chronicleId)}
    objectOptions={historyObjectOptions}
  />;
}

const styles = {
  facts: { padding: 12, gap: 6, borderLeftWidth: 3, borderColor: '#bf2f1d', backgroundColor: '#f6f1e4' } as const,
  identityRow: { width: '100%' as const, flexDirection: 'row' as const, alignItems: 'center' as const, flexWrap: 'nowrap' as const, gap: 8 },
  cityIcon: { width: 40, height: 40, flexShrink: 0 },
  markPlaceholder: { width: 40, height: 40, flexShrink: 0 },
};
