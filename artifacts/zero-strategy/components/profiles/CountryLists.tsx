import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import colors, { fonts } from '@/constants/colors';
import { countryCharacters } from '@/game/characters';
import { ageStage, personDeathStatus } from '@/game/government';
import type { Country } from '@/game/world';
import type { Game } from '@/game/game';
import { countryCandidates, countryRulerHistory, type CountryCandidate } from '@/game/succession';
import { ProfileFact, ProfileLink, ProfileSection } from './ProfileLayout';

const c = colors.light;

function openPerson(id: number) {
  router.push({ pathname: '/person/[id]', params: { id: String(id) } });
}

export function CountryResidentsList({
  residents,
}: {
  residents: ReturnType<typeof countryCharacters>;
}) {
  return (
    <FlatList
      data={residents}
      keyExtractor={(resident) => String(resident.id)}
      renderItem={({ item: resident }) => (
        <ProfileLink title={resident.name}
          note={`${resident.age} лет · ${ageStage(resident.age)} · ${resident.familyName}`}
          onPress={() => openPerson(resident.id)} />
      )}
      ListHeaderComponent={<ProfileSection title={`ЖИВЫЕ ЖИТЕЛИ · ${residents.length}`} />}
      ListEmptyComponent={<ProfileFact>Живых персонажей с этой страной проживания нет.</ProfileFact>}
      contentContainerStyle={styles.virtualizedContent}
      initialNumToRender={18}
      maxToRenderPerBatch={18}
      windowSize={7}
      updateCellsBatchingPeriod={40}
    />
  );
}

export function CountryCandidatesList({ game, country, candidates: suppliedCandidates }: {
  game: Game;
  country: Country;
  candidates?: CountryCandidate[];
}) {
  const candidates = suppliedCandidates ?? countryCandidates(game.world, country);
  if (!candidates.length) {
    return <ProfileFact>Сейчас нет живых персонажей, подходящих на роль кандидата с учётом законов и ограничений страны.</ProfileFact>;
  }
  const weightedCandidates = candidates.some(({ weight }) => weight !== null);
  return (
    <FlatList
      data={candidates}
      keyExtractor={({ person }) => String(person.id)}
      renderItem={({ item: { person, basis, advantages, expectedHeir, weight } }) => (
        <View key={person.id} style={styles.candidate}>
          <ProfileLink title={`${person.name}${expectedHeir ? ' · ожидаемый наследник по закону' : ''}`}
            note={`${person.age} лет · ${ageStage(person.age)}${personDeathStatus(person) ? ` · ${personDeathStatus(person)}` : ''}`}
            onPress={() => openPerson(person.id)} />
          {basis.map((reason, index) => <Text key={`basis-${index}`} style={styles.reason}>{reason}</Text>)}
          {advantages.map((reason, index) => <Text key={`advantage-${index}`} style={styles.advantage}>{reason}</Text>)}
          {weight !== null && <Text style={styles.weight}>Относительный вес выбора · ×{Number(weight.toFixed(2))}</Text>}
        </View>
      )}
      ListHeaderComponent={<ProfileSection title={`КАНДИДАТЫ · ${candidates.length}`} />}
      ListFooterComponent={weightedCandidates
        ? <ProfileFact>Вес показывает сравнительный шанс среди доступных вариантов, а не гарантию назначения.</ProfileFact>
        : undefined}
      contentContainerStyle={styles.virtualizedContent}
      initialNumToRender={14}
      maxToRenderPerBatch={12}
      windowSize={7}
      updateCellsBatchingPeriod={40}
    />
  );
}

export function CountryRulerHistoryList({ game, country }: { game: Game; country: Country }) {
  const history = countryRulerHistory(game.world, country);
  return (
    <ProfileSection title={`ПРАВИТЕЛИ ПО ГОДАМ · ${history.length}`}>
      {history.length ? history.map(({ person, startYear, endYear, office, current }, index) => (
        <ProfileLink key={`${person.id}-${index}`} title={`${startYear === null ? 'Год не указан' : endYear === null ? current ? `с ${startYear} года` : `с ${startYear} года, конец не указан` : `${startYear}–${endYear} годы`} · ${person.name}${current ? ' · сейчас у власти' : ''}`}
          note={`${office === 'coRuler' ? 'Соправитель' : 'Правитель'}${person.alive ? '' : ` · ${personDeathStatus(person) ?? 'умер(ла)'}`}`}
          onPress={() => openPerson(person.id)} />
      )) : <ProfileFact>Записи о правителях не найдены.</ProfileFact>}
      <Text style={styles.historyNote}>Каждое назначение показано отдельным сроком. Неизвестные даты окончания не восстанавливаются по догадке.</Text>
    </ProfileSection>
  );
}

export function CountryDirectoryPage({
  country,
  eyebrow,
  subtitle,
  children,
}: {
  country: Country;
  eyebrow: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.directory}>
      <View style={styles.directoryHeader}>
        <Pressable onPress={() => router.back()} style={styles.back} accessibilityLabel="Назад">
          <Feather name="arrow-left" size={18} color={c.foreground} />
          <Text style={styles.backText}>Назад</Text>
        </Pressable>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.directoryContent}>
        <Text style={styles.title}>{country.name}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        {children}
      </ScrollView>
    </View>
  );
}

const styles = {
  candidate: { gap: 3, paddingVertical: 5, borderBottomWidth: 1, borderColor: c.border } as const,
  virtualizedContent: { padding: 18, paddingTop: 8, paddingBottom: 24 } as const,
  reason: { paddingHorizontal: 5, fontFamily: fonts.sans, fontSize: 12, lineHeight: 17, color: c.foreground } as const,
  advantage: { paddingHorizontal: 5, fontFamily: fonts.sansMedium, fontSize: 12, lineHeight: 17, color: c.primary } as const,
  weight: { paddingHorizontal: 5, fontFamily: fonts.mono, fontSize: 11, color: c.mutedForeground } as const,
  historyNote: { fontFamily: fonts.sans, fontSize: 11, lineHeight: 16, color: c.mutedForeground } as const,
  directory: { flex: 1, backgroundColor: c.background },
  directoryHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, borderBottomWidth: 2, borderColor: c.foreground } as const,
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 } as const,
  backText: { fontFamily: fonts.sansMedium, fontSize: 13, color: c.foreground },
  eyebrow: { fontFamily: fonts.sansSemiBold, fontSize: 10, letterSpacing: 1.4, color: c.primary },
  title: { fontFamily: fonts.display, fontSize: 30, color: c.foreground },
  subtitle: { fontFamily: fonts.sans, fontSize: 13, color: c.mutedForeground },
  directoryContent: { padding: 18, paddingTop: 12, gap: 14 },
};
