import { Feather } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import colors, { fonts } from '@/constants/colors';
import {
  CHRONICLE_PAGE_SIZE,
  chronicleObjectOptions,
  chroniclePage,
  isChronicleImportant,
  searchChronicle,
  type ChronicleEntry,
  type ChronicleObjectOption,
  type ChronicleReference,
} from '@/game/chronicle';
import { ChronicleMessage, chronicleReferencesEqual } from './ChronicleMessage';
import type { World } from '@/game/world';

const c = colors.light;

/** Летопись отображает новые записи первыми и фильтрует архив до передачи его списку. */
export function LogPanel({
  log,
  world,
  transparent = false,
  objectOptions = [],
  initialReference = null,
  showHeading = true,
  minimal = false,
}: {
  log: ChronicleEntry[];
  world?: World;
  transparent?: boolean;
  objectOptions?: ChronicleObjectOption[];
  initialReference?: ChronicleReference | null;
  showHeading?: boolean;
  minimal?: boolean;
}) {
  const [visibleCount, setVisibleCount] = useState(CHRONICLE_PAGE_SIZE);
  const [textQuery, setTextQuery] = useState('');
  const [selectedReferences, setSelectedReferences] = useState<ChronicleReference[]>(
    () => initialReference ? [initialReference] : [],
  );
  const [selectedYears, setSelectedYears] = useState<number[]>([]);
  const listRef = useRef<FlatList<ChronicleEntry> | null>(null);
  const matchingEntries = useMemo(() => searchChronicle(log, {
    text: textQuery,
    references: selectedReferences,
    years: selectedYears,
  }), [log, textQuery, selectedReferences, selectedYears]);
  const activeOptions = useMemo(
    () => world ? chronicleObjectOptions(world) : objectOptions,
    [objectOptions, world, world?.version],
  );
  const visibleReferences = selectedReferences.filter((reference) =>
    !initialReference || !chronicleReferencesEqual(initialReference, reference));
  const hasActiveFilters = visibleReferences.length > 0 || selectedYears.length > 0;
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [textQuery, selectedReferences, selectedYears]);
  const visibleEntries = chroniclePage(matchingEntries, 0, visibleCount);
  const resetPaging = () => setVisibleCount(CHRONICLE_PAGE_SIZE);
  const addReference = (reference: ChronicleReference) => {
    setSelectedReferences((current) => current.some((item) => chronicleReferencesEqual(item, reference))
      ? current
      : [...current, reference]);
    resetPaging();
  };
  const addYear = (year: number) => {
    if (!year) return;
    setSelectedYears((current) => current.includes(year) ? current : [...current, year]);
    resetPaging();
  };
  const removeReference = (reference: ChronicleReference) => {
    if (initialReference && chronicleReferencesEqual(initialReference, reference)) return;
    setSelectedReferences((current) => current.filter((item) => !chronicleReferencesEqual(item, reference)));
    resetPaging();
  };
  const removeYear = (year: number) => {
    setSelectedYears((current) => current.filter((item) => item !== year));
    resetPaging();
  };
  const labelForReference = (reference: ChronicleReference) =>
    activeOptions.find(({ reference: item }) => chronicleReferencesEqual(item, reference))?.label
      ?.replace(/ · (?:страна|город|персонаж|этнос|религия)$/u, '') ??
    `${reference.type} · ${reference.id}`;
  const loadMore = () => setVisibleCount((count) => Math.min(matchingEntries.length, count + CHRONICLE_PAGE_SIZE));

  return (
    <View style={[styles.panel, transparent && styles.transparentPanel]} testID="panel-log">
      {!minimal && showHeading && <Text style={styles.header}>ЛЕТОПИСЬ</Text>}
      {!minimal && (
        <View style={styles.filters}>
          <View style={styles.textSearch}>
            <Feather name="search" size={14} color={c.mutedForeground} />
            <TextInput
              value={textQuery}
              onChangeText={(value) => {
                setTextQuery(value);
                resetPaging();
              }}
              placeholder="Найти событие"
              placeholderTextColor={c.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel="Поиск событий по словам"
              style={styles.input}
              testID="input-chronicle-search"
            />
            {!!textQuery && (
              <Pressable onPress={() => { setTextQuery(''); resetPaging(); }} hitSlop={8}
                accessibilityRole="button" accessibilityLabel="Очистить текстовый поиск"
                testID="button-clear-chronicle-search">
                <Feather name="x-circle" size={16} color={c.mutedForeground} />
              </Pressable>
            )}
          </View>
        </View>
      )}
      {hasActiveFilters && (
        <View style={[styles.activeFilters, minimal && styles.minimalActiveFilters]} testID="chronicle-active-filters">
          {visibleReferences.map((reference) => (
            <View key={`${reference.type}:${reference.id}`} style={styles.filterChip}>
              <Text style={styles.filterLabel} numberOfLines={1}>{labelForReference(reference)}</Text>
              <Pressable onPress={() => removeReference(reference)} hitSlop={6}
                accessibilityRole="button" accessibilityLabel={`Убрать фильтр: ${labelForReference(reference)}`}>
                <Feather name="x" size={12} color={c.primaryForeground} />
              </Pressable>
            </View>
          ))}
          {selectedYears.map((year) => (
            <View key={`year:${year}`} style={styles.filterChip}>
              <Text style={styles.filterLabel}>Год · {year}</Text>
              <Pressable onPress={() => removeYear(year)} hitSlop={6}
                accessibilityRole="button" accessibilityLabel={`Убрать фильтр по году ${year}`}>
                <Feather name="x" size={12} color={c.primaryForeground} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      {!minimal && (
        <Text style={styles.resultCount} accessibilityLiveRegion="polite">
          {matchingEntries.length ? `${matchingEntries.length} событий` : ''}
        </Text>
      )}
      <FlatList
        ref={listRef}
        style={styles.list}
        contentContainerStyle={minimal
          ? hasActiveFilters ? styles.minimalFilteredListContent : styles.minimalListContent
          : styles.listContent}
        data={visibleEntries}
        keyExtractor={(entry, index) => `${entry.year}-${index}-${entry.text}`}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={styles.empty} testID="text-chronicle-no-results">Ничего не найдено. Измените запрос или сбросьте фильтры.</Text>}
        ListFooterComponent={visibleCount < matchingEntries.length ? (
          <Pressable onPress={loadMore} accessibilityRole="button" style={styles.loadMore} testID="button-load-chronicle">
            <Text style={styles.loadMoreText}>Загрузить ещё · {Math.min(CHRONICLE_PAGE_SIZE, matchingEntries.length - visibleCount)}</Text>
          </Pressable>
        ) : undefined}
        renderItem={({ item: entry, index }) => (
          <View style={minimal ? styles.minimalRow : styles.row} testID={`text-log-${index}`}>
            <Pressable onPress={() => addYear(entry.year)} disabled={!entry.year || selectedYears.includes(entry.year)}
              accessibilityRole="button" accessibilityLabel={`Оставить события ${entry.year || 'без года'}`}
              testID={`button-filter-chronicle-year-${entry.year}-${index}`}>
              <Text style={minimal ? styles.minimalYear : styles.year}>{entry.year || '—'}</Text>
            </Pressable>
            <View style={styles.entry}>
              <ChronicleMessage
                entry={entry}
                world={world}
                objectOptions={activeOptions}
                selectedReferences={selectedReferences}
                initialReference={initialReference}
                onAddReference={addReference}
                minimal={minimal}
              />
              {!minimal && selectedReferences.some((reference) => isChronicleImportant(entry, reference)) && (
                <Text style={styles.important}>Важное событие</Text>
              )}
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, minHeight: 0, backgroundColor: c.secondary },
  transparentPanel: { backgroundColor: 'transparent' },
  header: { paddingHorizontal: 12, paddingTop: 7, fontFamily: fonts.sansSemiBold, fontSize: 10, letterSpacing: 2, color: c.secondaryForeground, opacity: 0.6 },
  filters: { paddingHorizontal: 10, paddingTop: 7 },
  textSearch: { minWidth: 0, minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, borderWidth: 1, borderColor: c.input, backgroundColor: c.card },
  input: { flex: 1, minWidth: 0, paddingVertical: 5, fontFamily: fonts.sans, fontSize: 12, color: c.foreground },
  activeFilters: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5 },
  minimalActiveFilters: { paddingTop: 48 },
  filterChip: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 7, paddingVertical: 4, backgroundColor: c.primary },
  filterLabel: { flexShrink: 1, fontFamily: fonts.sansMedium, fontSize: 10, color: c.primaryForeground },
  resultCount: { minHeight: 16, paddingHorizontal: 12, paddingTop: 2, fontFamily: fonts.mono, fontSize: 9, color: c.secondaryForeground, opacity: 0.65 },
  list: { flex: 1, minHeight: 0 },
  listContent: { paddingHorizontal: 12, paddingTop: 2, paddingBottom: 8, flexGrow: 1 },
  minimalListContent: { paddingHorizontal: 16, paddingTop: 54, paddingBottom: 20 },
  minimalFilteredListContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20 },
  empty: { paddingTop: 4, fontFamily: fonts.displayItalic, fontSize: 14, color: c.secondaryForeground, opacity: 0.7 },
  row: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  minimalRow: { flexDirection: 'row', gap: 10, paddingVertical: 5 },
  yearButton: { minWidth: 44 },
  year: { fontFamily: fonts.mono, fontSize: 11, lineHeight: 17, color: '#e9806f' },
  minimalYear: { minWidth: 38, fontFamily: fonts.mono, fontSize: 12, lineHeight: 20, color: '#f08b79' },
  entry: { flex: 1, gap: 2 },
  important: { alignSelf: 'flex-start', paddingHorizontal: 5, paddingVertical: 1, fontFamily: fonts.sansSemiBold, fontSize: 9, color: c.primaryForeground, backgroundColor: c.primary },
  loadMore: { alignSelf: 'center', marginTop: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: c.secondaryForeground },
  loadMoreText: { fontFamily: fonts.sansSemiBold, fontSize: 12, color: c.secondaryForeground },
});
