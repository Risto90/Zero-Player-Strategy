import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Loading } from '@/components/Loading';
import colors, { fonts } from '@/constants/colors';
import type { PlayerRole } from '@/game/game';
import type { MapKind } from '@/game/geography';
import { deleteSavedGame, hasSavedGame, startNewGame } from '@/game/session';

const c = colors.light;

const MAPS: { id: MapKind; title: string; note: string }[] = [
  { id: 'world', title: 'Реальная Земля', note: 'Знакомые берега, чистая история' },
  { id: 'random', title: 'Новый мир', note: 'Материки, которых никто не видел' },
];
const ROLES: { id: PlayerRole; title: string; note: string }[] = [
  { id: 'all', title: 'Весь мир и все страны', note: 'Каждый год — мировая карта и карта каждой страны. Вы рисуете всё.' },
  { id: 'country', title: 'Одна страна', note: 'Вы — первое основанное государство. Остальных ведёт ИИ.' },
  { id: 'world', title: 'Только мировые события', note: 'Засухи, ливни, веры и народы. Страны живут сами.' },
  { id: 'observer', title: 'Наблюдатель', note: 'ИИ играет всё, годы идут сами. Смотрите.' },
];

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [hasSave, setHasSave] = useState(false);
  const [map, setMap] = useState<MapKind>('world');
  const [role, setRole] = useState<PlayerRole>('all');
  const [starting, setStarting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setStarting(false);
      void hasSavedGame().then((value) => alive && setHasSave(value));
      return () => {
        alive = false;
      };
    }, []),
  );

  const start = () => {
    setStarting(true);
    // Let the loading screen paint before the world is generated.
    setTimeout(() => {
      startNewGame(map, role);
      router.push('/play');
    }, 60);
  };

  const remove = async () => {
    await deleteSavedGame();
    setConfirmDelete(false);
    setHasSave(false);
  };

  if (starting) return <Loading text="Мир сотворяется…" />;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 40 }]}>
      <View style={styles.kickerRow}>
        <View style={styles.rule} />
        <Text style={styles.kicker}>АТЛАС БЕЗ ПОЛКОВОДЦЕВ</Text>
        <View style={styles.rule} />
      </View>
      <Text style={styles.title}>Zero</Text>
      <Text style={styles.titleItalic}>Strategy</Text>
      <Text style={styles.lead}>
        Вы не командуете армиями. Каждый год вам выпадают карты — основать державу, расколоть её, наслать засуху, зажечь новую веру — и вы рисуете их кистью по карте мира. Остальное дорисует история.
      </Text>

      {hasSave && (
        <View style={styles.section}>
          <Pressable onPress={() => router.push('/play')} style={({ pressed }) => [styles.continue, pressed && styles.pressed]} testID="button-continue">
            <View style={{ flex: 1 }}>
              <Text style={styles.continueTitle}>Продолжить летопись</Text>
              <Text style={styles.continueNote}>Сохранено на этом устройстве</Text>
            </View>
            <Feather name="arrow-right" size={22} color={c.primaryForeground} />
          </Pressable>
          {!confirmDelete ? (
            <Pressable onPress={() => setConfirmDelete(true)} style={styles.deleteLink} hitSlop={8} testID="button-delete-save">
              <Feather name="trash-2" size={13} color={c.mutedForeground} />
              <Text style={styles.deleteText}>Удалить сохранение</Text>
            </Pressable>
          ) : (
            <View style={styles.confirm}>
              <Text style={styles.confirmText}>Стереть этот мир навсегда?</Text>
              <Pressable onPress={() => void remove()} style={styles.confirmYes} testID="button-confirm-delete">
                <Text style={styles.confirmYesText}>Удалить</Text>
              </Pressable>
              <Pressable onPress={() => setConfirmDelete(false)} style={styles.confirmNo} testID="button-cancel-delete">
                <Text style={styles.confirmNoText}>Отмена</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      <View style={styles.sectionWide}>
        <Text style={styles.h2}>
          <Text style={styles.num}>I </Text> Карта
        </Text>
        <View style={styles.mapRow}>
          {MAPS.map((m) => {
            const on = map === m.id;
            return (
              <Pressable key={m.id} onPress={() => setMap(m.id)} style={[styles.mapCard, on && styles.mapCardOn]} testID={`button-map-${m.id}`}>
                <Text style={[styles.mapTitle, on && { color: c.background }]}>{m.title}</Text>
                <Text style={[styles.mapNote, on && { color: c.background }]}>{m.note}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.h2}>
          <Text style={styles.num}>II </Text> Роль
        </Text>
        <View style={styles.roles}>
          {ROLES.map((r, i) => {
            const on = role === r.id;
            return (
              <Pressable key={r.id} onPress={() => setRole(r.id)} style={[styles.role, i > 0 && styles.roleDivider, on && { backgroundColor: c.muted }]} testID={`button-role-${r.id}`}>
                <View style={[styles.radio, on && { borderColor: c.primary }]}>{on && <View style={styles.radioDot} />}</View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.roleTitle}>{r.title}</Text>
                  <Text style={styles.roleNote}>{r.note}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        <Pressable onPress={start} style={({ pressed }) => [styles.start, pressed && styles.pressed]} testID="button-start">
          <Text style={styles.startText}>Сотворить мир</Text>
          <Feather name="arrow-right" size={22} color={c.primaryForeground} />
        </Pressable>
        {hasSave && <Text style={styles.replaceNote}>Новый мир заменит текущее сохранение.</Text>}
        <Pressable onPress={() => router.push('/city-icons-review')} style={styles.iconReviewLink} testID="link-city-icons-review">
          <Feather name="eye" size={14} color={c.mutedForeground} />
          <Text style={styles.deleteText}>Проверить значки городов</Text>
          <Feather name="chevron-right" size={14} color={c.mutedForeground} />
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background },
  content: { paddingHorizontal: 20, maxWidth: 560, width: '100%', alignSelf: 'center' },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth * 2, backgroundColor: c.foreground, opacity: 0.4 },
  kicker: { fontFamily: fonts.sansSemiBold, fontSize: 10, letterSpacing: 3, color: c.mutedForeground },
  title: { marginTop: 16, fontFamily: fonts.display, fontSize: 56, lineHeight: 56, color: c.foreground },
  titleItalic: { fontFamily: fonts.displayItalic, fontSize: 56, lineHeight: 62, color: c.primary },
  lead: { marginTop: 14, fontFamily: fonts.sans, fontSize: 15, lineHeight: 23, color: c.foreground, opacity: 0.82 },
  section: { marginTop: 32 },
  sectionWide: { marginTop: 40 },
  pressed: { opacity: 0.85, transform: [{ translateY: 1 }] },
  continue: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.primary, borderRadius: colors.radius, paddingHorizontal: 16, paddingVertical: 16 },
  continueTitle: { fontFamily: fonts.display, fontSize: 20, color: c.primaryForeground },
  continueNote: { fontFamily: fonts.sans, fontSize: 12, color: c.primaryForeground, opacity: 0.8 },
  deleteLink: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  deleteText: { fontFamily: fonts.sans, fontSize: 12, color: c.mutedForeground },
  confirm: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: c.destructive, borderRadius: colors.radius, padding: 10 },
  confirmText: { flex: 1, minWidth: 150, fontFamily: fonts.sans, fontSize: 12, color: c.foreground },
  confirmYes: { backgroundColor: c.destructive, borderRadius: colors.radius, paddingHorizontal: 12, paddingVertical: 7 },
  confirmYesText: { fontFamily: fonts.sansSemiBold, fontSize: 12, color: c.destructiveForeground },
  confirmNo: { borderWidth: 1, borderColor: c.border, borderRadius: colors.radius, paddingHorizontal: 12, paddingVertical: 7 },
  confirmNoText: { fontFamily: fonts.sans, fontSize: 12, color: c.foreground },
  h2: { fontFamily: fonts.display, fontSize: 24, color: c.foreground },
  num: { fontFamily: fonts.mono, fontSize: 14, color: c.primary },
  mapRow: { marginTop: 12, flexDirection: 'row', gap: 8 },
  mapCard: { flex: 1, borderWidth: 2, borderColor: c.border, backgroundColor: c.card, borderRadius: colors.radius, padding: 12 },
  mapCardOn: { borderColor: c.foreground, backgroundColor: c.foreground },
  mapTitle: { fontFamily: fonts.display, fontSize: 17, lineHeight: 21, color: c.foreground },
  mapNote: { marginTop: 4, fontFamily: fonts.sans, fontSize: 12, color: c.foreground, opacity: 0.75 },
  roles: { marginTop: 12, borderWidth: 2, borderColor: c.border, backgroundColor: c.card, borderRadius: colors.radius, overflow: 'hidden' },
  role: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 12, paddingVertical: 12 },
  roleDivider: { borderTopWidth: 1, borderTopColor: c.border },
  radio: { marginTop: 3, width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: 'rgba(44,30,23,0.4)', alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.primary },
  roleTitle: { fontFamily: fonts.sansSemiBold, fontSize: 15, color: c.foreground },
  roleNote: { marginTop: 2, fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 17, color: c.mutedForeground },
  start: { marginTop: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.primary, borderRadius: colors.radius, paddingVertical: 16 },
  startText: { fontFamily: fonts.display, fontSize: 20, color: c.primaryForeground },
  replaceNote: { marginTop: 8, textAlign: 'center', fontFamily: fonts.sans, fontSize: 11, color: c.mutedForeground },
  iconReviewLink: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 18, paddingVertical: 8 },
});
