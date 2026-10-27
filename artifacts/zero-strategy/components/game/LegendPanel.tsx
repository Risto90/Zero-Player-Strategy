import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import colors, { fonts } from '@/constants/colors';
import { BIOME_NOTE } from '@/game/config';
import { fmt, pct } from '@/game/format';
import type { Game, GameSnapshot, LegendRow } from '@/game/game';
import { HUMAN_ORIGINS } from '@/game/human';
import { RAMPS } from '@/game/render';
import { cityRankName } from '@/game/settlements';
import { cityProfileRoute, countryProfileRoute, cultureProfileRoute, raceProfileRoute, religionProfileRoute } from '@/game/profileRoutes';

const c = colors.light;
const VALUE_NOTE: Record<string, string> = {
  humidity: 'Влажность почвы и воздуха. Ливни поднимают, засуха снижает.',
  temperature: 'Средняя температура. От ледников до тропиков.',
  drainage: 'Как быстро уходит вода. Низкий дренаж заболачивает.',
  density: 'Плотность населения на освоенной земле.',
  elevation: 'Сетка показывает трёхмерный рельеф; глубина моря остаётся на карте отдельной шкалой.',
};
const VALUE_TITLE: Record<string, string> = { humidity: 'Влажность', temperature: 'Температура', drainage: 'Дренаж', density: 'Население', elevation: 'Высоты' };

