import { Game, type PlayerRole } from './game';
import type { MapKind } from './geography';

/** The one game running in the app, shared between screens. */
let current: Game | null = null;
const sessionListeners = new Set<() => void>();

export function currentGame(): Game | null {
  return current;
}

export function subscribeGameSession(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

function setCurrentGame(game: Game | null): void {
  current = game;
  for (const listener of sessionListeners) listener();
}

export function startNewGame(mapKind: MapKind, role: PlayerRole): Game {
  current?.discard();
  const game = Game.create(mapKind, role);
  setCurrentGame(game);
  game.start();
  return game;
}

export async function startNewGameCooperative(
  mapKind: MapKind,
  role: PlayerRole,
  onProgress?: (stage: string) => void,
): Promise<Game> {
  const next = await Game.createCooperative(mapKind, role, undefined, onProgress);
  current?.discard();
  setCurrentGame(next);
  next.start();
  return next;
}

/** Loads the saved game from this device. Returns null if there is none. */
export async function continueSavedGame(): Promise<Game | null> {
  if (current) {
    current.start();
    return current;
  }
  const loaded = await Game.load();
  if (loaded) {
    setCurrentGame(loaded);
    loaded.start();
  }
  return current;
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
  setCurrentGame(null);
  await Game.deleteSave();
}
