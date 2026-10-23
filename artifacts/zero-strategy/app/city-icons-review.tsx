import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CITY_ICON_SOURCES } from '@/components/map/cityIcons';
import { cityIconIndex, cityVisibilityMultiplierForCity, isCityVisibleAtZoom, cityVisibilityRank } from '@/components/map/cityIconMath';
import colors, { fonts } from '@/constants/colors';
import { cityRankName } from '@/game/settlements';

const c = colors.light;
const ranks = [1, 2, 3, 4, 5, 6] as const;
const reviewCity = { rank: 1, capital: false } as const;
const reviewPort = { rank: 1, capital: false } as const;
const reviewCapital = { rank: 1, capital: true } as const;
const zoomExamples = [
  { title: 'Городок', city: reviewCity, hasPort: false, iconIndex: cityIconIndex(reviewCity, false) },
  { title: 'Порт · городок', city: reviewPort, hasPort: true, iconIndex: cityIconIndex(reviewPort, true) },
  { title: 'Столица', city: reviewCapital, hasPort: false, iconIndex: cityIconIndex(reviewCapital, false) },
] as const;

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export default function CityIconsReviewScreen() {
  const insets = useSafeAreaInsets();
  const [zoom, setZoom] = useState(1.6);
  const adjustZoom = (delta: number) =>
    setZoom((current) => Math.max(1, Math.min(2, Math.round((current + delta) * 10) / 10)));

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <Pressable onPress={goBack} style={styles.back} hitSlop={8} accessibilityRole="button" accessibilityLabel="Назад">
          <Feather name="arrow-left" size={18} color={c.foreground} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Значки городов</Text>
          <Text style={styles.subtitle}>Проверка для телефона · масштаб относительно открытия карты</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator>
        <View style={styles.zoomCard}>
          <View style={styles.zoomHeading}>
            <Text style={styles.sectionTitle}>Появление на карте</Text>
            <Text style={styles.zoomValue}>×{zoom.toFixed(1)}</Text>
          </View>
          <View style={styles.zoomControls}>
            <Pressable onPress={() => adjustZoom(-0.1)} style={styles.zoomButton} accessibilityRole="button" accessibilityLabel="Уменьшить масштаб" testID="city-icon-zoom-out">
              <Feather name="minus" size={18} color={c.foreground} />
            </Pressable>
            <View style={styles.zoomTrack}>
              <View style={[styles.zoomFill, { width: `${((zoom - 1) / 1) * 100}%` }]} />
            </View>
            <Pressable onPress={() => adjustZoom(0.1)} style={styles.zoomButton} accessibilityRole="button" accessibilityLabel="Увеличить масштаб" testID="city-icon-zoom-in">
              <Feather name="plus" size={18} color={c.foreground} />
            </Pressable>
          </View>
          <View style={styles.examples}>
            {zoomExamples.map((example) => {
              const threshold = cityVisibilityMultiplierForCity(example.city, example.hasPort);
              const visible = isCityVisibleAtZoom(zoom, 1, cityVisibilityRank(example.city, example.hasPort));
              return (
                <View key={example.title} style={styles.example}>
                  <View style={[styles.exampleIcon, !visible && styles.hiddenIcon]}>
                    {visible && <Image source={CITY_ICON_SOURCES[example.iconIndex]} style={styles.exampleImage} resizeMode="contain" />}
                  </View>
                  <Text style={styles.exampleName}>{example.title}</Text>
                  <Text style={styles.exampleNote}>{visible ? 'виден' : `с ×${threshold.toFixed(1)}`}</Text>
                </View>
              );
            })}
          </View>
          <Text style={styles.hint}>Порог проверяется по той же формуле, что и на карте. Нажимайте «+», чтобы увидеть появление значков.</Text>
        </View>

        <View style={styles.galleryHeading}>
          <Text style={styles.sectionTitle}>Все 13 значков</Text>
          <Text style={styles.galleryNote}>Слева: список городов · справа: карточка страны</Text>
        </View>
        <View style={styles.grid}>
          {ranks.map((rank) => (
            <IconSample key={`city-${rank}`} iconIndex={cityIconIndex({ rank, capital: false }, false)} title={cityRankName(rank)} category="Город" />
          ))}
          {ranks.map((rank) => (
            <IconSample key={`port-${rank}`} iconIndex={cityIconIndex({ rank, capital: false }, true)} title={cityRankName(rank)} category="Порт" />
          ))}
          <IconSample
            iconIndex={cityIconIndex(reviewCapital, false)}
            title="Столица"
            category="Особый значок"
          />
        </View>
      </ScrollView>
    </View>
  );
}