function normalizeSearchText(value: string) {
  return value.trim().toLocaleLowerCase().replace(/ё/g, 'е').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function NameSearch({ value, placeholder, onChangeText }: { value: string; placeholder: string; onChangeText: (text: string) => void }) {
  return (
    <View style={styles.search}>
      <Feather name="search" size={15} color={c.mutedForeground} />
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={c.mutedForeground}
        autoCapitalize="none" autoCorrect={false} returnKeyType="search" accessibilityLabel={placeholder}
        style={styles.searchInput} testID="input-legend-search" />
      {value.length > 0 && (
        <Pressable onPress={() => onChangeText('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Очистить поиск"
          testID="button-clear-legend-search">
          <Feather name="x-circle" size={17} color={c.mutedForeground} />
        </Pressable>
      )}
    </View>
  );
}

function EntityRow({ row, unit, active, onSelect, profileRoute, showShare = true, showSwatch = true, testId }: {
  row: LegendRow;
  unit: string;
  active: boolean;
  onSelect?: () => void;
  profileRoute?: Href | null;
  showShare?: boolean;
  showSwatch?: boolean;
  testId: string;
}) {
  return (
    <View style={[styles.entityRow, active && styles.entityRowActive]} testID={testId}>
      {showShare && (
        <View pointerEvents="none" style={[styles.rowBarTrack, profileRoute && styles.rowBarTrackWithProfile]}>
          <View style={[styles.rowBar, {
            width: `${Math.max(0, Math.min(100, row.percent))}%`,
            backgroundColor: row.color,
          }]} />
        </View>
      )}
      <Pressable onPress={onSelect} disabled={!onSelect} style={styles.selectButton}
        accessibilityRole="button" accessibilityState={{ selected: active }} testID={`${testId}-select`}>
        {showSwatch && <View style={[styles.swatch, { backgroundColor: row.color }]} />}
        <View style={styles.rowNameBlock}>
          <Text style={styles.rowName} numberOfLines={1}>{row.name}</Text>
          {row.detail !== '' && <Text style={styles.rowDetail} numberOfLines={1}>{row.detail}</Text>}
        </View>
        <View style={styles.rowStats}>
          {showShare && <Text style={styles.rowPct}>{pct(row.percent)}</Text>}
          <Text style={styles.rowValue}>{fmt(row.value)} {unit}</Text>
        </View>
      </Pressable>
      {profileRoute ? (
        <Pressable onPress={() => router.push(profileRoute)} style={styles.profileButton}
          accessibilityRole="link" accessibilityLabel={`Открыть профиль: ${row.name}`}
          testID={`${testId}-profile`}>
          <Feather name="external-link" size={15} color={c.accent} />
        </Pressable>
      ) : null}
    </View>
  );
}

function EntityRows({ rows, unit = 'чел.', activeId = null, onSelect, profileRouteForId, showShare = true, showSwatch = true, header, footer, testPrefix }: {
  rows: LegendRow[];
  unit?: string;
  activeId?: number | null;
  onSelect?: (row: LegendRow) => void;
  profileRouteForId?: (id: number) => Href | null;
  showShare?: boolean;
  showSwatch?: boolean;
  header?: ReactElement | null;
  footer?: ReactElement | null;
  testPrefix: string;
}) {
  return (
    <FlatList data={rows} keyExtractor={(row) => String(row.id)} style={styles.list}
      ListHeaderComponent={header ?? undefined} stickyHeaderIndices={header ? [0] : undefined}
      ListFooterComponent={footer ?? undefined}
      renderItem={({ item }) => (
        <EntityRow row={item} unit={unit} active={activeId === item.id}
          onSelect={onSelect ? () => onSelect(item) : undefined}
          profileRoute={profileRouteForId?.(item.id)} showShare={showShare} showSwatch={showSwatch}
          testId={`${testPrefix}-${item.id}`} />
      )}
      initialNumToRender={12} nestedScrollEnabled keyboardShouldPersistTaps="handled" />
  );
}

function Empty({ text }: { text: string }) {
  return <Text style={styles.empty}>{text}</Text>;
}

export function LegendPanel({ game, snap, onCityPress, mode: modeOverride }: {
  game: Game;
  snap: GameSnapshot;
  onCityPress?: (pixel: number) => void;
  mode?: GameSnapshot['mapMode'];
}) {
  const { legend, layer } = snap;
  const mapMode = modeOverride ?? snap.mapMode;
  const [searchByMode, setSearchByMode] = useState<Partial<Record<GameSnapshot['mapMode'], string>>>({});
  const search = searchByMode[mapMode] ?? '';
  const setSearch = (value: string) => setSearchByMode((current) => ({ ...current, [mapMode]: value }));
  const query = normalizeSearchText(search);
  let body: ReactElement;
  let title = '';
  let sub = '';

  if (mapMode === 'political') {
    title = 'Страны';
    sub = `${legend.countries.length} · население ${fmt(legend.totalPopulation)}`;
    const rows = legend.countries.filter((row) => normalizeSearchText(row.name).includes(query));
    body = legend.countries.length ? (
      <View style={styles.listContent}>
        <NameSearch value={search} placeholder="Найти страну" onChangeText={setSearch} />
        {rows.length ? <EntityRows rows={rows} activeId={snap.selectedCountryId}
          onSelect={(row) => game.showCountryOnMap(row.id)}
          profileRouteForId={countryProfileRoute} testPrefix="row-country" /> : <Empty text="Ничего не найдено. Измените запрос или очистите его." />}
      </View>
    ) : <Empty text="Ни одного государства. Пока." />;
  } else if (mapMode === 'cultures' || mapMode === 'religions' || mapMode === 'origins') {
    const isCulture = mapMode === 'cultures';
    const isReligion = mapMode === 'religions';
    const kind = isCulture ? 'culture' : isReligion ? 'religion' : 'origin';
    const rows = isCulture ? legend.cultures : isReligion ? legend.religions : legend.origins;
    const titleName = isCulture ? 'Культуры' : isReligion ? 'Религии' : 'Расы';
    const profileRouteForId = isCulture ? cultureProfileRoute : isReligion ? religionProfileRoute
      : (id: number) => HUMAN_ORIGINS[id] ? raceProfileRoute(HUMAN_ORIGINS[id].id) : null;
    const activeId = layer?.kind === kind ? layer.id : null;
    title = titleName;
    sub = activeId === null ? 'нажмите строку — показать слой карты' : `слой: ${rows.find((row) => row.id === activeId)?.name ?? ''}`;
    const visibleRows = rows.filter((row) => normalizeSearchText(row.name).includes(query));
    const footer = isReligion && legend.totalPopulation > 0 ? (
      <EntityRow row={legend.nonBelievers} unit="чел." active={false} showShare testId="row-nonbelievers" />
    ) : null;
    body = rows.length ? (
      <View style={styles.listContent}>
        <NameSearch value={search} placeholder={`Найти ${isCulture ? 'культуру' : isReligion ? 'веру' : 'расу'}`} onChangeText={setSearch} />
        {visibleRows.length ? <EntityRows rows={visibleRows} activeId={activeId}
          onSelect={(row) => game.showLayer(layer?.kind === kind && layer.id === row.id ? null : { kind, id: row.id })}
          profileRouteForId={profileRouteForId} footer={footer} testPrefix={`row-${kind}`} /> : <Empty text="Ничего не найдено. Измените запрос или очистите его." />}
      </View>
    ) : <Empty text={isCulture ? 'Пока никого.' : isReligion ? 'Пока нет верующих.' : 'На карте рас нет.'} />;
  } else if (mapMode === 'cities') {
    const allRows = game.world.cities.map((city): LegendRow => ({
      id: city.id,
      name: city.name ?? cityRankName(city.rank),
      color: game.world.countries[city.countryId]?.color ?? '#8f3036',
      value: Math.round(city.population),
      percent: 0,
      detail: '',
    }));
    const visibleRows = allRows.filter((row) => normalizeSearchText(row.name).includes(query));
    title = 'Города';
    sub = `${allRows.length} · радиус сферы зависит от ранга`;
    body = allRows.length ? (
      <View style={styles.listContent}>
        <NameSearch value={search} placeholder="Найти город" onChangeText={setSearch} />
        {visibleRows.length ? <EntityRows rows={visibleRows} activeId={snap.selectedCityId} showShare={false} showSwatch={false}
          onSelect={(row) => {
            const city = game.world.cities[row.id];
            const deselect = snap.selectedCityId === row.id;
            game.selectCity(row.id);
            if (!deselect && city) onCityPress?.(city.pixel);
          }}
          profileRouteForId={cityProfileRoute} testPrefix="row-city" /> : <Empty text="Ничего не найдено. Измените запрос или очистите его." />}
      </View>
    ) : <Empty text="Пока нет городов." />;
  } else if (mapMode === 'biomes') {
    title = 'Биомы';
    sub = 'доля суши';
    body = <EntityRows rows={legend.biomes} unit="земель" activeId={null} showShare
      footer={<Text style={styles.note}>{BIOME_NOTE}</Text>} testPrefix="row-biome" />;
  } else if (mapMode === 'elevation') {
    title = 'Высоты';
    sub = 'трёхмерный рельеф и батиметрия';
    body = (
      <ScrollView contentContainerStyle={{ padding: 12 }} nestedScrollEnabled>
        <LinearGradient colors={RAMPS.elevation as [string, string, ...string[]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.ramp} />
        <View style={styles.rampLabels}>
          {['−11 000 м', '0 м'].map((value) => <Text key={value} style={styles.rampLabel}>{value}</Text>)}
        </View>
        <Text style={styles.valueNote}>{VALUE_NOTE.elevation}</Text>
        <View style={styles.riverLegendRow}><View style={[styles.riverSwatch, { backgroundColor: '#326582' }]} /><Text style={styles.valueNote}>Реки</Text></View>
        <View style={styles.riverLegendRow}><Text style={styles.geoSymbol}>▲</Text><Text style={styles.valueNote}>Горные вершины</Text></View>
        <View style={styles.riverLegendRow}><Text style={[styles.geoSymbol, { color: '#b36b39' }]}>▲</Text><Text style={styles.valueNote}>Уснувшие вулканы</Text></View>
        <View style={styles.riverLegendRow}><Text style={[styles.geoSymbol, { color: '#b43a2d' }]}>▲</Text><Text style={styles.valueNote}>Действующие вулканы</Text></View>
      </ScrollView>
    );
  } else {
    const valueMode = mapMode as keyof typeof RAMPS;
    const stops = RAMPS[valueMode];
    title = VALUE_TITLE[valueMode];
    sub = 'шкала 0–100';
    body = (
      <ScrollView contentContainerStyle={{ padding: 12 }} nestedScrollEnabled>
        <LinearGradient colors={stops as [string, string, ...string[]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.ramp} />
        <View style={styles.rampLabels}>{[0, 25, 50, 75, 100].map((value) => <Text key={value} style={styles.rampLabel}>{value}</Text>)}</View>
        <Text style={styles.valueNote}>{VALUE_NOTE[valueMode]}</Text>
        {mapMode === 'density' && <Text style={styles.valueNote}>Всего: {fmt(legend.totalPopulation)} чел.</Text>}
      </ScrollView>
    );
  }
  return (
    <View style={styles.panel} testID="panel-legend">
      <View style={styles.header}><Text style={styles.title}>{title}</Text><Text style={styles.sub} numberOfLines={1}>{sub}</Text></View>
      <View style={{ flex: 1 }}>{body}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, backgroundColor: c.card },
  listContent: { flex: 1, minHeight: 0 },
  list: { flex: 1 },
  search: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 7, marginHorizontal: 8, marginTop: 6, marginBottom: 4, paddingHorizontal: 9, borderWidth: 1, borderColor: c.input, borderRadius: 4, backgroundColor: c.background },
  searchInput: { flex: 1, minWidth: 0, paddingVertical: 5, fontFamily: fonts.sans, fontSize: 12, color: c.foreground },
  header: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 4 },
  title: { fontFamily: fonts.display, fontSize: 16, color: c.foreground },
  sub: { flexShrink: 1, fontFamily: fonts.sans, fontSize: 11, color: c.mutedForeground },
  entityRow: { position: 'relative', flexDirection: 'row', alignItems: 'stretch', borderBottomWidth: 1, borderBottomColor: 'rgba(201,185,166,0.7)', backgroundColor: c.card },
  entityRowActive: { backgroundColor: c.muted },
  rowBarTrack: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  rowBarTrackWithProfile: { right: 38 },
  rowBar: { position: 'absolute', left: 0, top: 0, bottom: 0, opacity: 0.15 },
  selectButton: { flex: 1, minWidth: 0, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: 'transparent' },
  rowNameBlock: { flex: 1, minWidth: 0 },
  rowStats: { alignItems: 'flex-end', minWidth: 72 },
  rowName: { fontFamily: fonts.sansMedium, fontSize: 13, color: c.foreground },
  rowDetail: { fontFamily: fonts.sans, fontSize: 11, color: c.mutedForeground },
  rowValue: { fontFamily: fonts.mono, fontSize: 10, color: c.mutedForeground },
  rowPct: { fontFamily: fonts.mono, fontSize: 11, color: c.foreground },
  swatch: { width: 12, height: 12, borderRadius: 2, borderWidth: 1, borderColor: 'rgba(44,30,23,0.4)' },
  profileButton: { width: 38, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderLeftColor: c.border },
  empty: { paddingHorizontal: 12, paddingVertical: 14, fontFamily: fonts.displayItalic, fontSize: 14, color: c.mutedForeground },
  note: { paddingHorizontal: 8, paddingVertical: 8, fontFamily: fonts.sans, fontSize: 11, lineHeight: 15, color: c.mutedForeground },
  ramp: { height: 16, borderRadius: 2, borderWidth: 1, borderColor: 'rgba(44,30,23,0.5)' },
  rampLabels: { marginTop: 4, flexDirection: 'row', justifyContent: 'space-between' },
  rampLabel: { fontFamily: fonts.mono, fontSize: 10, color: c.mutedForeground },
  valueNote: { marginTop: 8, fontFamily: fonts.sans, fontSize: 12, color: c.foreground, opacity: 0.78 },
  riverLegendRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  riverSwatch: { width: 20, height: 4, borderRadius: 2 },
  geoSymbol: { fontFamily: fonts.sans, fontSize: 13, fontWeight: '700', color: '#55483c' },
});
