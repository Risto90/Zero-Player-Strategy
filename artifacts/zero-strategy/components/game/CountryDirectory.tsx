import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors, { fonts } from '@/constants/colors';
import { ageStage, GOVERNMENTS, MODIFIERS, governmentOf } from '@/game/government';
import { fmt } from '@/game/format';
import type { Game, GameSnapshot } from '@/game/game';

const c = colors.light;

export function CountryDirectory({
  game,
  snap,
  visible,
  onClose,
  onPersonPress,
}: {
  game: Game;
  snap: GameSnapshot;
  visible: boolean;
  onClose: () => void;
  onPersonPress: (id: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showPeople, setShowPeople] = useState(false);
  const countries = game.world.countries.filter((country) => country.pixels > 0)
    .sort((a, b) => (snap.legend.countries.find((row) => row.id === b.id)?.value ?? 0) -
      (snap.legend.countries.find((row) => row.id === a.id)?.value ?? 0));

  const selectCountry = (id: number) => {
    setSelectedId((current) => current === id ? null : id);
    setShowPeople(false);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.screen, { paddingTop: insets.top + 10 }]}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>АТЛАС</Text>
            <Text style={styles.title}>Государства</Text>
          </View>
          <Pressable onPress={onClose} style={styles.close} accessibilityLabel="Закрыть список стран">
            <Feather name="x" size={22} color={c.foreground} />
          </Pressable>
        </View>
        <FlatList
          data={countries}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          renderItem={({ item: country }) => {
            const population = snap.legend.countries.find((row) => row.id === country.id)?.value ?? 0;
            const selected = selectedId === country.id;
            const people = showPeople && selected ? game.importantPeople(country.id) : [];
            return (
              <View style={[styles.countryCard, selected && styles.selectedCard]}>
                <Pressable onPress={() => selectCountry(country.id)} style={styles.countryRow}>
                  <View style={[styles.swatch, { backgroundColor: country.color }]} />
                  <View style={styles.countryNameBlock}>
                    <Text style={styles.countryName}>{country.rank} {country.name}</Text>
                    <Text style={styles.summary}>{fmt(country.pixels)} земель · {fmt(population)} чел.</Text>
                  </View>
                  <Feather name={selected ? 'chevron-up' : 'chevron-down'} size={18} color={c.mutedForeground} />
                </Pressable>
                {selected && (
                  <View style={styles.details}>
                    <Text style={styles.infoLine}>Форма правления · {GOVERNMENTS[governmentOf(country.government).id].name}</Text>
                    {country.modifiers.map((modifier) => (
                      <Text style={styles.modifier} key={modifier}>· {MODIFIERS[modifier].name}: {MODIFIERS[modifier].effect}</Text>
                    ))}
                    <Text style={styles.section}>ПРАВИТЕЛЬ</Text>
                    <Pressable onPress={() => onPersonPress(country.ruler.id)}>
                      <Text style={styles.personLink}>{country.ruler.name} · {country.ruler.age} лет ({ageStage(country.ruler.age)})</Text>
                    </Pressable>
                    {country.heir && (
                      <>
                        <Text style={styles.section}>ОЖИДАЕМЫЙ НАСЛЕДНИК</Text>
                        <Pressable onPress={() => onPersonPress(country.heir!.id)}>
                          <Text style={styles.personLink}>{country.heir.name} · {country.heir.age} лет ({ageStage(country.heir.age)})</Text>
                        </Pressable>
                      </>
                    )}
                    <Pressable onPress={() => setShowPeople((current) => !current)} style={styles.peopleButton}>
                      <Feather name="users" size={14} color={c.primaryForeground} />
                      <Text style={styles.peopleButtonText}>{showPeople ? 'Скрыть важных персонажей' : 'Важные живые персонажи'}</Text>
                    </Pressable>
                    {showPeople && (
                      <ScrollView style={styles.peopleList} nestedScrollEnabled>
                        {people.map((person) => (
                          <Pressable key={person.id} onPress={() => onPersonPress(person.id)} style={styles.personRow}>
                            <Text style={styles.personLink}>{person.name}</Text>
                            <Text style={styles.personMeta}>
                              {person.age} лет · {game.world.cultures[person.cultureId]?.name ?? 'культура неизвестна'} · {person.religionId === null ? 'без веры' : game.world.religions[person.religionId]?.name ?? 'вера неизвестна'}
                              {' · '}{person.familyId === country.ruler.familyId ? 'династия правителя' : 'семья прежних правителей'}
                            </Text>
                          </Pressable>
                        ))}
                        {!people.length && <Text style={styles.summary}>Нет живых персонажей.</Text>}
                      </ScrollView>
                    )}
                  </View>
                )}
              </View>
            );
          }}
          ListEmptyComponent={<Text style={styles.summary}>На карте пока нет государств.</Text>}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 12, borderBottomWidth: 2, borderColor: c.foreground },
  eyebrow: { fontFamily: fonts.sansSemiBold, fontSize: 10, letterSpacing: 2, color: c.primary },
  title: { fontFamily: fonts.display, fontSize: 24, color: c.foreground },
  close: { width: 40, height: 40, borderWidth: 1, borderColor: c.border, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card },
  list: { padding: 12, gap: 8 },
  countryCard: { borderWidth: 1, borderColor: c.border, borderRadius: 4, backgroundColor: c.card, overflow: 'hidden' },
  selectedCard: { borderColor: c.primary, borderWidth: 2 },
  countryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  swatch: { width: 14, height: 14, borderWidth: 1, borderColor: c.foreground, borderRadius: 2 },
  countryNameBlock: { flex: 1 },
  countryName: { fontFamily: fonts.displayRegular, fontSize: 17, color: c.foreground },
  summary: { fontFamily: fonts.sans, fontSize: 12, color: c.mutedForeground },
  details: { borderTopWidth: 1, borderColor: c.border, padding: 12, gap: 4 },
  infoLine: { fontFamily: fonts.sans, fontSize: 12, color: c.foreground },
  modifier: { fontFamily: fonts.sans, fontSize: 11, color: c.mutedForeground },
  section: { marginTop: 6, fontFamily: fonts.sansSemiBold, fontSize: 10, letterSpacing: 1, color: c.primary },
  personLink: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: c.accent, textDecorationLine: 'underline' },
  peopleButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 4, backgroundColor: c.primary },
  peopleButtonText: { fontFamily: fonts.sansSemiBold, fontSize: 11, color: c.primaryForeground },
  peopleList: { maxHeight: 240, marginTop: 4 },
  personRow: { paddingVertical: 6, borderBottomWidth: 1, borderColor: c.border },
  personMeta: { fontFamily: fonts.sans, fontSize: 10, color: c.mutedForeground },
});
