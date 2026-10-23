import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors, { fonts } from '@/constants/colors';
import type { Person } from '@/game/government';
import { useGameSnapshot } from '@/game/useGame';
import type { Game } from '@/game/game';
import { currentGame } from '@/game/session';

const c = colors.light;

export default function DynastyPage() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const game = currentGame();
  const insets = useSafeAreaInsets();
  const familyId = Number(rawId);
  if (!game || !Number.isFinite(familyId)) {
    return (
      <View style={[styles.screen, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.title}>Династия не найдена</Text>
        <Pressable onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>Назад</Text></Pressable>
      </View>
    );
  }
  return <DynastyTree game={game} familyId={familyId} />;
}

function DynastyTree({ game, familyId }: { game: Game; familyId: number }) {
  useGameSnapshot(game);
  const insets = useSafeAreaInsets();
  const people = game.world.people;
  const members = people.filter((person) => person.familyId === familyId).sort((a, b) => a.bornAt - b.bornAt);
  const byId = new Map(people.map((person) => [person.id, person]));
  const memberIds = new Set(members.map((person) => person.id));
  const generationCache = new Map<number, number>();
  const generationOf = (person: Person, visiting = new Set<number>()): number => {
    const cached = generationCache.get(person.id);
    if (cached !== undefined) return cached;
    if (visiting.has(person.id)) return 0;
    const nextVisiting = new Set(visiting).add(person.id);
    const parents = person.parents.map((id) => byId.get(id)).filter((parent): parent is Person => !!parent && memberIds.has(parent.id));
    const generation = parents.length ? Math.max(...parents.map((parent) => generationOf(parent, nextVisiting))) + 1 : 0;
    generationCache.set(person.id, generation);
    return generation;
  };
  const generations = new Map<number, Person[]>();
  for (const person of members) {
    const generation = generationOf(person);
    generations.set(generation, [...(generations.get(generation) ?? []), person]);
  }
  const familyName = members[0]?.familyName ?? 'Неизвестная фамилия';
  const openPerson = (id: number) => router.push({ pathname: '/person/[id]', params: { id: String(id) } });
  const personLink = (person: Person) => (
    <Pressable key={person.id} onPress={() => openPerson(person.id)}>
      <Text style={styles.link}>{person.name}</Text>
    </Pressable>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} accessibilityLabel="Назад">
          <Feather name="arrow-left" size={18} color={c.foreground} />
          <Text style={styles.backText}>Назад</Text>
        </Pressable>
        <Text style={styles.eyebrow}>РОДОСЛОВНАЯ</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <Text style={styles.title}>{familyName}</Text>
        <Text style={styles.subtitle}>Династия · {members.length} персонажей</Text>
        {!members.length ? <Text style={styles.note}>Персонажи этой династии не найдены.</Text> : null}
        {[...generations.entries()].sort(([a], [b]) => a - b).map(([generation, peopleInGeneration]) => (
          <View key={generation} style={styles.generation}>
            <Text style={styles.sectionTitle}>{generation === 0 ? 'ОСНОВАТЕЛИ ДИНАСТИИ' : `ПОКОЛЕНИЕ ${generation + 1}`}</Text>
            {peopleInGeneration.sort((a, b) => a.bornAt - b.bornAt).map((person) => {
              const parents = person.parents.map((id) => byId.get(id)).filter((relative): relative is Person => !!relative);
              const partners = [...new Set([...person.spouseIds, ...person.loverIds])]
                .map((id) => byId.get(id)).filter((relative): relative is Person => !!relative);
              const children = people.filter((child) => memberIds.has(child.id) && child.parents.includes(person.id))
                .sort((a, b) => a.bornAt - b.bornAt);
              return (
                <View key={person.id} style={styles.personCard}>
                  <View style={styles.personHeading}>
                    <Pressable onPress={() => openPerson(person.id)}><Text style={styles.link}>{person.name}</Text></Pressable>
                    <Text style={styles.life}>{person.alive ? `${person.age} лет · жив(а)` : `умер(ла) в ${person.deathYear ?? '?'}`}</Text>
                  </View>
                  <View style={styles.relations}>
                    <Text style={styles.relationLabel}>Родители</Text>
                    {parents.length ? parents.map(personLink) : <Text style={styles.note}>неизвестны</Text>}
                  </View>
                  <View style={styles.relations}>
                    <Text style={styles.relationLabel}>Супруги и партнёры</Text>
                    {partners.length ? partners.map(personLink) : <Text style={styles.note}>не указаны</Text>}
                  </View>
                  {children.length > 0 && (
                    <View style={styles.relations}>
                      <Text style={styles.relationLabel}>Дети</Text>
                      {children.map(personLink)}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16 },
  header: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, borderBottomWidth: 2, borderColor: c.foreground },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  backText: { fontFamily: fonts.sansMedium, fontSize: 13, color: c.foreground },
  eyebrow: { marginLeft: 'auto', fontFamily: fonts.sansSemiBold, fontSize: 10, letterSpacing: 1.6, color: c.primary },
  content: { padding: 18, gap: 14 },
  title: { fontFamily: fonts.display, fontSize: 30, color: c.foreground },
  subtitle: { marginTop: -12, fontFamily: fonts.sans, fontSize: 13, color: c.mutedForeground },
  generation: { paddingTop: 8, gap: 8, borderTopWidth: 1, borderColor: c.border },
  sectionTitle: { marginBottom: 3, fontFamily: fonts.sansSemiBold, fontSize: 11, letterSpacing: 1.4, color: c.primary },
  personCard: { padding: 10, gap: 7, backgroundColor: c.card, borderLeftWidth: 3, borderColor: c.primary },
  personHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 },
  link: { fontFamily: fonts.sansSemiBold, fontSize: 14, color: c.accent, textDecorationLine: 'underline' },
  life: { fontFamily: fonts.sans, fontSize: 11, color: c.mutedForeground },
  relations: { gap: 3, paddingLeft: 9, borderLeftWidth: 1, borderColor: c.border },
  relationLabel: { fontFamily: fonts.sansSemiBold, fontSize: 10, color: c.mutedForeground },
  note: { fontFamily: fonts.sans, fontSize: 12, color: c.mutedForeground },
});
