import { ScrollView, StyleSheet, Text, View } from 'react-native';
import colors, { fonts } from '@/constants/colors';

const c = colors.light;

/** The chronicle: newest first, scrolls inside its fixed share of the screen. */
export function LogPanel({ log }: { log: string[] }) {
  return (
    <View style={styles.panel} testID="panel-log">
      <Text style={styles.header}>ЛЕТОПИСЬ</Text>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list} nestedScrollEnabled>
        {log.length === 0 && <Text style={styles.empty}>Страницы пока пусты.</Text>}
        {log.map((line, i) => {
          const idx = line.indexOf(': ');
          const year = idx > 0 ? line.slice(0, idx) : '';
          const text = idx > 0 ? line.slice(idx + 2) : line;
          return (
            <View key={`${i}-${line}`} style={styles.row} testID={`text-log-${i}`}>
              <Text style={styles.year}>{year}</Text>
              <Text style={[styles.text, i > 0 && { opacity: 0.72 }]}>{text}</Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, backgroundColor: c.secondary },
  header: { paddingHorizontal: 12, paddingTop: 7, fontFamily: fonts.sansSemiBold, fontSize: 10, letterSpacing: 2, color: c.secondaryForeground, opacity: 0.6 },
  list: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8 },
  empty: { fontFamily: fonts.displayItalic, fontSize: 14, color: c.secondaryForeground, opacity: 0.6 },
  row: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  year: { fontFamily: fonts.mono, fontSize: 11, lineHeight: 17, color: '#e9806f' },
  text: { flex: 1, fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 17, color: c.secondaryForeground },
});
