import { useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { MissingProfile, ProfileFact, ProfileLayout, ProfileSection } from '@/components/profiles/ProfileLayout';
import { fmt, pct } from '@/game/format';
import { HUMAN_ORIGINS, HUMAN_ORIGIN_COLORS } from '@/game/human';
import { currentGame } from '@/game/session';
import { useGameSnapshot } from '@/game/useGame';

const styles = {
  facts: { padding: 12, gap: 6, borderLeftWidth: 3, borderColor: '#bf2f1d', backgroundColor: '#f6f1e4' } as const,
};

export default function RacePage() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const game = currentGame();
  const race = HUMAN_ORIGINS.find((entry) => entry.id === rawId);
  if (!game || !race) return <MissingProfile title="Раса не найдена" />;

  const snapshot = useGameSnapshot(game);
  const raceIndex = HUMAN_ORIGINS.findIndex((entry) => entry.id === race.id);
  const population = snapshot.legend.origins.find((row) => row.id === raceIndex);
  const details = (
    <>
      <View style={styles.facts}>
        <ProfileFact>
          <Text style={{ color: HUMAN_ORIGIN_COLORS[race.id] }}>■ </Text>
          Население · {fmt(population?.value ?? 0)} чел.
        </ProfileFact>
        <ProfileFact>Доля населения · {pct(population?.percent ?? 0)}</ProfileFact>
      </View>
      <ProfileSection title="КЛИМАТИЧЕСКИЙ ПРОФИЛЬ">
        <ProfileFact>Температура · {race.climate.temperature[0]}–{race.climate.temperature[1]}</ProfileFact>
        <ProfileFact>Влажность · {race.climate.humidity[0]}–{race.climate.humidity[1]}</ProfileFact>
        <ProfileFact>Это условные игровые диапазоны климата, а не свойства отдельного персонажа.</ProfileFact>
      </ProfileSection>
    </>
  );

  return (
    <ProfileLayout
      eyebrow="КАРТОЧКА РАСЫ"
      title={race.name}
      subtitle="Раса"
      details={details}
      chronicle={[]}
      showChronicleTab={false}
    />
  );
}
