/** Web preview only: the same binary save kept in IndexedDB. */
const DB_NAME = 'zero-strategy';
const STORE = 'saves';
const KEY = 'world';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest | null): Promise<T | null> {
  const db = await openDb();
  try {
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request ? ((request.result as T | undefined) ?? null) : null);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function writeSaveBytes(bytes: Uint8Array): Promise<void> {
  await run('readwrite', (store) => store.put(bytes, KEY));
}

export async function readSaveBytes(): Promise<Uint8Array | null> {
  return run<Uint8Array>('readonly', (store) => store.get(KEY));
}

export async function hasSaveBytes(): Promise<boolean> {
  return (await run<number>('readonly', (store) => store.count(KEY))) === 1;
}

export async function clearSaveBytes(): Promise<void> {
  await run('readwrite', (store) => store.delete(KEY));
}
