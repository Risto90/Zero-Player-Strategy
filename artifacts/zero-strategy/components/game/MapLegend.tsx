import { LinearGradient } from 'expo-linear-gradient';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import colors, { fonts } from '@/constants/colors';
import { BIOMES } from '@/game/config';
import { fmt } from '@/game/format';
import type { Game, GameSnapshot } from '@/game/game';
import { RAMPS } from '@/game/render';

const c = colors.light;

const CLIMATE_TITLES: Partial<Record<GameSnapshot['mapMode'], string>> = {
  humidity: 'Влажность',
  temperature: 'Температура',
  drainage: 'Дренаж',
  density: 'Население',
};

export function MapLegend({ game, snap }: { game: Game; snap: GameSnapshot }) {
  const mode = snap.mapMode;
  if (mode === 'biomes') {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.items} testID="compact-legend-biomes">
        {BIOMES.map((biome) => (
          <View key={biome.id} style={styles.item}>
            <View style={[styles.swatch, { backgroundColor: biome.color }]} />
            <Text style={styles.label}>{biome.name}</Text>
          </View>
        ))}
      </ScrollView>
    );
  }

  const climateTitle = CLIMATE_TITLES[mode];
  if (climateTitle) {
    const stops = RAMPS[mode as keyof typeof RAMPS];
    return (
      <View style={styles.climate} testID={`compact-legend-${mode}`}>
        <Text style={styles.title}>{climateTitle}</Text>
        <View style={styles.scale}>
          <LinearGradient colors={stops as [string, string, ...string[]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
        </View>
        <Text style={styles.range}>0—100</Text>
        {mode === 'density' && <Text style={styles.total}>{fmt(snap.legend.totalPopulation)} чел.</Text>}
      </View>
    );
  }

  let summary = '';
  if (mode === 'political') summary = `${snap.legend.countries.length} стран · ${fmt(snap.legend.totalPopulation)} чел.`;
  else if (mode === 'cultures') summary = `${snap.legend.cultures.length} культур`;
  else if (mode === 'religions') summary = `${snap.legend.religions.length} вер · ${fmt(snap.legend.nonBelievers.value)} атеистов`;
  else if (mode === 'cities') summary = `${fmt(game.world.cities.length)} городов`;
  else if (mode === 'nomads') summary = `${fmt(game.world.nomads.length)} народов · ареалы перекрываются`;
  else if (mode === 'rivers') summary = 'Реки и притоки';
  else if (mode === 'colonization') summary = 'Доступные области';

  return (
    <View style={styles.summary} testID="compact-legend-summary">
      <Text style={styles.title}>{mode === 'political' ? 'Страны' : mode === 'cultures' ? 'Культуры' : mode === 'religions' ? 'Религии' : mode === 'cities' ? 'Города' : mode === 'nomads' ? 'Кочевья' : mode === 'rivers' ? 'Реки' : 'Колонизация'}</Text>
      <Text style={styles.range} numberOfLines={1}>{summary}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  items: { alignItems: 'center', gap: 12, paddingHorizontal: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  swatch: { width: 11, height: 11, borderRadius: 2, borderWidth: 1, borderColor: c.border },
  label: { fontFamily: fonts.sans, fontSize: 10, color: c.foreground },
  climate: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10 },
  scale: { height: 9, flex: 1, borderRadius: 2, overflow: 'hidden', backgroundColor: c.muted },
  summary: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10 },
  title: { fontFamily: fonts.sansSemiBold, fontSize: 11, color: c.foreground },
  range: { fontFamily: fonts.mono, fontSize: 10, color: c.mutedForeground },
  total: { fontFamily: fonts.sans, fontSize: 9, color: c.mutedForeground },
});
