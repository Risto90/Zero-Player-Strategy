import { useLocalSearchParams } from 'expo-router';
import type { Country } from '@/game/world';
import type { Game } from '@/game/game';
import { currentGame } from '@/game/session';
import { useGameSnapshot } from '@/game/useGame';
import { MissingProfile } from '@/components/profiles/ProfileLayout';
import { CountryDirectoryPage, CountryRulerHistoryList } from '@/components/profiles/CountryLists';

export default function CountryRulersPage() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const game = currentGame();
  if (!game) return <MissingProfile title="Игра не открыта" />;
  const country = game.world.countries[Number(rawId)];
  if (!country) return <MissingProfile title="Страна не найдена" />;
  return <CountryRulerDirectory game={game} country={country} />;
}

function CountryRulerDirectory({ game, country }: { game: Game; country: Country }) {
  useGameSnapshot(game);
  return (
    <CountryDirectoryPage country={country} eyebrow="ХРОНОЛОГИЯ ВЛАСТИ"
      subtitle="Правители и соправители по сохранённым годам назначения">
      <CountryRulerHistoryList game={game} country={country} />
    </CountryDirectoryPage>
  );
}
