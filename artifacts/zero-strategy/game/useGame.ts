import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Game, GameSnapshot } from './game';
import { continueSavedGame, currentGame } from './session';

/** Subscribes a component to the game's state. */
export function useGameSnapshot(game: Game): GameSnapshot {
  return useSyncExternalStore(game.subscribe, game.getSnapshot);
}

/** Восстанавливает активную сессию, если страница профиля открыта после перезагрузки. */
export function useGameSession(): { game: Game | null; loading: boolean; error: string | null } {
  const [game, setGame] = useState<Game | null>(() => currentGame());
  const [loading, setLoading] = useState(() => currentGame() === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const existing = currentGame();
    if (existing) {
      existing.start();
      setGame(existing);
      setLoading(false);
      return () => { active = false; };
    }

    continueSavedGame()
      .then((loaded) => {
        if (!active) return;
        setGame(loaded);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setLoading(false);
      });

    return () => { active = false; };
  }, []);

  return { game, loading, error };
}
