import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors, { fonts } from '@/constants/colors';
import { MODIFIERS, personDeathStatus } from '@/game/government';
import { currentGame } from '@/game/session';
import { useGameSnapshot } from '@/game/useGame';

const c = colors.light;

export default function NomadPage() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const game = currentGame();
  const insets = useSafeAreaInsets();
  if (!game) return <View style={[styles.screen, styles.center]}><Text style={styles.title}>Игра не найдена</Text></View>;
  return <NomadDetails game={game} id={Number(rawId)} top={insets.top} />;
}

function NomadDetails({ game, id, top }: { game: NonNullable<ReturnType<typeof currentGame>>; id: number; top: number }) {
  useGameSnapshot(game);
  const nomad = game.world.nomads.find((group) => group.id === id);
  if (!nomad) return (
    <View style={[styles.screen, styles.center, { paddingTop: top }]}>
      <Text style={styles.title}>Кочевье не найдено</Text>
      <Pressable onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>Назад</Text></Pressable>
    </View>
  );
  const population = nomad.cells.reduce((sum, cell) => sum + cell.population, 0);
  const cultureTotals = new Map<number, number>();
  const religionTotals = new Map<number, number>();
  let atheistPopulation = 0;
  for (const cell of nomad.cells) {
    const cultures = game.world.cultureTable.entries[cell.cultureMix];
    cultures.ids.forEach((cultureId, index) =>
      cultureTotals.set(cultureId, (cultureTotals.get(cultureId) ?? 0) + cell.population * cultures.shares[index] / 100),
    );
    const religions = game.world.religionTable.entries[cell.religionMix];
    religions.ids.forEach((religionId, index) =>
      religionTotals.set(religionId, (religionTotals.get(religionId) ?? 0) + cell.population * religions.total / 100 * religions.shares[index] / 100),
    );
    atheistPopulation += cell.population * (100 - religions.total) / 100;
  }
  const compositionLines = (parts: Map<number, number>, name: (id: number) => string) =>
    [...parts.entries()].sort((a, b) => b[1] - a[1]).map(([partId, amount]) =>
      `${name(partId)} · ${Math.round(amount / Math.max(population, 1) * 100)}%`,
    );
  const religions = [
    ...compositionLines(religionTotals, (religionId) => game.world.religions[religionId]?.name ?? 'неизвестная вера'),
    ...(atheistPopulation > 0 ? [`Атеисты · ${Math.round(atheistPopulation / Math.max(population, 1) * 100)}%`] : []),
  ];
  return (
    <View style={[styles.screen, { paddingTop: top }]}>
      <Pressable onPress={() => router.back()} style={styles.back}>
        <Feather name="arrow-left" size={16} color={c.foreground} />
        <Text style={styles.backText}>Назад</Text>
      </Pressable>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>КОЧЕВЬЕ</Text>
        <Text style={styles.title}>{nomad.name}</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Культура</Text>
          {compositionLines(cultureTotals, (cultureId) => game.world.cultures[cultureId]?.name ?? 'неизвестная культура').map((line) => (
            <Text key={line} style={styles.value}>{line}</Text>
          ))}
          <Text style={styles.label}>Религиозный состав</Text>
          {religions.length ? religions.map((line) => <Text key={line} style={styles.value}>{line}</Text>) : <Text style={styles.value}>Атеисты</Text>}
          <Text style={styles.label}>Население кочевья</Text>
          <Text style={styles.value}>{Math.round(population).toLocaleString('ru-RU')} чел.</Text>
          <Text style={styles.label}>Форма правления</Text>
          <Text style={styles.value}>Племенная</Text>
          {nomad.modifiers.length > 0 && <>
            <Text style={styles.label}>Модификаторы</Text>
            {nomad.modifiers.map((modifier) => <Text key={modifier} style={styles.value}>{MODIFIERS[modifier]?.name ?? modifier}</Text>)}
          </>}
          <Text style={styles.label}>Правитель</Text>
          <Pressable onPress={() => router.push({ pathname: '/person/[id]', params: { id: String(nomad.ruler.id) } })}>
            <Text style={styles.person}>{nomad.ruler.name} · {nomad.ruler.age} лет{personDeathStatus(nomad.ruler) ? ` · ${personDeathStatus(nomad.ruler)}` : ''}</Text>
          </Pressable>
          {nomad.heir && <>
            <Text style={styles.label}>Ожидаемый наследник</Text>
            <Pressable onPress={() => router.push({ pathname: '/person/[id]', params: { id: String(nomad.heir!.id) } })}>
              <Text style={styles.person}>{nomad.heir.name} · {nomad.heir.age} лет{personDeathStatus(nomad.heir) ? ` · ${personDeathStatus(nomad.heir)}` : ''}</Text>
            </Pressable>
          </>}
          <Text style={styles.label}>Ареал</Text>
          <Text style={styles.value}>{nomad.pixels.toLocaleString('ru-RU')} земель; может пересекаться с государствами и другими кочевьями.</Text>
          {nomad.sourceCountryId !== null && <Text style={styles.note}>Происхождение: {game.world.countries[nomad.sourceCountryId]?.name ?? 'распущенное государство'}.</Text>}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background },
  center: { alignItems: 'center', justifyContent: 'center', padding: 20 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: c.border },
  backText: { color: c.foreground, fontFamily: fonts.sansMedium, fontSize: 13 },
  content: { padding: 20, gap: 12 },
  eyebrow: { color: c.primary, fontFamily: fonts.sansSemiBold, fontSize: 10, letterSpacing: 1.4 },
  title: { color: c.foreground, fontFamily: fonts.display, fontSize: 27 },
  card: { borderWidth: 1, borderColor: c.border, borderRadius: 6, backgroundColor: c.card, padding: 16, gap: 6 },
  label: { marginTop: 8, color: c.primary, fontFamily: fonts.sansSemiBold, fontSize: 10, letterSpacing: 1 },
  value: { color: c.foreground, fontFamily: fonts.sans, fontSize: 14, lineHeight: 20 },
  person: { color: c.accent, fontFamily: fonts.sansSemiBold, fontSize: 14, lineHeight: 20, textDecorationLine: 'underline' },
  note: { color: c.mutedForeground, fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, marginTop: 8 },
});
