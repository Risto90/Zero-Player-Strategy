import { Feather } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LogPanel } from '@/components/game/LogPanel';
import colors, { fonts } from '@/constants/colors';
import type { ChronicleEntry, ChronicleObjectOption, ChronicleReference } from '@/game/chronicle';
import { closeProfileToMap, rememberProfilePath } from '@/game/profileNavigation';
import type { World } from '@/game/world';

const c = colors.light;

export function ProfileLayout({
  eyebrow,
  title,
  subtitle,
  details,
  chronicle,
  archive = chronicle,
  world,
  initialReference,
  objectOptions = [],
  extraTabs = [],
  showChronicleTab = true,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  details: ReactNode;
  chronicle: ChronicleEntry[];
  archive?: ChronicleEntry[];
  world?: World;
  initialReference?: ChronicleReference;
  objectOptions?: ChronicleObjectOption[];
  extraTabs?: { key: string; label: string; content: ReactNode }[];
  showChronicleTab?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const [tab, setTab] = useState('details');
  const selectedExtraTab = extraTabs.find((item) => item.key === tab);
  useEffect(() => rememberProfilePath(pathname), [pathname]);
  useEffect(() => {
    if ((!showChronicleTab && tab === 'chronicle') || (tab !== 'details' && tab !== 'chronicle' && !selectedExtraTab)) {
      setTab('details');
    }
  }, [extraTabs, selectedExtraTab, showChronicleTab, tab]);
  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} accessibilityLabel="Назад">
          <Feather name="arrow-left" size={18} color={c.foreground} />
          <Text style={styles.backText}>Назад</Text>
        </Pressable>
        <View style={styles.headerRight}>
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <Pressable onPress={closeProfileToMap} style={styles.closeButton}
            accessibilityRole="button" accessibilityLabel="Вернуться к карте" testID="profile-close-map">
            <Feather name="x" size={19} color={c.foreground} />
          </Pressable>
        </View>
      </View>
      <View style={styles.heading}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={styles.tabScroller} contentContainerStyle={styles.tabs}>
        <Pressable onPress={() => setTab('details')} style={[styles.tab, tab === 'details' && styles.activeTab]}
          accessibilityState={{ selected: tab === 'details' }}>
          <Text style={[styles.tabText, tab === 'details' && styles.activeTabText]}>Сведения</Text>
        </Pressable>
        {extraTabs.map((item) => (
          <Pressable key={item.key} onPress={() => setTab(item.key)}
            style={[styles.tab, tab === item.key && styles.activeTab]}
            accessibilityState={{ selected: tab === item.key }}>
            <Text style={[styles.tabText, tab === item.key && styles.activeTabText]}>{item.label}</Text>
          </Pressable>
        ))}
        {showChronicleTab && (
          <Pressable onPress={() => setTab('chronicle')} style={[styles.tab, tab === 'chronicle' && styles.activeTab]}
            accessibilityState={{ selected: tab === 'chronicle' }}>
            <Text style={[styles.tabText, tab === 'chronicle' && styles.activeTabText]}>Летопись · {chronicle.length}</Text>
          </Pressable>
        )}
      </ScrollView>
      {tab === 'details' ? (
        <ScrollView style={styles.pageScroll} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
          nestedScrollEnabled>
          {details}
        </ScrollView>
      ) : tab === 'chronicle' ? (
        <View style={[styles.pageScroll, styles.chroniclePanel, { paddingBottom: insets.bottom }]}>
          <LogPanel
            key={initialReference ? `${initialReference.type}:${initialReference.id}` : 'all'}
            log={archive}
            world={world}
            initialReference={initialReference}
            objectOptions={objectOptions}
            showHeading={false}
          />
        </View>
      ) : selectedExtraTab ? (
        <View style={[styles.pageScroll, styles.extraTabContent, { paddingBottom: insets.bottom }]}>
          {selectedExtraTab.content}
        </View>
      ) : (
        <ScrollView style={styles.pageScroll} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
          nestedScrollEnabled>
          {details}
        </ScrollView>
      )}
    </View>
  );
}

export function ProfileSection({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function ProfileIntro({ mark, children }: { mark: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.introRow}>
      <View style={styles.introMark}>{mark}</View>
      <View style={styles.introContent}>{children}</View>
    </View>
  );
}

export function ProfileLink({ title, note, onPress }: { title: string; note?: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="link" style={styles.linkRow}>
      <Text style={styles.link}>{title}</Text>
      {note && <Text style={styles.note}>{note}</Text>}
    </Pressable>
  );
}

export function ProfileFact({ children }: { children: ReactNode }) {
  return <Text style={styles.fact}>{children}</Text>;
}

export function ProfileScrollList({ children }: { children: ReactNode }) {
  return (
    <ScrollView style={styles.listScroll} contentContainerStyle={styles.listContent} nestedScrollEnabled>
      {children}
    </ScrollView>
  );
}

export function MissingProfile({ title }: { title: string }) {
  return (
    <View style={[styles.screen, styles.missing]}>
      <Text style={styles.title}>{title}</Text>
      <Pressable onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>Назад</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background },
  header: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, borderBottomWidth: 2, borderColor: c.foreground },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  backText: { fontFamily: fonts.sansMedium, fontSize: 13, color: c.foreground },
  headerRight: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 9 },
  eyebrow: { fontFamily: fonts.sansSemiBold, fontSize: 10, letterSpacing: 1.6, color: c.primary },
  closeButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  heading: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 8, gap: 2 },
  title: { fontFamily: fonts.display, fontSize: 30, color: c.foreground },
  subtitle: { fontFamily: fonts.sans, fontSize: 13, color: c.mutedForeground },
  tabScroller: { flexGrow: 0 },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 18, paddingBottom: 10 },
  tab: { paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  activeTab: { backgroundColor: c.primary, borderColor: c.primary },
  tabText: { fontFamily: fonts.sansSemiBold, fontSize: 12, color: c.foreground },
  activeTabText: { color: c.primaryForeground },
  pageScroll: { flex: 1 },
  extraTabContent: { minHeight: 0 },
  chroniclePanel: { maxHeight: 560, overflow: 'hidden', backgroundColor: c.secondary },
  content: { padding: 18, paddingTop: 8, gap: 14 },
  introRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  introMark: { width: '44%', maxWidth: 144, alignItems: 'flex-start', flexShrink: 0 },
  introContent: { flex: 1, minWidth: 0 },
  section: { paddingTop: 8, gap: 5, borderTopWidth: 1, borderColor: c.border },
  sectionTitle: { marginBottom: 3, fontFamily: fonts.sansSemiBold, fontSize: 11, letterSpacing: 1.4, color: c.primary },
  fact: { fontFamily: fonts.sans, fontSize: 13, color: c.foreground },
  note: { fontFamily: fonts.sans, fontSize: 12, color: c.mutedForeground },
  linkRow: { paddingVertical: 5, borderBottomWidth: 1, borderColor: c.border },
  link: { fontFamily: fonts.sansSemiBold, fontSize: 14, color: c.accent, textDecorationLine: 'underline' },
  listScroll: { maxHeight: 190, flexGrow: 0, borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.border },
  listContent: { paddingVertical: 3 },
  empty: { fontFamily: fonts.displayItalic, fontSize: 14, color: c.mutedForeground },
  missing: { alignItems: 'center', justifyContent: 'center', gap: 16 },
});
