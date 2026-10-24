import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import colors, { fonts } from '@/constants/colors';
import { pct } from '@/game/format';
import type { HumanOriginShare } from '@/game/human';
import { raceProfileRoute } from '@/game/profileRoutes';

const c = colors.light;

export function OriginComposition({ rows }: { rows: HumanOriginShare[] | null }) {
  return (
    <View style={styles.list} testID="human-origin-composition">
      {rows?.length
        ? rows.map((row) => (
          <Pressable key={row.id} onPress={() => router.push(raceProfileRoute(row.id))}
            accessibilityRole="link" accessibilityLabel={`Открыть карточку расы: ${row.name}`}
            style={styles.row} testID={`link-race-profile-${row.id}`}>
            <View style={[styles.swatch, { backgroundColor: row.color }]} />
            <Text style={styles.label}>{row.name}</Text>
            <Text style={styles.share}>{pct(row.share)}</Text>
          </Pressable>
        ))
        : <Text style={styles.empty}>Нет данных.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 20 },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  label: { flex: 1, fontFamily: fonts.sans, fontSize: 12, color: c.accent, textDecorationLine: 'underline' },
  share: { fontFamily: fonts.sansSemiBold, fontSize: 12, color: c.foreground, fontVariant: ['tabular-nums'] },
  empty: { fontFamily: fonts.sans, fontSize: 12, color: c.mutedForeground },
});
