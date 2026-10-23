import { File, Paths } from 'expo-file-system';

/** The saved world lives in one binary file in the app's document folder. */
const SAVE_NAME = 'zero-strategy-world.bin';
const TEMP_NAME = 'zero-strategy-world.tmp';
const BACKUP_NAME = 'zero-strategy-world.bak';

const file = (name: string) => new File(Paths.document, name);

/**
 * Replaces the save without ever leaving the device without a complete one: the new data goes to
 * a temporary file, the old save is moved aside as a backup, and the backup is removed only after
 * the new file is in place. If the app dies midway, reading falls back to the backup.
 */
export async function writeSaveBytes(bytes: Uint8Array): Promise<void> {
  const temp = file(TEMP_NAME);
  if (temp.exists) temp.delete();
  temp.create();
  await temp.write(bytes);
  const target = file(SAVE_NAME);
  const backup = file(BACKUP_NAME);
  if (target.exists) {
    if (backup.exists) backup.delete();
    target.move(backup);
  }
  temp.move(file(SAVE_NAME));
  const oldBackup = file(BACKUP_NAME);
  if (oldBackup.exists) oldBackup.delete();
}

export async function readSaveBytes(): Promise<Uint8Array | null> {
  const target = file(SAVE_NAME);
  if (target.exists) return await target.bytes();
  const backup = file(BACKUP_NAME);
  if (backup.exists) return await backup.bytes();
  return null;
}

export async function hasSaveBytes(): Promise<boolean> {
  return file(SAVE_NAME).exists || file(BACKUP_NAME).exists;
}

export async function clearSaveBytes(): Promise<void> {
  for (const name of [SAVE_NAME, BACKUP_NAME, TEMP_NAME]) {
    const f = file(name);
    if (f.exists) f.delete();
  }
}
