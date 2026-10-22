import { useSyncExternalStore } from 'react';
import type { Game, GameSnapshot } from './game';

/** Subscribes a component to the game's state. */
export function useGameSnapshot(game: Game): GameSnapshot {
  return useSyncExternalStore(game.subscribe, game.getSnapshot);
}
