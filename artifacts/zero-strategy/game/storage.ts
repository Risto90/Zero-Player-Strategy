import { File, Paths } from 'expo-file-system';

/** The saved world lives in one binary file in the app's document folder. */
const SAVE_NAME = 'zero-strategy-world.bin';
const TEMP_NAME = 'zero-strategy-world.tmp';

export async function writeSaveBytes(bytes: Uint8Array): Promise<void> {
  // Write to a temporary file first so an interrupted save never destroys the previous one.
  const temp = new File(Paths.document, TEMP_NAME);
  if (temp.exists) temp.delete();
  temp.create();
  await temp.write(bytes);
  const target = new File(Paths.document, SAVE_NAME);
  if (target.exists) target.delete();
  temp.move(target);
}

export async function readSaveBytes(): Promise<Uint8Array | null> {
  const file = new File(Paths.document, SAVE_NAME);
  if (!file.exists) return null;
  return await file.bytes();
}

export async function hasSaveBytes(): Promise<boolean> {
  return new File(Paths.document, SAVE_NAME).exists;
}

export async function clearSaveBytes(): Promise<void> {
  const file = new File(Paths.document, SAVE_NAME);
  if (file.exists) file.delete();
}
