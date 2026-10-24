import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import colors, { fonts } from '@/constants/colors';
import type { Game, GameSnapshot } from '@/game/game';
import type { MapMode } from '@/game/render';

const c = colors.light;

export const MODES: { id: MapMode; label: string }[] = [
  { id: 'political', label: 'Страны' },
  { id: 'cities', label: 'Города' },
  { id: 'biomes', label: 'Биомы' },
  { id: 'rivers', label: 'Реки' },
  { id: 'cultures', label: 'Культуры' },
  { id: 'religions', label: 'Религии' },
  { id: 'nomads', label: 'Кочевья' },
  { id: 'humidity', label: 'Влажность' },
  { id: 'temperature', label: 'Температура' },
  { id: 'drainage', label: 'Дренаж' },
  { id: 'density', label: 'Население' },
];

export function ModeTabs({ game, snap }: { game: Game; snap: GameSnapshot }) {
  const [open, setOpen] = useState(false);
  const selected = MODES.find((mode) => mode.id === snap.mapMode);
  return (
    <View style={styles.anchor} testID="nav-modes">
      <Pressable
        onPress={() => setOpen((value) => !value)}
        style={styles.trigger}
        accessibilityRole="button"
        accessibilityLabel={`Режим карты: ${selected?.label ?? 'Страны'}`}
        accessibilityState={{ expanded: open }}
        testID="button-mode-picker"
      >
        <Feather name="map" size={18} color={c.secondaryForeground} />
        <Text style={styles.currentMode} numberOfLines={1}>{selected?.label ?? 'Страны'}</Text>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={14} color={c.secondaryForeground} />
      </Pressable>
      {open && (
        <View style={styles.menu}>
          <ScrollView nestedScrollEnabled>
            {MODES.map((mode) => {
              const active = snap.mapMode === mode.id;
              return (
                <Pressable
                  key={mode.id}
                  onPress={() => {
                    game.setMapMode(mode.id);
                    setOpen(false);
                  }}
                  style={[styles.option, active && styles.optionActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  testID={`button-mode-${mode.id}`}
                >
                  <Text style={[styles.optionText, active && styles.optionTextActive]}>{mode.label}</Text>
                  {active && <Feather name="check" size={15} color={c.primary} />}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: { position: 'relative', zIndex: 30 },
  trigger: { height: 38, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8 },
  currentMode: { maxWidth: 84, fontFamily: fonts.sansMedium, fontSize: 11, color: c.secondaryForeground },
  menu: {
    position: 'absolute',
    top: 42,
    left: 0,
    width: 210,
    maxHeight: 340,
    borderWidth: 1,
    borderColor: c.foreground,
    borderRadius: 5,
    backgroundColor: c.card,
    shadowColor: c.foreground,
    shadowOpacity: 0.24,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
    overflow: 'hidden',
  },
  option: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
  optionActive: { backgroundColor: c.secondary },
  optionText: { fontFamily: fonts.sans, fontSize: 13, color: c.foreground },
  optionTextActive: { fontFamily: fonts.sansSemiBold, color: c.primary },
});