function IconSample({ iconIndex, title, category }: { iconIndex: number; title: string; category: string }) {
  return (
    <View style={styles.sample} testID={`city-icon-sample-${iconIndex}`}>
      <Text style={styles.sampleCategory}>{category}</Text>
      <Text style={styles.sampleTitle} numberOfLines={1}>{title}</Text>
      <View style={styles.sampleIcons}>
        <View style={styles.sampleIconSlot}>
          <Image source={CITY_ICON_SOURCES[iconIndex]} style={styles.listIcon} resizeMode="contain" accessibilityLabel={`${category}: ${title}, список городов`} />
          <Text style={styles.iconSize}>34</Text>
        </View>
        <View style={styles.sampleIconSlot}>
          <Image source={CITY_ICON_SOURCES[iconIndex]} style={styles.countryIcon} resizeMode="contain" accessibilityLabel={`${category}: ${title}, карточка страны`} />
          <Text style={styles.iconSize}>22</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 12, gap: 10, borderBottomWidth: 1, borderBottomColor: c.border },
  back: { width: 32, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1 },
  title: { fontFamily: fonts.display, fontSize: 19, color: c.foreground },
  subtitle: { fontFamily: fonts.sans, fontSize: 10, color: c.mutedForeground },
  content: { padding: 10, paddingBottom: 18, gap: 10 },
  zoomCard: { borderWidth: 1, borderColor: c.border, borderRadius: 6, padding: 9, backgroundColor: c.card },
  zoomHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontFamily: fonts.display, fontSize: 15, color: c.foreground },
  zoomValue: { fontFamily: fonts.mono, fontSize: 14, color: c.primary },
  zoomControls: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  zoomButton: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border, borderRadius: 4, backgroundColor: c.background },
  zoomTrack: { flex: 1, height: 7, overflow: 'hidden', borderRadius: 4, backgroundColor: c.muted },
  zoomFill: { height: '100%', backgroundColor: c.primary },
  examples: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 6 },
  example: { minWidth: 82, alignItems: 'center', gap: 1 },
  exampleIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  exampleImage: { width: 38, height: 38 },
  hiddenIcon: { borderWidth: 1, borderStyle: 'dashed', borderColor: c.border, borderRadius: 4 },
  exampleName: { fontFamily: fonts.sansSemiBold, fontSize: 10, color: c.foreground },
  exampleNote: { fontFamily: fonts.sans, fontSize: 9, color: c.mutedForeground },
  hint: { marginTop: 5, fontFamily: fonts.sans, fontSize: 9, lineHeight: 12, color: c.mutedForeground },
  galleryHeading: { gap: 1 },
  galleryNote: { fontFamily: fonts.sans, fontSize: 9, color: c.mutedForeground },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 5 },
  sample: { width: '49%', minHeight: 68, paddingHorizontal: 7, paddingVertical: 4, borderWidth: 1, borderColor: c.border, borderRadius: 5, backgroundColor: c.card },
  sampleCategory: { fontFamily: fonts.sans, fontSize: 8, color: c.mutedForeground },
  sampleTitle: { fontFamily: fonts.sansSemiBold, fontSize: 10, lineHeight: 12, color: c.foreground },
  sampleIcons: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 1 },
  sampleIconSlot: { width: 47, height: 34, flexDirection: 'row', alignItems: 'center', gap: 2 },
  listIcon: { width: 34, height: 34 },
  countryIcon: { width: 22, height: 22 },
  iconSize: { fontFamily: fonts.mono, fontSize: 8, color: c.mutedForeground },
});
