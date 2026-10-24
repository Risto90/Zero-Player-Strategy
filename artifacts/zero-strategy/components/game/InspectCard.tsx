import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import colors, { fonts } from '@/constants/colors';
import type { PixelInfo } from '@/game/game';
import { fmt, pct } from '@/game/format';
import { cityRankName } from '@/game/settlements';

const c = colors.light;

export function InspectCard({ info, onClose, onCountryPress, onCityPress }: {
  info: PixelInfo | null;
  onClose: () => void;
  onCountryPress?: (id: number) => void;
  onCityPress?: (id: number) => void;
}) {
  return (
    <View style={styles.card} testID="panel-inspect">
      <Pressable onPress={onClose} style={styles.close} hitSlop={8} accessibilityLabel="Закрыть" testID="button-close-inspect">
        <Feather name="x" size={18} color={c.foreground} />
      </Pressable>
      {!info ? (
        <Text style={styles.description}>Точка за краем карты</Text>
      ) : (
        <>
          <Text style={styles.title}>{info.land ? `Суша${info.biome ? ` · ${info.biome}` : ''}` : 'Море'}</Text>
          <Text style={styles.coords}>x {info.x} · y {info.y}</Text>
          {info.city && (
            <Pressable
              onPress={() => onCityPress?.(info.city!.id)}
              disabled={!onCityPress}
              accessibilityRole="link"
              testID="link-inspect-city"
            >
              <Text style={styles.link}>{info.city.name ?? cityRankName(info.city.rank)} · {cityRankName(info.city.rank)}</Text>
            </Pressable>
          )}
          {info.country && (
            <Pressable
              onPress={() => onCountryPress?.(info.country!.id)}
              disabled={!onCountryPress}
              accessibilityRole="link"
              testID="link-inspect-country"
            >
              <Text style={styles.link}>{info.country.rank} {info.country.name}</Text>
            </Pressable>
          )}
          {info.land && info.country && info.density > 0 && (
            <View style={styles.demographics} testID="inspect-demographics">
              <Text style={styles.demographic}>Население точки: {fmt(info.density)} чел.</Text>
              {info.cultures.length > 0 && (
                <Text style={styles.composition}>
                  Культуры: {info.cultures.map(({ name, share }) => `${name} ${pct(share)}`).join(' · ')}
                </Text>
              )}
              {info.humanOrigins?.length ? (
                <Text style={styles.composition} testID="inspect-human-origins">
                  Расы: {info.humanOrigins.map(({ name, share }) => `${name} ${pct(share)}`).join(' · ')}
                </Text>
              ) : (
                <Text style={styles.composition} testID="inspect-human-origins-empty">Расы: нет данных</Text>
              )}
              {info.humanClimateSuitability !== null && (
                <Text style={styles.composition} testID="inspect-climate-suitability">
                  Пригодность климата: {pct(info.humanClimateSuitability)}. Игровая агрегированная оценка.
                </Text>
              )}
              {(info.religions.length > 0 || info.nonBelievers > 0) && (
                <Text style={styles.composition}>
                  Веры: {[
                    ...info.religions.map(({ name, share }) => `${name} ${pct(share)}`),
                    ...(info.nonBelievers > 0 ? [`Неверующие ${pct(info.nonBelievers)}`] : []),
                  ].join(' · ')}
                </Text>
              )}
            </View>
          )}
          {info.land && !info.city && !info.country && <Text style={styles.description}>Ничья земля</Text>}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    maxWidth: 310,
    minWidth: 190,
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    paddingRight: 38,
    borderWidth: 1,
    borderColor: c.foreground,
    borderRadius: 5,
    backgroundColor: 'rgba(250,247,239,0.96)',
    shadowColor: c.foreground,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  close: { position: 'absolute', right: 4, top: 4, width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.display, fontSize: 15, color: c.foreground },
  coords: { fontFamily: fonts.mono, fontSize: 10, color: c.mutedForeground },
  description: { fontFamily: fonts.sans, fontSize: 11, color: c.mutedForeground },
  link: { fontFamily: fonts.sansSemiBold, fontSize: 12, color: c.accent, textDecorationLine: 'underline' },
  demographics: { gap: 2, marginTop: 3, paddingTop: 4, borderTopWidth: 1, borderTopColor: c.border },
  demographic: { fontFamily: fonts.sansSemiBold, fontSize: 11, color: c.foreground },
  composition: { fontFamily: fonts.sans, fontSize: 10, color: c.mutedForeground },
});
