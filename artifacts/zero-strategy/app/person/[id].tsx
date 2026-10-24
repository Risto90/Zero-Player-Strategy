import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LogPanel } from '@/components/game/LogPanel';
import colors, { fonts } from '@/constants/colors';
import { ageStage, personDeathStatus, type Person } from '@/game/government';
import { countryProfileRoute } from '@/game/profileRoutes';
import { useGameSnapshot } from '@/game/useGame';
import type { Game } from '@/game/game';
import { currentGame } from '@/game/session';
import { chronicleObjectOptions, chronicleReference, filterChronicle } from '@/game/chronicle';
import { humanOriginShares } from '@/game/human';
import { OriginComposition } from '@/components/profiles/OriginComposition';

const c = colors.light;

type PersonProfileRow =
  | { type: 'section'; key: string; title: string }
  | { type: 'empty'; key: string; message: string }
  | { type: 'relative'; key: string; id: number; title: string; note: string };

function RelativeLink({ id, title, note }: { id: number; title: string; note?: string }) {
  return (
    <Pressable onPress={() => router.push({ pathname: '/person/[id]', params: { id: String(id) } })} style={styles.relative}>
      <Text style={styles.link}>{title}</Text>
      {note && <Text style={styles.note}>{note}</Text>}
    </Pressable>
  );
}

export default function PersonPage() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const game = currentGame();
  const insets = useSafeAreaInsets();
  const world = game?.world;
  const peopleById = useMemo(
    () => new Map((world?.people ?? []).map((item) => [item.id, item])),
    [world, world?.version],
  );
  const person = peopleById.get(Number(rawId));
  if (!game || !person) {
    return (
      <View style={[styles.screen, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.title}>Персонаж не найден</Text>
        <Pressable onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>Назад</Text></Pressable>
      </View>
    );
  }
  return <PersonProfile game={game} person={person} peopleById={peopleById} />;
}

