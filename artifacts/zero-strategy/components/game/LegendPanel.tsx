import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactElement } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import colors, { fonts } from '@/constants/colors';
import { BIOME_NOTE } from '@/game/config';
import { fmt, pct } from '@/game/format';
import type { Game, GameSnapshot, LegendRow } from '@/game/game';
import { RAMPS } from '@/game/render';

const c = colors.light;

const VALUE_NOTE: Record<string, string> = {
  humidity: 'Влажность почвы и воздуха. Ливни поднимают, засуха снижает.',
  temperature: 'Средняя температура. От ледников до тропиков.',
  drainage: 'Как быстро уходит вода. Низкий дренаж заболачивает.',
  density: 'Плотность населения на освоенной земле.',
};
const VALUE_TITLE: Record<string, string> = { humidity: 'Влажность', temperature: 'Температура', drainage: 'Дренаж', density: 'Население' };

function Row({ row, unit, onPress, active }: { row: LegendRow; unit: string; onPress?: () => void; active?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={[styles.row, active && { backgroundColor: c.muted }]} testID={`row-legend-${row.id}`}>
      <View style={[styles.rowBar, { width: `${Math.min(100, row.percent)}%`, backgroundColor: row.color }]} />
      <View style={[styles.swatch, { backgroundColor: row.color }]} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowName} numberOfLines={1}>{row.name}</Text>
        {row.detail !== '' && <Text style={styles.rowDetail} numberOfLines={1}>{row.detail}</Text>}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.rowPct}>{pct(row.percent)}</Text>
        <Text style={styles.rowValue}>{fmt(row.value)} {unit}</Text>
      </View>
    </Pressable>
  );
}

function Empty({ text }: { text: string }) {
  return <Text style={styles.empty}>{text}</Text>;
}

function Rows({ rows, unit, onPress, activeId, header, footer }: { rows: LegendRow[]; unit: string; onPress?: (row: LegendRow) => void; activeId?: number | null; header?: ReactElement | null; footer?: ReactElement | null }) {
  return (
    <FlatList
      data={rows}
      keyExtractor={(row) => String(row.id)}
      renderItem={({ item }) => <Row row={item} unit={unit} active={activeId === item.id} onPress={onPress ? () => onPress(item) : undefined} />}
      ListHeaderComponent={header ?? undefined}
      stickyHeaderIndices={header ? [0] : undefined}
      ListFooterComponent={footer ?? undefined}
      initialNumToRender={12}
      nestedScrollEnabled
    />
  );
}

export function LegendPanel({ game, snap }: { game: Game; snap: GameSnapshot }) {
  const { legend, mapMode, layer } = snap;
  let body: ReactElement;
  let title = '';
  let sub = '';
  if (mapMode === 'political') {
    title = 'Страны';
    sub = `${legend.countries.length} · население ${fmt(legend.totalPopulation)}`;
    body = legend.countries.length ? <Rows rows={legend.countries} unit="чел." /> : <Empty text="Ни одного государства. Пока." />;
  } else if (mapMode === 'cultures' || mapMode === 'religions') {
    const kind = mapMode === 'cultures' ? 'culture' : 'religion';
    const rows = mapMode === 'cultures' ? legend.cultures : legend.religions;
    title = mapMode === 'cultures' ? 'Культуры' : 'Религии';
    const activeId = layer && layer.kind === kind ? layer.id : null;
    const single = activeId !== null ? rows.find((r) => r.id === activeId) : null;
    sub = single ? `слой: ${single.name}` : 'нажмите строку — слой одной общности';
    const back = layer ? (
      <Pressable onPress={() => game.showLayer(null)} style={styles.back} testID="button-layer-back">
        <Feather name="arrow-left" size={15} color={c.primary} />
        <Text style={styles.backText}>Все {mapMode === 'cultures' ? 'культуры' : 'веры'} вместе</Text>
      </Pressable>
    ) : null;
    const footer = mapMode === 'religions' && legend.totalPopulation > 0 ? <Row row={legend.nonBelievers} unit="чел." /> : null;
    body =
      rows.length === 0 ? (
        <Empty text="Пока никого." />
      ) : (
        <Rows rows={rows} unit="чел." activeId={activeId} header={back} footer={footer} onPress={(row) => game.showLayer({ kind, id: row.id })} />
      );
  } else if (mapMode === 'biomes') {
    title = 'Биомы';
    sub = 'доля суши';
    body = <Rows rows={legend.biomes} unit="земель" footer={<Text style={styles.note}>{BIOME_NOTE}</Text>} />;
  } else {
    const stops = RAMPS[mapMode];
    title = VALUE_TITLE[mapMode];
    sub = 'шкала 0–100';
    body = (
      <ScrollView contentContainerStyle={{ padding: 12 }} nestedScrollEnabled>
        <LinearGradient colors={stops as [string, string, ...string[]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.ramp} />
        <View style={styles.rampLabels}>
          {[0, 25, 50, 75, 100].map((v) => (
            <Text key={v} style={styles.rampLabel}>{v}</Text>
          ))}
        </View>
        <Text style={styles.valueNote}>{VALUE_NOTE[mapMode]}</Text>
        {mapMode === 'density' && <Text style={styles.valueNote}>Всего: {fmt(legend.totalPopulation)} чел.</Text>}
      </ScrollView>
    );
  }
  return (
    <View style={styles.panel} testID="panel-legend">
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.sub} numberOfLines={1}>{sub}</Text>
      </View>
      <View style={{ flex: 1 }}>{body}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, backgroundColor: c.card },
  header: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 4 },
  title: { fontFamily: fonts.display, fontSize: 16, color: c.foreground },
  sub: { flexShrink: 1, fontFamily: fonts.sans, fontSize: 11, color: c.mutedForeground },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(201,185,166,0.7)', backgroundColor: c.card },
  rowBar: { position: 'absolute', left: 0, top: 0, bottom: 0, opacity: 0.15 },
  swatch: { width: 12, height: 12, borderRadius: 2, borderWidth: 1, borderColor: 'rgba(44,30,23,0.4)' },
  rowName: { fontFamily: fonts.sansMedium, fontSize: 13, color: c.foreground },
  rowDetail: { fontFamily: fonts.sans, fontSize: 11, color: c.mutedForeground },
  rowPct: { fontFamily: fonts.mono, fontSize: 12, color: c.foreground },
  rowValue: { fontFamily: fonts.mono, fontSize: 10, color: c.mutedForeground },
  empty: { paddingHorizontal: 12, paddingVertical: 14, fontFamily: fonts.displayItalic, fontSize: 14, color: c.mutedForeground },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 7, backgroundColor: c.card, borderBottomWidth: 2, borderBottomColor: c.primary },
  backText: { fontFamily: fonts.sansSemiBold, fontSize: 12.5, color: c.primary },
  note: { paddingHorizontal: 8, paddingVertical: 8, fontFamily: fonts.sans, fontSize: 11, lineHeight: 15, color: c.mutedForeground },
  ramp: { height: 16, borderRadius: 2, borderWidth: 1, borderColor: 'rgba(44,30,23,0.5)' },
  rampLabels: { marginTop: 4, flexDirection: 'row', justifyContent: 'space-between' },
  rampLabel: { fontFamily: fonts.mono, fontSize: 10, color: c.mutedForeground },
  valueNote: { marginTop: 8, fontFamily: fonts.sans, fontSize: 12, color: c.foreground, opacity: 0.78 },
});
