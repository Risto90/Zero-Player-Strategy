import { LinearGradient } from 'expo-linear-gradient';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import colors, { fonts } from '@/constants/colors';
import type { Game, GameSnapshot, LegendRow } from '@/game/game';
import { CITY_COLORS, RAMPS } from '@/game/render';
import type { MapMode } from '@/game/render';
import { cityRankName } from '@/game/settlements';
import type { CityRank } from '@/game/world';

const c = colors.light;

const MODE_LABELS: Record<MapMode, string> = {
  political: 'Страны',
  biomes: 'Биомы',
  cultures: 'Культуры',
  religions: 'Религии',
  humidity: 'Влажность',
  temperature: 'Температура',
  drainage: 'Дренаж',
  density: 'Плотность',
  rivers: 'Реки',
  colonization: 'Колонизация',
  cities: 'Города',
  nomads: 'Кочевья',
};

function ColorKeys({ rows }: { rows: LegendRow[] }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.keys}>
      {rows.map((row) => (
        <View key={row.id} style={styles.key}>
          <View style={[styles.swatch, { backgroundColor: row.color }]} />
          <Text style={styles.keyText} numberOfLines={1}>{row.name}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function BiomeTable({ rows }: { rows: LegendRow[] }) {
  return (
    <View style={styles.biomeTable} testID="biome-legend-table">
      {rows.map((row) => (
        <View key={row.id} style={styles.biomeCell}>
          <View
            style={[styles.biomeSwatch, { backgroundColor: row.color }]}
            accessibilityLabel={`Цвет: ${row.name}`}
          />
          <Text style={styles.biomeLabel}>{row.name}</Text>
        </View>
      ))}
    </View>
  );
}

function LegendContents({ game, snap }: { game: Game; snap: GameSnapshot }) {
  switch (snap.mapMode) {
    case 'political':
      return <ColorKeys rows={snap.legend.countries} />;
    case 'cultures':
      return <ColorKeys rows={snap.legend.cultures} />;
    case 'religions':
      return <ColorKeys rows={snap.legend.religions} />;
    case 'biomes':
      return <BiomeTable rows={snap.legend.biomes} />;
    case 'humidity':
    case 'temperature':
    case 'drainage':
    case 'density':
      return (
        <View style={styles.rampContents}>
          <Text style={styles.scaleLabel}>Меньше</Text>
          <LinearGradient
            colors={RAMPS[snap.mapMode] as [string, string, ...string[]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.ramp}
          />
          <Text style={styles.scaleLabel}>Больше</Text>
        </View>
      );
    case 'rivers':
      return (
        <View style={styles.fixedKeys}>
          <View style={styles.key}>
            <View style={[styles.riverSwatch, { backgroundColor: '#6699ae' }]} />
            <Text style={styles.keyText}>Притоки</Text>
          </View>
          <View style={styles.key}>
            <View style={[styles.riverSwatch, { backgroundColor: '#22537d' }]} />
            <Text style={styles.keyText}>Крупные реки</Text>
          </View>
        </View>
      );
    case 'colonization':
      return (
        <View style={styles.key}>
          <View style={[styles.swatch, { backgroundColor: '#89ab76' }]} />
          <Text style={styles.keyText}>Доступные земли</Text>
        </View>
      );
    case 'cities':
      return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.keys}>
          {CITY_COLORS.map((color, index) => (
            <View key={color} style={styles.key}>
              <View style={[styles.swatch, { backgroundColor: color }]} />
              <Text style={styles.keyText} numberOfLines={1}>{cityRankName((index + 1) as CityRank)}</Text>
            </View>
          ))}
        </ScrollView>
      );
    case 'nomads': {
      const rows = snap.legend.countries.filter((row) => game.world.countries[row.id]?.type === 'nomadic');
      return rows.length ? <ColorKeys rows={rows} /> : <Text style={styles.description}>Цвет — кочевая страна</Text>;
    }
  }
}

export function MapLegend({ game, snap }: { game: Game; snap: GameSnapshot }) {
  return (
    <View
      pointerEvents="none"
      style={styles.panel}
      accessibilityLabel={`Легенда карты: ${MODE_LABELS[snap.mapMode]}`}
      testID="temporary-map-legend"
    >
      <Text style={styles.title}>{MODE_LABELS[snap.mapMode]}</Text>
      <LegendContents game={game} snap={snap} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 52,
    alignSelf: 'center',
    maxWidth: 620,
    minHeight: 38,
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    borderRadius: 5,
    backgroundColor: 'rgba(0,0,0,0.78)',
    elevation: 3,
  },
  title: { fontFamily: fonts.sansSemiBold, fontSize: 9, lineHeight: 11, color: c.secondaryForeground },
  keys: { alignItems: 'center', gap: 12 },
  fixedKeys: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  key: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 180 },
  keyText: { flexShrink: 1, fontFamily: fonts.sans, fontSize: 9, color: c.secondaryForeground },
  swatch: { width: 10, height: 10, borderWidth: 1, borderColor: 'rgba(44,30,23,0.5)', borderRadius: 2 },
  biomeTable: { width: '100%', flexDirection: 'row', alignItems: 'stretch' },
  biomeCell: { flex: 1, minWidth: 0, alignItems: 'center', gap: 2 },
  biomeSwatch: { width: '100%', height: 9, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  biomeLabel: {
    alignSelf: 'stretch',
    flexShrink: 1,
    fontFamily: fonts.sans,
    fontSize: 7,
    lineHeight: 8,
    textAlign: 'center',
    color: c.secondaryForeground,
  },
  rampContents: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ramp: { flex: 1, height: 8, borderWidth: 1, borderColor: 'rgba(44,30,23,0.35)', borderRadius: 2 },
  scaleLabel: { fontFamily: fonts.sans, fontSize: 8, color: c.secondaryForeground },
  riverSwatch: { width: 16, height: 3, borderRadius: 2 },
  description: { fontFamily: fonts.sans, fontSize: 9, color: c.secondaryForeground },
});
