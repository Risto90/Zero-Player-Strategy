import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import colors, { fonts } from '@/constants/colors';
import { BIOME_NOTE } from '@/game/config';
import { fmt, pct } from '@/game/format';
import type { Game, GameSnapshot, LegendRow } from '@/game/game';
import { ageStage, GOVERNMENTS, MODIFIERS, governmentOf } from '@/game/government';
import { RAMPS } from '@/game/render';
import { expectedHeirFor, rulers } from '@/game/succession';
import { cityRankName } from '@/game/settlements';

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
    body = legend.countries.length ? <CountryRows game={game} rows={legend.countries} /> : <Empty text="Ни одного государства. Пока." />;
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
  } else if (mapMode === 'rivers') {
    title = 'Реки';
    sub = `${fmt(game.world.majorRiverPixelCount)} крупных · ${fmt(game.world.riverPixelCount)} русловых участков`;
    body = (
      <ScrollView contentContainerStyle={{ padding: 12 }} nestedScrollEnabled>
        <Text style={styles.valueNote}>Синим отмечены русла рек. На случайной карте речные сети генерируются по рельефу; на карте мира показаны основные реки.</Text>
        <View style={styles.riverLegendRow}>
          <View style={[styles.riverSwatch, { backgroundColor: '#6699ae' }]} />
          <Text style={styles.valueNote}>Притоки</Text>
        </View>
        <View style={styles.riverLegendRow}>
          <View style={[styles.riverSwatch, { backgroundColor: '#22537d' }]} />
          <Text style={styles.valueNote}>Крупные реки</Text>
        </View>
      </ScrollView>
    );
  } else if (mapMode === 'colonization') {
    title = 'Колонизация';
    sub = snapCountryName(snap);
    body = (
      <ScrollView contentContainerStyle={{ padding: 12 }} nestedScrollEnabled>
        <Text style={styles.valueNote}>Зелёным отмечены доступные земли для колонизации: побережье или область вокруг реки в бассейне страны. Каждая отдельная колония должна сохранять непрерывную связь с рекой или побережьем, но не обязана соединяться с основной территорией.</Text>
        <Text style={styles.valueNote}>Чужие земли доступны только при плотности ниже средней по стране и если правящие династии не союзники.</Text>
        <Text style={styles.valueNote}>Для каждой точки заново выбирается самый плотный участок-донор. Переселяется до 10% его населения; на чужой земле столько же местных удаляется. Целевая плотность не превышает плотность донора, а при частичном переселении тратится меньше чернил.</Text>
        <Text style={styles.valueNote}>Совпадение культуры и религии даёт первый приоритет переселенцам и последний местным на удаление; совпадение только одного признака — следующий приоритет.</Text>
      </ScrollView>
    );
  } else if (mapMode === 'cities') {
    title = 'Города';
    sub = `${game.world.cities.length} · по рангам`;
    body = (
      <ScrollView nestedScrollEnabled>
        {game.world.cities.length ? game.world.cities.map((city) => (
          <View key={city.id} style={styles.countryCard}>
            <View style={styles.row}>
              <View style={[styles.swatch, { backgroundColor: ['#a66f3d', '#bf6741', '#b2493e', '#8f3036', '#672433', '#431c2e'][city.rank - 1] }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{city.capital ? 'Столица' : cityRankName(city.rank)}</Text>
                <Text style={styles.rowDetail}>{game.world.countries[city.countryId]?.name ?? 'Страна распущена'} · {fmt(Math.round(game.world.density[city.pixel]))} чел.</Text>
              </View>
              <Text style={styles.rowValue}>{cityRankName(city.rank)}</Text>
            </View>
          </View>
        )) : <Empty text="Пока нет городов." />}
      </ScrollView>
    );
  } else if (mapMode === 'nomads') {
    title = 'Кочевья';
    sub = `${game.world.nomads.length} народов · ареалы перекрываются`;
    body = (
      <ScrollView nestedScrollEnabled>
        {game.world.nomads.length ? game.world.nomads.map((nomad) => (
          <Pressable key={nomad.id} onPress={() => router.push({ pathname: '/nomad/[id]', params: { id: String(nomad.id) } })} style={styles.row}>
            <View style={[styles.swatch, { backgroundColor: nomad.color }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName}>{nomad.name}</Text>
              <Text style={styles.rowDetail}>{game.world.cultures[nomad.cultureId]?.name ?? 'народ'} · {fmt(nomad.pixels)} земель ареала</Text>
            </View>
            <Feather name="chevron-right" size={16} color={c.mutedForeground} />
          </Pressable>
        )) : <Empty text="Кочевий пока нет." />}
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
        <View style={styles.rampLabels}>
          {[0, 25, 50, 75, 100].map((v) => (
            <Text key={v} style={styles.rampLabel}>{v}</Text>
          ))}
        </View>
        <Text style={styles.valueNote}>{VALUE_NOTE[valueMode]}</Text>
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

function CountryRows({ game, rows }: { game: Game; rows: LegendRow[] }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showPeople, setShowPeople] = useState(false);
  return (
    <FlatList
      data={rows}
      keyExtractor={(row) => String(row.id)}
      nestedScrollEnabled
      renderItem={({ item: row }) => {
        const country = game.world.countries[row.id];
        if (!country) return null;
        const selected = selectedId === country.id;
        const importantPeople = selected && showPeople ? game.importantPeople(country.id) : [];
        const countryCities = selected ? game.world.cities.filter((city) => city.countryId === country.id) : [];
        const nomadsPresent = selected ? game.world.nomads.map((nomad) => {
          let overlap = 0;
          for (const p of nomad.range) if (game.world.owner[p] === country.id + 1) overlap += 1;
          return { nomad, overlap };
        }).filter(({ overlap }) => overlap > 0) : [];
        return (
          <View style={[styles.countryCard, selected && styles.countrySelected]}>
            <Pressable onPress={() => {
              setSelectedId((current) => current === country.id ? null : country.id);
              setShowPeople(false);
            }} style={styles.row} accessibilityRole="button" accessibilityState={{ expanded: selected }}
              testID={`button-country-${country.id}`}>
              <View style={[styles.swatch, { backgroundColor: row.color }]} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.rowName} numberOfLines={1}>{country.rank} {country.name}</Text>
                <Text style={styles.rowDetail} numberOfLines={1}>{row.detail}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.rowPct}>{pct(row.percent)}</Text>
                <Text style={styles.rowValue}>{fmt(row.value)} чел.</Text>
              </View>
              <Feather name={selected ? 'chevron-up' : 'chevron-down'} size={16} color={c.mutedForeground} />
            </Pressable>
            {selected && (
              <View style={styles.countryDetails}>
                <Text style={styles.countryInfo}>Площадь · {fmt(country.pixels)} земель</Text>
                <Text style={styles.countryInfo}>Население · {fmt(row.value)} чел.</Text>
                <Text style={styles.countryInfo}>Форма правления · {GOVERNMENTS[governmentOf(country.government).id].name}</Text>
                {country.modifiers.map((modifier) => (
                  <Text style={styles.countryModifier} key={modifier}>
                    · {modifier === 'consulate' ? `Консулат ${country.consulCount}` : MODIFIERS[modifier].name}: {MODIFIERS[modifier].effect}
                  </Text>
                ))}
                <Text style={styles.countrySection}>ГОРОДА · {countryCities.length}</Text>
                {countryCities.map((city) => (
                  <Text key={city.id} style={styles.countryInfo}>
                    · {city.capital ? 'Столица' : cityRankName(city.rank)} · {cityRankName(city.rank)} · {fmt(Math.round(game.world.density[city.pixel]))} чел.
                  </Text>
                ))}
                <CountryCompositionBlock game={game} countryId={country.id} />
                <Text style={styles.countrySection}>Кочевья на территории</Text>
                {nomadsPresent.map(({ nomad, overlap }) => (
                  <Pressable key={nomad.id} onPress={() => router.push({ pathname: '/nomad/[id]', params: { id: String(nomad.id) } })}>
                    <Text style={styles.familyLink}>{nomad.name} · {overlap === nomad.range.length ? 'полностью' : 'частично'}</Text>
                  </Pressable>
                ))}
                {!nomadsPresent.length && <Text style={styles.countryInfo}>Нет кочевий.</Text>}
                {country.modifiers.includes('consulate') ? rulers(game.world, country).map((leader, index) => {
                  const heir = expectedHeirFor(game.world, country, leader);
                  return (
                    <View key={leader.id}>
                      <Text style={styles.countrySection}>КОНСУЛ {index + 1}</Text>
                      <Pressable onPress={() => router.push({ pathname: '/person/[id]', params: { id: String(leader.id) } })}>
                        <Text style={styles.personLink}>{leader.name} · {leader.age} лет ({ageStage(leader.age)})</Text>
                      </Pressable>
                      <Pressable onPress={() => router.push({ pathname: '/dynasty/[id]', params: { id: String(leader.familyId) } })}
                        accessibilityRole="link">
                        <Text style={styles.familyLink}>{leader.familyName} · родословная</Text>
                      </Pressable>
                      {heir && (
                        <>
                          <Text style={styles.countrySection}>ОЖИДАЕМЫЙ НАСЛЕДНИК КОНСУЛА {index + 1}</Text>
                          <Pressable onPress={() => router.push({ pathname: '/person/[id]', params: { id: String(heir.id) } })}>
                            <Text style={styles.personLink}>{heir.name} · {heir.age} лет ({ageStage(heir.age)})</Text>
                          </Pressable>
                        </>
                      )}
                    </View>
                  );
                }) : (
                  <>
                    <Text style={styles.countrySection}>ПРАВИТЕЛЬ</Text>
                    <View>
                      <Pressable onPress={() => router.push({ pathname: '/person/[id]', params: { id: String(country.ruler.id) } })}>
                        <Text style={styles.personLink}>{country.ruler.name} · {country.ruler.age} лет ({ageStage(country.ruler.age)})</Text>
                      </Pressable>
                      <Pressable onPress={() => router.push({ pathname: '/dynasty/[id]', params: { id: String(country.ruler.familyId) } })}
                        accessibilityRole="link">
                        <Text style={styles.familyLink}>{country.ruler.familyName} · родословная</Text>
                      </Pressable>
                    </View>
                    {country.heir && (
                      <>
                        <Text style={styles.countrySection}>ОЖИДАЕМЫЙ НАСЛЕДНИК</Text>
                        <View>
                          <Pressable onPress={() => router.push({ pathname: '/person/[id]', params: { id: String(country.heir!.id) } })}>
                            <Text style={styles.personLink}>{country.heir.name} · {country.heir.age} лет ({ageStage(country.heir.age)})</Text>
                          </Pressable>
                          <Pressable onPress={() => router.push({ pathname: '/dynasty/[id]', params: { id: String(country.heir!.familyId) } })}
                            accessibilityRole="link">
                            <Text style={styles.familyLink}>{country.heir.familyName} · родословная</Text>
                          </Pressable>
                        </View>
                      </>
                    )}
                    {country.coRulerIds.map((id) => {
                      const coRuler = game.world.people.find((person) => person.id === id);
                      return coRuler ? (
                        <View key={id}>
                          <Text style={styles.countrySection}>СОПРАВИТЕЛЬ</Text>
                          <Pressable onPress={() => router.push({ pathname: '/person/[id]', params: { id: String(coRuler.id) } })}>
                            <Text style={styles.personLink}>{coRuler.name} · {coRuler.age} лет ({ageStage(coRuler.age)})</Text>
                          </Pressable>
                        </View>
                      ) : null;
                    })}
                  </>
                )}
                <Pressable onPress={() => setShowPeople((current) => !current)} style={styles.peopleButton}>
                  <Feather name="users" size={13} color={c.primaryForeground} />
                  <Text style={styles.peopleButtonText}>{showPeople ? 'Скрыть персонажей страны' : 'Все живые персонажи страны'}</Text>
                </Pressable>
                {showPeople && (
                  <View style={styles.peopleList}>
                    {importantPeople.map((person) => (
                      <View key={person.id} style={styles.personRow}>
                        <Pressable onPress={() => router.push({ pathname: '/person/[id]', params: { id: String(person.id) } })}>
                          <Text style={styles.personLink}>{person.name}</Text>
                        </Pressable>
                        <View style={styles.personMetaRow}>
                          <Text style={styles.personMeta}>
                            {person.age} лет · {game.world.cultures[person.cultureId]?.name ?? 'культура неизвестна'} ·
                            {' '}{person.religionId === null ? 'атеист' : game.world.religions[person.religionId]?.name ?? 'вера неизвестна'} ·
                          </Text>
                          <Pressable onPress={() => router.push({ pathname: '/dynasty/[id]', params: { id: String(person.familyId) } })}
                            accessibilityRole="link" testID={`link-dynasty-${person.familyId}`}>
                            <Text style={styles.familyLink}>{person.familyName}</Text>
                          </Pressable>
                        </View>
                      </View>
                    ))}
                    {!importantPeople.length && <Text style={styles.rowDetail}>Нет живых персонажей.</Text>}
                  </View>
                )}
              </View>
            )}
          </View>
        );
      }}
    />
  );
}

function snapCountryName(snap: GameSnapshot): string {
  return snap.cardCountry ? `${snap.cardCountry.name} · доступные области` : 'Доступные области';
}

function CountryCompositionBlock({ game, countryId }: { game: Game; countryId: number }) {
  const composition = game.countryComposition(countryId);
  return (
    <View style={styles.composition}>
      <Text style={styles.countrySection}>ЭТНИЧЕСКИЙ СОСТАВ</Text>
      {composition.cultures.map((group) => (
        <Text key={group.id} style={styles.compositionRow}>
          <Text style={{ color: group.color }}>■ </Text>{group.name} · {pct(group.percent)}
        </Text>
      ))}
      <Text style={styles.countrySection}>РЕЛИГИОЗНЫЙ СОСТАВ</Text>
      {composition.religions.map((group) => (
        <Text key={group.id ?? 'atheists'} style={styles.compositionRow}>
          <Text style={{ color: group.color }}>■ </Text>{group.name} · {pct(group.percent)}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, backgroundColor: c.card },
  header: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 4 },
  title: { fontFamily: fonts.display, fontSize: 16, color: c.foreground },
  sub: { flexShrink: 1, fontFamily: fonts.sans, fontSize: 11, color: c.mutedForeground },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(201,185,166,0.7)', backgroundColor: c.card },
  countryCard: { backgroundColor: c.card, borderBottomWidth: 1, borderBottomColor: 'rgba(201,185,166,0.7)' },
  countrySelected: { borderWidth: 1, borderColor: c.primary },
  countryDetails: { gap: 4, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: c.background },
  countryInfo: { fontFamily: fonts.sans, fontSize: 11, color: c.foreground },
  countryModifier: { fontFamily: fonts.sans, fontSize: 10, lineHeight: 14, color: c.mutedForeground },
  composition: { gap: 2, marginTop: 4, marginBottom: 3 },
  compositionRow: { fontFamily: fonts.sans, fontSize: 10, color: c.foreground },
  countrySection: { marginTop: 4, fontFamily: fonts.sansSemiBold, fontSize: 9, letterSpacing: 1, color: c.primary },
  personLink: { fontFamily: fonts.sansSemiBold, fontSize: 12, color: c.accent, textDecorationLine: 'underline' },
  peopleButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 4, backgroundColor: c.primary },
  peopleButtonText: { fontFamily: fonts.sansSemiBold, fontSize: 10, color: c.primaryForeground },
  peopleList: { maxHeight: 180, marginTop: 4 },
  personRow: { paddingVertical: 5, borderBottomWidth: 1, borderColor: c.border },
  personMeta: { fontFamily: fonts.sans, fontSize: 9, color: c.mutedForeground },
  personMetaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  familyLink: { fontFamily: fonts.sansSemiBold, fontSize: 9, color: c.accent, textDecorationLine: 'underline' },
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
  riverLegendRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  riverSwatch: { width: 20, height: 4, borderRadius: 2 },
});
