import { Game, type PlayerRole } from './game';
import type { MapKind } from './geography';

/** The one game running in this tab, shared between screens. */
let current: Game | null = null;

export function currentGame(): Game | null {
  return current;
}

export function startNewGame(mapKind: MapKind, role: PlayerRole): Game {
  current?.dispose();
  current = Game.create(mapKind, role);
  current.start();
  return current;
}

/** Loads the saved game from this device. Returns null if there is none. */
export async function continueSavedGame(): Promise<Game | null> {
  if (current) return current;
  const loaded = await Game.load();
  if (loaded) {
    current = loaded;
    current.start();
  }
  return current;
}

export async function hasSavedGame(): Promise<boolean> {
  return current !== null || (await Game.hasSave());
}

/** Saves and closes the running game (the save stays on the device). */
export async function leaveGame(): Promise<void> {
  if (!current) return;
  current.stop();
  await current.save();
  current = null;
}

export async function deleteSavedGame(): Promise<void> {
  current?.discard();
  current = null;
  await Game.deleteSave();
}
