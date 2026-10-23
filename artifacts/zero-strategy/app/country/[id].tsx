import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors, { fonts } from '@/constants/colors';
import { fmt, pct } from '@/game/format';
import { ageStage, GOVERNMENTS, MODIFIERS } from '@/game/government';
import { currentGame } from '@/game/session';
import { useGameSnapshot } from '@/game/useGame';
import { expectedHeirFor, rulers } from '@/game/succession';
import type { Game } from '@/game/game';

const c = colors.light;

export default function CountryPage() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const game = currentGame();
  const insets = useSafeAreaInsets();
  if (!game) {
    return <View style={[styles.screen, styles.center, { paddingTop: insets.top }]}><Text style={styles.title}>Игра не открыта</Text></View>;
  }
  return <CountryProfile game={game} countryId={Number(rawId)} />;
}

function CountryProfile({ game, countryId }: { game: Game; countryId: number }) {
  useGameSnapshot(game);
  const insets = useSafeAreaInsets();
  const country = game.world.countries[countryId];
  if (!country) {
    return (
      <View style={[styles.screen, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.title}>Страна не найдена</Text>
        <Pressable onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>Назад</Text></Pressable>
      </View>
    );
  }
  const composition = game.countryComposition(country.id);
  const cities = game.world.cities.filter((city) => city.countryId === country.id);
  const countryNomads = game.world.nomads.map((nomad) => {
    let overlap = 0;
    for (const pixel of nomad.range) if (game.world.owner[pixel] === country.id + 1) overlap += 1;
    return { nomad, overlap };
  }).filter(({ overlap }) => overlap > 0);

  const personLink = (personId: number, name: string, note?: string) => (
    <Pressable key={`${personId}-${name}`} onPress={() => router.push({ pathname: '/person/[id]', params: { id: String(personId) } })} style={styles.linkRow}>
      <Text style={styles.link}>{name}</Text>
      {note && <Text style={styles.note}>{note}</Text>}
    </Pressable>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Feather name="arrow-left" size={18} color={c.foreground} />
          <Text style={styles.backText}>Назад</Text>
        </Pressable>
        <Text style={styles.eyebrow}>КАРТОЧКА СТРАНЫ</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <Text style={styles.title}>{country.name}</Text>
        <Text style={styles.subtitle}>{country.rank} · основана в {country.foundedYear} году</Text>
        <View style={styles.facts}>
          <Text style={styles.fact}>Площадь · {fmt(country.pixels)} земель</Text>
          <Text style={styles.fact}>Население · {fmt(composition.population)} чел.</Text>
          <Text style={styles.fact}>Форма правления · {GOVERNMENTS[country.government].name}</Text>
          {country.modifiers.map((modifier) => (
            <Text key={modifier} style={styles.note}>· {modifier === 'consulate' ? `Консулат ${country.consulCount}` : MODIFIERS[modifier].name}: {MODIFIERS[modifier].effect}</Text>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{country.modifiers.includes('consulate') ? 'ПРАВИТЕЛИ' : 'ПРАВИТЕЛЬ'}</Text>
          {(country.modifiers.includes('consulate') ? rulers(game.world, country) : [country.ruler]).map((leader) => (
            <View key={leader.id}>
              {personLink(leader.id, leader.name, `${leader.age} лет · ${ageStage(leader.age)}`)}
              {country.heir && !country.modifiers.includes('consulate') &&
                personLink(country.heir.id, `Ожидаемый наследник · ${country.heir.name}`, `${country.heir.age} лет · ${ageStage(country.heir.age)}`)}
              {country.modifiers.includes('consulate') && (() => {
                const heir = expectedHeirFor(game.world, country, leader);
                return heir ? personLink(heir.id, `Наследник консула · ${heir.name}`, `${heir.age} лет · ${ageStage(heir.age)}`) : null;
              })()}
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ЭТНИЧЕСКИЙ СОСТАВ</Text>
          {composition.cultures.map((group) => (
            <Text key={group.id} style={styles.fact}><Text style={{ color: group.color }}>■ </Text>{group.name} · {pct(group.percent)}</Text>
          ))}
          <Text style={styles.sectionTitle}>РЕЛИГИОЗНЫЙ СОСТАВ</Text>
          {composition.religions.map((group) => (
            <Text key={group.id ?? 'atheists'} style={styles.fact}><Text style={{ color: group.color }}>■ </Text>{group.name} · {pct(group.percent)}</Text>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ГОРОДА · {cities.length}</Text>
          {cities.map((city) => (
            <Text key={city.id} style={styles.fact}>
              {city.capital ? 'Столица · ' : ''}{city.name ?? 'Город'} · {['городок', 'город', 'вольный город', 'полис', 'мегаполис', 'конгломерация'][city.rank - 1]} · город {fmt(Math.round(city.population))} чел. · сельская плотность {fmt(Math.round(game.world.density[city.pixel]))}
            </Text>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>КОЧЕВЬЯ НА ТЕРРИТОРИИ</Text>
          {countryNomads.map(({ nomad, overlap }) => (
            <Pressable key={nomad.id} onPress={() => router.push({ pathname: '/nomad/[id]', params: { id: String(nomad.id) } })} style={styles.linkRow}>
              <Text style={styles.link}>{nomad.name}</Text>
              <Text style={styles.note}>{overlap === nomad.range.length ? 'полностью' : 'частично'}</Text>
            </Pressable>
          ))}
          {!countryNomads.length && <Text style={styles.note}>Нет кочевий.</Text>}
        </View>

        <Pressable onPress={() => {
          game.showCountryOnMap(country.id);
          router.replace('/play');
        }} style={styles.mapButton}>
          <Feather name="map" size={16} color={c.primaryForeground} />
          <Text style={styles.mapButtonText}>Показать на карте</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16 },
  header: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, borderBottomWidth: 2, borderColor: c.foreground },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  backText: { fontFamily: fonts.sansMedium, fontSize: 13, color: c.foreground },
  eyebrow: { marginLeft: 'auto', fontFamily: fonts.sansSemiBold, fontSize: 10, letterSpacing: 1.6, color: c.primary },
  content: { padding: 18, gap: 14 },
  title: { fontFamily: fonts.display, fontSize: 30, color: c.foreground },
  subtitle: { marginTop: -12, fontFamily: fonts.sans, fontSize: 13, color: c.mutedForeground },
  facts: { padding: 12, gap: 6, borderLeftWidth: 3, borderColor: c.primary, backgroundColor: c.card },
  fact: { fontFamily: fonts.sans, fontSize: 13, color: c.foreground },
  note: { fontFamily: fonts.sans, fontSize: 12, color: c.mutedForeground },
  section: { paddingTop: 8, gap: 5, borderTopWidth: 1, borderColor: c.border },
  sectionTitle: { marginBottom: 3, fontFamily: fonts.sansSemiBold, fontSize: 11, letterSpacing: 1.4, color: c.primary },
  linkRow: { paddingVertical: 5, borderBottomWidth: 1, borderColor: c.border },
  link: { fontFamily: fonts.sansSemiBold, fontSize: 14, color: c.accent, textDecorationLine: 'underline' },
  mapButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: c.primary },
  mapButtonText: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: c.primaryForeground },
});
