import { useLocalSearchParams } from 'expo-router';
import type { Country } from '@/game/world';
import type { Game } from '@/game/game';
import { currentGame } from '@/game/session';
import { useGameSnapshot } from '@/game/useGame';
import { MissingProfile } from '@/components/profiles/ProfileLayout';
import { CountryCandidatesList, CountryDirectoryPage } from '@/components/profiles/CountryLists';

export default function CountryCandidatesPage() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const game = currentGame();
  if (!game) return <MissingProfile title="Игра не открыта" />;
  const country = game.world.countries[Number(rawId)];
  if (!country) return <MissingProfile title="Страна не найдена" />;
  return <CountryCandidateDirectory game={game} country={country} />;
}

function CountryCandidateDirectory({
  game,
  country,
}: { game: Game; country: Country }) {
  useGameSnapshot(game);
  return (
    <CountryDirectoryPage country={country} eyebrow="КАНДИДАТЫ НА ВЛАСТЬ"
      subtitle={`${country.rank} · ${country.government === 'republic' ? 'выборы' : 'преемство'}`}>
      <CountryCandidatesList game={game} country={country} />
    </CountryDirectoryPage>
  );
}
