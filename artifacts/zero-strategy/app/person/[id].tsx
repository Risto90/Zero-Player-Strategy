import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors, { fonts } from '@/constants/colors';
import { ageStage, personDeathStatus, type Person } from '@/game/government';
import { nomadProfileRoute } from '@/game/profileRoutes';
import { useGameSnapshot } from '@/game/useGame';
import type { Game } from '@/game/game';
import { currentGame } from '@/game/session';

const c = colors.light;

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
  const person = game?.world.people.find((item) => item.id === Number(rawId));
  if (!game || !person) {
    return (
      <View style={[styles.screen, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.title}>Персонаж не найден</Text>
        <Pressable onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>Назад</Text></Pressable>
      </View>
    );
  }
  return <PersonProfile game={game} person={person} />;
}

function PersonProfile({ game, person }: { game: Game; person: Person }) {
  useGameSnapshot(game);
  const insets = useSafeAreaInsets();
  const world = game.world;
  const nomad = person.nomadId == null ? undefined : world.nomads[person.nomadId];
  const country = person.nomadId == null ? world.countries[person.countryId] : undefined;
  const sourceCountry = nomad?.sourceCountryId == null
    ? undefined
    : world.countries[nomad.sourceCountryId];
  const culture = world.cultures[person.cultureId]?.name ?? 'неизвестна';
  const religion = person.religionId === null ? 'атеист' : world.religions[person.religionId]?.name ?? 'неизвестна';
  const parents = person.parents.map((parentId) => world.people.find((item) => item.id === parentId)).filter((item) => !!item);
  const partners = [
    ...person.spouseIds.map((partnerId) => ({ person: world.people.find((item) => item.id === partnerId), kind: 'Брак' })),
    ...person.loverIds.filter((loverId) => !person.spouseIds.includes(loverId))
      .map((partnerId) => ({ person: world.people.find((item) => item.id === partnerId), kind: 'Любовная связь' })),
  ].filter((entry): entry is { person: Person; kind: string } => !!entry.person);
  const children = world.people.filter((item) => item.parents.includes(person.id))
    .sort((a, b) => a.bornAt - b.bornAt);
  const siblings = person.parents.length
    ? world.people.filter((item) => item.id !== person.id && item.parents.some((parentId) => person.parents.includes(parentId)))
      .sort((a, b) => a.bornAt - b.bornAt)
    : [];

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} accessibilityLabel="Назад">
          <Feather name="arrow-left" size={18} color={c.foreground} />
          <Text style={styles.backText}>Назад</Text>
        </Pressable>
        <Text style={styles.eyebrow}>ЛЕТОПИСЬ ПЕРСОНАЖА</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <Text style={styles.title}>{person.name}</Text>
        <Text style={styles.subtitle}>
          {person.alive ? 'Жив(а)' : `${personDeathStatus(person)?.replace(/^./u, (letter) => letter.toLocaleUpperCase('ru-RU'))}`}
        </Text>
        {nomad && (
          <Pressable onPress={() => router.push(nomadProfileRoute(nomad.id))}
            accessibilityRole="link" style={styles.countryLink}>
            <Text style={styles.link}>{nomad.name} · текущая родина</Text>
          </Pressable>
        )}
        {sourceCountry && (
          <Pressable onPress={() => router.push({ pathname: '/country/[id]', params: { id: String(sourceCountry.id) } })}
            accessibilityRole="link" style={styles.countryLink}>
            <Text style={styles.link}>{sourceCountry.name} · карточка страны</Text>
          </Pressable>
        )}
        {country && (
          <Pressable onPress={() => router.push({ pathname: '/country/[id]', params: { id: String(country.id) } })}
            accessibilityRole="link" style={styles.countryLink}>
            <Text style={styles.link}>{country.name} · текущая родина</Text>
          </Pressable>
        )}
        <View style={styles.facts}>
          <Text style={styles.fact}>Возраст · {person.age} лет, {ageStage(person.age)}</Text>
          <Text style={styles.fact}>Пол · {person.gender === 'female' ? 'женский' : 'мужской'}</Text>
          <Text style={styles.fact}>Культура · {culture}</Text>
          <Text style={styles.fact}>Вероисповедание · {religion}</Text>
          <View style={styles.factRow}>
            <Text style={styles.fact}>Династия · </Text>
            <Text onPress={() => router.push({ pathname: '/dynasty/[id]', params: { id: String(person.familyId) } })}
              accessibilityRole="link" style={styles.factFamily}>{person.familyName}</Text>
          </View>
          {!!person.trait && <Text style={styles.fact}>Черты · {person.traits.join(', ') || person.trait}</Text>}
          <Text style={styles.fact}>Годы жизни · {Math.floor(person.bornAt)}—{person.deathYear ?? 'настоящее время'}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>РОДИТЕЛИ</Text>
          {parents.length ? parents.map((relative) => (
            <RelativeLink key={relative.id} id={relative.id} title={relative.name}
              note={`возраст ${relative.age} лет${personDeathStatus(relative) ? ` · ${personDeathStatus(relative)}` : ''}`} />
          )) : <Text style={styles.note}>Сведения о родителях неизвестны.</Text>}
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>СУПРУГИ И ЛЮБОВНЫЕ ПАРТНЁРЫ</Text>
          {partners.length ? partners.map(({ person: relative, kind }) => (
            <RelativeLink key={relative.id} id={relative.id} title={relative.name}
              note={`${kind} · ${personDeathStatus(relative) ?? 'жив(а)'} · ${world.cultures[relative.cultureId]?.name ?? 'культура неизвестна'} · ${relative.religionId === null ? 'атеист' : world.religions[relative.religionId]?.name ?? 'вера неизвестна'}`} />
          )) : <Text style={styles.note}>Браки не зарегистрированы.</Text>}
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>БРАТЬЯ И СЁСТРЫ</Text>
          {siblings.length ? siblings.map((relative) => (
            <RelativeLink key={relative.id} id={relative.id} title={relative.name}
              note={`${relative.age} лет · ${personDeathStatus(relative) ?? 'жив(а)'}`} />
          )) : <Text style={styles.note}>Сведения не найдены.</Text>}
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ДЕТИ · {children.length}</Text>
          {children.length ? children.map((relative) => (
            <RelativeLink key={relative.id} id={relative.id} title={relative.name}
              note={`${relative.age} лет${personDeathStatus(relative) ? ` · ${personDeathStatus(relative)}` : ''} · ${world.cultures[relative.cultureId]?.name ?? 'культура неизвестна'} · ${relative.religionId === null ? 'атеист' : world.religions[relative.religionId]?.name ?? 'вера неизвестна'}`} />
          )) : <Text style={styles.note}>Дети не зарегистрированы.</Text>}
        </View>
        {person.deathReason && <Text style={styles.note}>Причина смерти · {person.deathReason}</Text>}
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
  countryLink: { alignSelf: 'flex-start', marginTop: -8 },
  facts: { padding: 12, gap: 6, borderLeftWidth: 3, borderColor: c.primary, backgroundColor: c.card },
  fact: { fontFamily: fonts.sans, fontSize: 13, color: c.foreground },
  factRow: { flexDirection: 'row', alignItems: 'center' },
  factFamily: { fontFamily: fonts.sans, fontSize: 13, color: c.accent, textDecorationLine: 'underline' },
  section: { paddingTop: 8, gap: 4, borderTopWidth: 1, borderColor: c.border },
  sectionTitle: { marginBottom: 3, fontFamily: fonts.sansSemiBold, fontSize: 11, letterSpacing: 1.4, color: c.primary },
  relative: { paddingVertical: 6, borderBottomWidth: 1, borderColor: c.border },
  link: { fontFamily: fonts.sansSemiBold, fontSize: 14, color: c.accent, textDecorationLine: 'underline' },
  note: { fontFamily: fonts.sans, fontSize: 12, color: c.mutedForeground },
});
