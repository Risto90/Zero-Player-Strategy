import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import colors, { fonts } from '@/constants/colors';
import type { Game, GameSnapshot } from '@/game/game';
import type { MapMode } from '@/game/render';

const c = colors.light;

export const MODES: { id: MapMode; label: string }[] = [
  { id: 'political', label: 'Страны' },
  { id: 'biomes', label: 'Биомы' },
  { id: 'rivers', label: 'Реки' },
  { id: 'cultures', label: 'Культуры' },
  { id: 'religions', label: 'Религии' },
  { id: 'humidity', label: 'Влажность' },
  { id: 'temperature', label: 'Температура' },
  { id: 'drainage', label: 'Дренаж' },
  { id: 'density', label: 'Население' },
  { id: 'colonization', label: 'Колонизация' },
];

export function ModeTabs({ game, snap }: { game: Game; snap: GameSnapshot }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bar} contentContainerStyle={styles.content} testID="nav-modes">
      {MODES.filter((m) => m.id !== 'colonization' || snap.card?.type === 'colonization').map((m) => {
        const active = snap.mapMode === m.id;
        return (
          <Pressable key={m.id} onPress={() => game.setMapMode(m.id)} style={[styles.tab, active && { backgroundColor: c.primary }]} testID={`button-mode-${m.id}`}>
            <Text style={[styles.label, active && { color: c.primaryForeground, opacity: 1 }]}>{m.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bar: { flexGrow: 0, backgroundColor: c.secondary, borderTopWidth: 2, borderBottomWidth: 2, borderColor: c.foreground },
  content: { gap: 4, paddingHorizontal: 6, paddingVertical: 6 },
  tab: { borderRadius: 4, paddingHorizontal: 10, paddingVertical: 5 },
  label: { fontFamily: fonts.sansMedium, fontSize: 12.5, color: c.secondaryForeground, opacity: 0.78 },
});