function PersonProfile({
  game,
  person,
  peopleById,
}: {
  game: Game;
  person: Person;
  peopleById: ReadonlyMap<number, Person>;
}) {
  const snapshot = useGameSnapshot(game);
  const [showChronicle, setShowChronicle] = useState(false);
  const insets = useSafeAreaInsets();
  const world = game.world;
  const historyObjectOptions = useMemo(
    () => chronicleObjectOptions(world),
    [world, world.version],
  );
  const homeCountry = person.countryId < 0 ? undefined : world.countries[person.countryId];
  const culture = world.cultures[person.cultureId]?.name ?? 'неизвестна';
  const religion = person.religionId === null ? 'атеист' : world.religions[person.religionId]?.name ?? 'неизвестна';
  const parents = useMemo(
    () => person.parents.map((parentId) => peopleById.get(parentId)).filter((item): item is Person => !!item),
    [peopleById, person],
  );
  const partners = useMemo(() => [
    ...person.spouseIds.map((partnerId) => ({ person: peopleById.get(partnerId), kind: 'Брак' })),
    ...person.loverIds.filter((loverId) => !person.spouseIds.includes(loverId))
      .map((partnerId) => ({ person: peopleById.get(partnerId), kind: 'Любовная связь' })),
  ].filter((entry): entry is { person: Person; kind: string } => !!entry.person), [peopleById, person]);
  const children = useMemo(
    () => world.people.filter((item) => item.parents.includes(person.id))
      .sort((a, b) => a.bornAt - b.bornAt),
    [world, world.version, person.id],
  );
  const personChronicle = filterChronicle(snapshot.chronicle, [chronicleReference('person', person.id)]);
  const siblings = useMemo(
    () => person.parents.length
      ? world.people.filter((item) => item.id !== person.id && item.parents.some((parentId) => person.parents.includes(parentId)))
        .sort((a, b) => a.bornAt - b.bornAt)
      : [],
    [world, world.version, person],
  );
  const rows = useMemo(() => {
    const result: PersonProfileRow[] = [];
    const addSection = (
      key: string,
      title: string,
      entries: { person: Person; note: string }[],
      emptyMessage: string,
    ) => {
      result.push({ type: 'section', key: `section-${key}`, title });
      if (!entries.length) {
        result.push({ type: 'empty', key: `empty-${key}`, message: emptyMessage });
        return;
      }
      for (const { person: relative, note } of entries) {
        result.push({
          type: 'relative',
          key: `${key}-${relative.id}`,
          id: relative.id,
          title: relative.name,
          note,
        });
      }
    };
    addSection('parents', 'РОДИТЕЛИ', parents.map((relative) => ({
      person: relative,
      note: `возраст ${relative.age} лет${personDeathStatus(relative) ? ` · ${personDeathStatus(relative)}` : ''}`,
    })), 'Сведения о родителях неизвестны.');
    addSection('partners', 'СУПРУГИ И ЛЮБОВНЫЕ ПАРТНЁРЫ', partners.map(({ person: relative, kind }) => ({
      person: relative,
      note: `${kind} · ${personDeathStatus(relative) ?? 'жив(а)'} · ${world.cultures[relative.cultureId]?.name ?? 'культура неизвестна'} · ${relative.religionId === null ? 'атеист' : world.religions[relative.religionId]?.name ?? 'вера неизвестна'}`,
    })), 'Браки не зарегистрированы.');
    addSection('siblings', 'БРАТЬЯ И СЁСТРЫ', siblings.map((relative) => ({
      person: relative,
      note: `${relative.age} лет · ${personDeathStatus(relative) ?? 'жив(а)'}`,
    })), 'Сведения не найдены.');
    addSection('children', `ДЕТИ · ${children.length}`, children.map((relative) => ({
      person: relative,
      note: `${relative.age} лет${personDeathStatus(relative) ? ` · ${personDeathStatus(relative)}` : ''} · ${world.cultures[relative.cultureId]?.name ?? 'культура неизвестна'} · ${relative.religionId === null ? 'атеист' : world.religions[relative.religionId]?.name ?? 'вера неизвестна'}`,
    })), 'Дети не зарегистрированы.');
    return result;
  }, [children, parents, partners, siblings, world, person]);
  const detailsHeader = (
    <View style={styles.detailsHeader}>
      <Text style={styles.title}>{person.name}</Text>
      <Text style={styles.subtitle}>
        {person.alive ? 'Жив(а)' : `${personDeathStatus(person)?.replace(/^./u, (letter) => letter.toLocaleUpperCase('ru-RU'))}`}
      </Text>
      {homeCountry && (homeCountry.type === 'nomadic' || homeCountry.pixels > 0) && (
        <Pressable onPress={() => router.push(countryProfileRoute(homeCountry.id))}
          accessibilityRole="link" style={styles.countryLink}>
          <Text style={styles.link}>{homeCountry.name} · текущая родина</Text>
        </Pressable>
      )}
      <View style={styles.facts}>
        <Text style={styles.fact}>Возраст · {person.age} лет, {ageStage(person.age)}</Text>
        <Text style={styles.fact}>Пол · {person.gender === 'female' ? 'женский' : 'мужской'}</Text>
        <Text style={styles.fact}>Культура · {culture}</Text>
        <Text style={styles.fact}>Вероисповедание · {religion}</Text>
        <View style={styles.originSection}>
          <Text style={styles.originHeading}>Расы</Text>
          <OriginComposition rows={humanOriginShares(person.humanOrigin)} />
        </View>
        <View style={styles.factRow}>
          <Text style={styles.fact}>Династия · </Text>
          <Text onPress={() => router.push({ pathname: '/dynasty/[id]', params: { id: String(person.familyId) } })}
            accessibilityRole="link" style={styles.factFamily}>{person.familyName}</Text>
        </View>
        {!!person.trait && <Text style={styles.fact}>Черты · {person.traits.join(', ') || person.trait}</Text>}
        <Text style={styles.fact}>Годы жизни · {Math.floor(person.bornAt)}—{person.deathYear ?? 'настоящее время'}</Text>
      </View>
    </View>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} accessibilityLabel="Назад">
          <Feather name="arrow-left" size={18} color={c.foreground} />
          <Text style={styles.backText}>Назад</Text>
        </Pressable>
        <Text style={styles.eyebrow}>ЛЕТОПИСЬ ПЕРСОНАЖА</Text>
      </View>
      <View style={styles.tabs}>
        <Pressable onPress={() => setShowChronicle(false)} style={[styles.tab, !showChronicle && styles.activeTab]}>
          <Text style={[styles.tabText, !showChronicle && styles.activeTabText]}>Сведения</Text>
        </Pressable>
        <Pressable onPress={() => setShowChronicle(true)} style={[styles.tab, showChronicle && styles.activeTab]}>
          <Text style={[styles.tabText, showChronicle && styles.activeTabText]}>
            Летопись · {personChronicle.length}
          </Text>
        </Pressable>
      </View>
      {showChronicle ? (
        <View style={[styles.chroniclePanel, { paddingBottom: insets.bottom }]}>
          <LogPanel
            key={`person:${person.id}`}
            log={snapshot.chronicle}
            initialReference={chronicleReference('person', person.id)}
            objectOptions={historyObjectOptions}
            showHeading={false}
          />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          renderItem={({ item }) => item.type === 'section'
            ? <View style={styles.section}><Text style={styles.sectionTitle}>{item.title}</Text></View>
            : item.type === 'empty'
              ? <Text style={styles.note}>{item.message}</Text>
              : <RelativeLink id={item.id} title={item.title} note={item.note} />}
          ListHeaderComponent={detailsHeader}
          ListFooterComponent={person.deathReason
            ? <Text style={styles.note}>Причина смерти · {person.deathReason}</Text>
            : undefined}
          contentContainerStyle={[styles.profileListContent, { paddingBottom: insets.bottom + 24 }]}
          initialNumToRender={18}
          maxToRenderPerBatch={18}
          windowSize={7}
          updateCellsBatchingPeriod={40}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16 },
  header: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, borderBottomWidth: 2, borderColor: c.foreground },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 18, paddingVertical: 10 },
  chroniclePanel: { flex: 1, minHeight: 0, backgroundColor: c.secondary },
  tab: { paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  activeTab: { backgroundColor: c.primary, borderColor: c.primary },
  tabText: { fontFamily: fonts.sansSemiBold, fontSize: 12, color: c.foreground },
  activeTabText: { color: c.primaryForeground },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  backText: { fontFamily: fonts.sansMedium, fontSize: 13, color: c.foreground },
  eyebrow: { marginLeft: 'auto', fontFamily: fonts.sansSemiBold, fontSize: 10, letterSpacing: 1.6, color: c.primary },
  detailsHeader: { paddingTop: 18, gap: 14 },
  profileListContent: { paddingHorizontal: 18 },
  title: { fontFamily: fonts.display, fontSize: 30, color: c.foreground },
  subtitle: { marginTop: -12, fontFamily: fonts.sans, fontSize: 13, color: c.mutedForeground },
  countryLink: { alignSelf: 'flex-start', marginTop: -8 },
  facts: { padding: 12, gap: 6, borderLeftWidth: 3, borderColor: c.primary, backgroundColor: c.card },
  originSection: { gap: 5, marginTop: 3 },
  originHeading: { fontFamily: fonts.sansSemiBold, fontSize: 11, letterSpacing: 1.1, color: c.primary },
  fact: { fontFamily: fonts.sans, fontSize: 13, color: c.foreground },
  factRow: { flexDirection: 'row', alignItems: 'center' },
  factFamily: { fontFamily: fonts.sans, fontSize: 13, color: c.accent, textDecorationLine: 'underline' },
  section: { paddingTop: 8, gap: 4, borderTopWidth: 1, borderColor: c.border },
  sectionTitle: { marginBottom: 3, fontFamily: fonts.sansSemiBold, fontSize: 11, letterSpacing: 1.4, color: c.primary },
  relative: { paddingVertical: 6, borderBottomWidth: 1, borderColor: c.border },
  link: { fontFamily: fonts.sansSemiBold, fontSize: 14, color: c.accent, textDecorationLine: 'underline' },
  note: { fontFamily: fonts.sans, fontSize: 12, color: c.mutedForeground },
});
