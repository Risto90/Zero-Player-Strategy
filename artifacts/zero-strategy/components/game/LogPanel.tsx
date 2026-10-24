import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import colors, { fonts } from '@/constants/colors';
import { CHRONICLE_PAGE_SIZE, chroniclePage, type ChronicleEntry } from '@/game/chronicle';

const c = colors.light;

/** The chronicle: newest first, scrolls inside its fixed share of the screen. */
export function LogPanel({ log, transparent = false }: { log: ChronicleEntry[]; transparent?: boolean }) {
  const [visibleCount, setVisibleCount] = useState(CHRONICLE_PAGE_SIZE);
  const visibleEntries = chroniclePage(log, 0, visibleCount);
  const loadMore = () => setVisibleCount((count) => Math.min(log.length, count + CHRONICLE_PAGE_SIZE));
  return (
    <View style={[styles.panel, transparent && styles.transparentPanel]} testID="panel-log">
      <Text style={styles.header}>ЛЕТОПИСЬ</Text>
      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={styles.list}
        data={visibleEntries}
        keyExtractor={(entry, index) => `${entry.year}-${index}-${entry.text}`}
        nestedScrollEnabled
        ListEmptyComponent={<Text style={styles.empty}>Страницы пока пусты.</Text>}
        ListFooterComponent={visibleCount < log.length ? (
          <Pressable onPress={loadMore} accessibilityRole="button" style={styles.loadMore} testID="button-load-chronicle">
            <Text style={styles.loadMoreText}>Загрузить ещё · {Math.min(CHRONICLE_PAGE_SIZE, log.length - visibleCount)}</Text>
          </Pressable>
        ) : undefined}
        renderItem={({ item: entry, index }) => (
          <View style={styles.row} testID={`text-log-${index}`}>
            <Text style={styles.year}>{entry.year || '—'}</Text>
            <View style={styles.entry}>
              <Text style={[styles.text, index > 0 && { opacity: 0.72 }]}>{entry.text}</Text>
              {entry.important && <Text style={styles.important}>Важное событие</Text>}
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, backgroundColor: c.secondary },
  transparentPanel: { backgroundColor: 'transparent' },
  header: { paddingHorizontal: 12, paddingTop: 7, fontFamily: fonts.sansSemiBold, fontSize: 10, letterSpacing: 2, color: c.secondaryForeground, opacity: 0.6 },
  list: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8 },
  empty: { fontFamily: fonts.displayItalic, fontSize: 14, color: c.secondaryForeground, opacity: 0.6 },
  row: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  year: { fontFamily: fonts.mono, fontSize: 11, lineHeight: 17, color: '#e9806f' },
  entry: { flex: 1, gap: 2 },
  text: { flex: 1, fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 17, color: c.secondaryForeground },
  important: { alignSelf: 'flex-start', paddingHorizontal: 5, paddingVertical: 1, fontFamily: fonts.sansSemiBold, fontSize: 9, color: c.primaryForeground, backgroundColor: c.primary },
  loadMore: { alignSelf: 'center', marginTop: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: c.secondaryForeground },
  loadMoreText: { fontFamily: fonts.sansSemiBold, fontSize: 12, color: c.secondaryForeground },
});
