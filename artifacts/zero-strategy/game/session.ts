import { Game, type PlayerRole } from './game';
import type { MapKind } from './geography';

/** The one game running in the app, shared between screens. */
let current: Game | null = null;
let loading: Promise<Game | null> | null = null;

export function currentGame(): Game | null {
  return current;
}

export function startNewGame(mapKind: MapKind, role: PlayerRole): Game {
  current?.discard();
  current = Game.create(mapKind, role);
  current.start();
  return current;
}

export async function startNewGameCooperative(
  mapKind: MapKind,
  role: PlayerRole,
  onProgress?: (stage: string) => void,
): Promise<Game> {
  const next = await Game.createCooperative(mapKind, role, undefined, onProgress);
  current?.discard();
  current = next;
  current.start();
  return current;
}

/** Loads the saved game once and shares the in-flight restore across routes. */
export function continueSavedGame(): Promise<Game | null> {
  if (current) {
    current.start();
    return Promise.resolve(current);
  }
  if (loading) return loading;
  loading = Game.load()
    .then((loaded) => {
      if (current) {
        current.start();
        return current;
      }
      if (loaded) {
        current = loaded;
        current.start();
      }
      return current;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

export async function hasSavedGame(): Promise<boolean> {
  return current !== null || (await Game.hasSave());
}

/** Pauses the running game and saves it. It stays in memory, so "continue" is instant. */
export async function leaveGame(): Promise<void> {
  if (!current) return;
  current.stop();
  await current.saveNow();
}

export async function deleteSavedGame(): Promise<void> {
  current?.discard();
  current = null;
  await Game.deleteSave();
}
