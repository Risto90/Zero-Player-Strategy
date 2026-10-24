import { Feather } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import colors, { fonts } from '@/constants/colors';
import {
  CHRONICLE_PAGE_SIZE,
  chroniclePage,
  isChronicleImportant,
  searchChronicle,
  type ChronicleEntry,
  type ChronicleObjectOption,
  type ChronicleReference,
} from '@/game/chronicle';

const c = colors.light;

/** The chronicle: newest first, searchable without loading the whole archive into the list. */
export function LogPanel({
  log,
  transparent = false,
  objectOptions = [],
  initialReference = null,
  showHeading = true,
  minimal = false,
}: {
  log: ChronicleEntry[];
  transparent?: boolean;
  objectOptions?: ChronicleObjectOption[];
  initialReference?: ChronicleReference | null;
  showHeading?: boolean;
  minimal?: boolean;
}) {
  const [visibleCount, setVisibleCount] = useState(CHRONICLE_PAGE_SIZE);
  const [textQuery, setTextQuery] = useState('');
  const [yearQuery, setYearQuery] = useState('');
  const [objectQuery, setObjectQuery] = useState('');
  const [selectedReference, setSelectedReference] = useState<ChronicleReference | null>(initialReference);
  const listRef = useRef<FlatList<ChronicleEntry> | null>(null);
  const matchingEntries = useMemo(() => searchChronicle(log, {
    text: textQuery,
    year: yearQuery,
    reference: selectedReference,
  }), [log, textQuery, yearQuery, selectedReference]);
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [textQuery, yearQuery, selectedReference]);
  const visibleEntries = chroniclePage(matchingEntries, 0, visibleCount);
  const selectedOption = selectedReference
    ? objectOptions.find(({ reference }) => reference.type === selectedReference.type && reference.id === selectedReference.id)
    : undefined;
  const matchingObjects = useMemo(() => {
    const normalizedQuery = objectQuery.trim().toLocaleLowerCase().replace(/ё/gu, 'е');
    if (!normalizedQuery) return [];
    return objectOptions
      .filter(({ label }) => label.toLocaleLowerCase().replace(/ё/gu, 'е').includes(normalizedQuery))
      .slice(0, 5);
  }, [objectOptions, objectQuery]);
  const resetPaging = () => setVisibleCount(CHRONICLE_PAGE_SIZE);
  const selectObject = (reference: ChronicleReference) => {
    setSelectedReference(reference);
    setObjectQuery('');
    resetPaging();
  };
  const loadMore = () => setVisibleCount((count) => Math.min(matchingEntries.length, count + CHRONICLE_PAGE_SIZE));

  if (minimal) {
    return (
      <View style={[styles.panel, transparent && styles.transparentPanel]} testID="panel-log">
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.minimalListContent}
          data={log}
          keyExtractor={(entry, index) => `${entry.year}-${index}-${entry.text}`}
          nestedScrollEnabled
          renderItem={({ item: entry, index }) => (
            <View style={styles.minimalRow} testID={`text-log-${index}`}>
              <Text style={styles.minimalYear}>{entry.year || '—'}</Text>
              <View style={styles.entry}>
                <Text style={[styles.minimalText, index > 0 && styles.minimalOlderText]}>{entry.text}</Text>
              </View>
            </View>
          )}
        />
      </View>
    );
  }

  return (
    <View style={[styles.panel, transparent && styles.transparentPanel]} testID="panel-log">
      {showHeading && <Text style={styles.header}>ЛЕТОПИСЬ</Text>}
      <View style={styles.filters}>
        <View style={styles.searchRow}>
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
                accessibilityRole="button" accessibilityLabel="Очистить текстовый поиск" testID="button-clear-chronicle-search">
                <Feather name="x-circle" size={16} color={c.mutedForeground} />
              </Pressable>
            )}
          </View>
          <TextInput
            value={yearQuery}
            onChangeText={(value) => {
              setYearQuery(value.replace(/[^\d-]/gu, '').replace(/(?!^)-/gu, ''));
              resetPaging();
            }}
            placeholder="Год"
            placeholderTextColor={c.mutedForeground}
            keyboardType="numbers-and-punctuation"
            returnKeyType="search"
            accessibilityLabel="Фильтр по году"
            style={styles.yearInput}
            maxLength={12}
            testID="input-chronicle-year"
          />
        </View>
        <View style={styles.objectSearch}>
          <Feather name="filter" size={14} color={c.mutedForeground} />
          <TextInput
            value={objectQuery}
            onChangeText={setObjectQuery}
            placeholder={selectedOption ? 'Выбрать другой объект' : 'Страна, город или персонаж'}
            placeholderTextColor={c.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Найти объект для фильтра летописи"
            style={styles.input}
            testID="input-chronicle-object"
          />
        </View>
        {!!selectedReference && (
          <View style={styles.selectedFilter}>
            <Text style={styles.selectedLabel} numberOfLines={1}>
              {selectedOption?.label ?? `${selectedReference.type} · ${selectedReference.id}`}
            </Text>
            <Pressable onPress={() => { setSelectedReference(null); resetPaging(); }}
              hitSlop={8} accessibilityRole="button" accessibilityLabel="Сбросить фильтр объекта"
              testID="button-clear-chronicle-object">
              <Feather name="x" size={14} color={c.primaryForeground} />
            </Pressable>
          </View>
        )}
        {!!objectQuery && (
          <View style={styles.suggestions} testID="list-chronicle-object-suggestions">
            {matchingObjects.length ? matchingObjects.map(({ reference, label }) => (
              <Pressable key={`${reference.type}:${reference.id}`} onPress={() => selectObject(reference)}
                style={styles.suggestion} accessibilityRole="button">
                <Text style={styles.suggestionText} numberOfLines={1}>{label}</Text>
              </Pressable>
            )) : <Text style={styles.noSuggestions}>Объекты не найдены.</Text>}
          </View>
        )}
      </View>
      <Text style={styles.resultCount} accessibilityLiveRegion="polite">
        {matchingEntries.length ? `${matchingEntries.length} событий` : ''}
      </Text>
      <FlatList
        ref={listRef}
        style={styles.list}
        contentContainerStyle={styles.listContent}
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
          <View style={styles.row} testID={`text-log-${index}`}>
            <Text style={styles.year}>{entry.year || '—'}</Text>
            <View style={styles.entry}>
              <Text style={[styles.text, index > 0 && { opacity: 0.72 }]}>{entry.text}</Text>
              {isChronicleImportant(entry, selectedReference) && <Text style={styles.important}>Важное событие</Text>}
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
  filters: { paddingHorizontal: 10, paddingTop: 7, gap: 5 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  textSearch: { flex: 1, minWidth: 0, minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, borderWidth: 1, borderColor: c.input, backgroundColor: c.card },
  objectSearch: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, borderWidth: 1, borderColor: c.input, backgroundColor: c.card },
  input: { flex: 1, minWidth: 0, paddingVertical: 5, fontFamily: fonts.sans, fontSize: 12, color: c.foreground },
  yearInput: { width: 68, height: 34, paddingHorizontal: 7, borderWidth: 1, borderColor: c.input, backgroundColor: c.card, fontFamily: fonts.mono, fontSize: 11, color: c.foreground },
  selectedFilter: { alignSelf: 'flex-start', maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: c.primary },
  selectedLabel: { flexShrink: 1, fontFamily: fonts.sansMedium, fontSize: 10, color: c.primaryForeground },
  suggestions: { maxHeight: 128, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  suggestion: { minHeight: 30, justifyContent: 'center', paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: c.border },
  suggestionText: { fontFamily: fonts.sans, fontSize: 11, color: c.foreground },
  noSuggestions: { padding: 8, fontFamily: fonts.sans, fontSize: 11, color: c.mutedForeground },
  resultCount: { minHeight: 16, paddingHorizontal: 12, paddingTop: 2, fontFamily: fonts.mono, fontSize: 9, color: c.secondaryForeground, opacity: 0.65 },
  list: { flex: 1, minHeight: 0 },
  listContent: { paddingHorizontal: 12, paddingTop: 2, paddingBottom: 8, flexGrow: 1 },
  minimalListContent: { paddingHorizontal: 16, paddingTop: 54, paddingBottom: 20 },
  empty: { paddingTop: 4, fontFamily: fonts.displayItalic, fontSize: 14, color: c.secondaryForeground, opacity: 0.7 },
  row: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  minimalRow: { flexDirection: 'row', gap: 10, paddingVertical: 5 },
  year: { fontFamily: fonts.mono, fontSize: 11, lineHeight: 17, color: '#e9806f' },
  minimalYear: { minWidth: 38, fontFamily: fonts.mono, fontSize: 12, lineHeight: 20, color: '#f08b79' },
  entry: { flex: 1, gap: 2 },
  text: { flex: 1, fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 17, color: c.secondaryForeground },
  minimalText: { flexShrink: 1, fontFamily: fonts.sans, fontSize: 14, lineHeight: 20, color: '#f5eee8' },
  minimalOlderText: { opacity: 0.82 },
  important: { alignSelf: 'flex-start', paddingHorizontal: 5, paddingVertical: 1, fontFamily: fonts.sansSemiBold, fontSize: 9, color: c.primaryForeground, backgroundColor: c.primary },
  loadMore: { alignSelf: 'center', marginTop: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: c.secondaryForeground },
  loadMoreText: { fontFamily: fonts.sansSemiBold, fontSize: 12, color: c.secondaryForeground },
});
