export type ChronicleObjectType = 'country' | 'city' | 'person' | 'culture' | 'religion';

export interface ChronicleReference {
  type: ChronicleObjectType;
  id: number;
}

export interface ChronicleEntry {
  year: number;
  text: string;
  objects: ChronicleReference[];
  important: boolean;
}

export const CHRONICLE_OBJECT_HISTORY_LIMIT = 100;
export const CHRONICLE_PAGE_SIZE = 25;
const OBJECT_TYPES = new Set<ChronicleObjectType>(['country', 'city', 'person', 'culture', 'religion']);

export function chronicleReference(type: ChronicleObjectType, id: number): ChronicleReference {
  return { type, id };
}

/** Old saves contain plain strings. Keep their wording and year, but never guess object links. */
export function migrateChronicle(value: unknown, legacyNomadIds: ReadonlyMap<number, number> = new Map()): ChronicleEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ChronicleEntry[] => {
    if (typeof item === 'string') {
      const match = /^(-?\d+):\s*(.*)$/u.exec(item);
      return [{
        year: match ? Number(match[1]) : 0,
        text: match ? match[2] : item,
        objects: [],
        important: false,
      }];
    }
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Partial<ChronicleEntry>;
    if (typeof candidate.text !== 'string' || !Number.isFinite(candidate.year)) return [];
    const objects = Array.isArray(candidate.objects) ? candidate.objects.flatMap((raw) => {
      if (!raw || typeof raw !== 'object') return [];
      const reference = raw as { type?: unknown; id?: unknown };
      if (!Number.isInteger(reference.id) || Number(reference.id) < 0) return [];
      const id = Number(reference.id);
      if (reference.type === 'nomad') {
        const countryId = legacyNomadIds.get(id);
        return countryId === undefined ? [] : [{ type: 'country' as const, id: countryId }];
      }
      if (typeof reference.type !== 'string' || !OBJECT_TYPES.has(reference.type as ChronicleObjectType)) return [];
      return [{ type: reference.type as ChronicleObjectType, id }];
    }) : [];
    return [{
      year: candidate.year as number,
      text: candidate.text,
      objects,
      important: candidate.important === true,
    }];
  });
}

export function filterChronicle(entries: ChronicleEntry[], references: ChronicleReference[]): ChronicleEntry[] {
  const keys = new Set(references.map(({ type, id }) => `${type}:${id}`));
  if (!keys.size) return [];
  const linked = entries.filter((entry) => entry.objects.some(({ type, id }) => keys.has(`${type}:${id}`)));
  const recent = new Set(linked.slice(0, CHRONICLE_OBJECT_HISTORY_LIMIT));
  return linked.filter((entry) => recent.has(entry) || entry.important);
}

/** Select one page from the newest-first global archive without copying the whole list. */
export function chroniclePage(entries: ChronicleEntry[], page: number, pageSize = CHRONICLE_PAGE_SIZE): ChronicleEntry[] {
  const start = Math.max(0, Math.floor(page)) * Math.max(1, Math.floor(pageSize));
  return entries.slice(start, start + Math.max(1, Math.floor(pageSize)));
}

/**
 * Give a successor the source country's archived history. A dissolved source loses
 * its country link; surviving partition sources retain theirs.
 */
export function transferCountryChronicle(
  entries: ChronicleEntry[],
  sourceId: number,
  successorIds: number[],
  removeSource = false,
): ChronicleEntry[] {
  const successors = [...new Set(successorIds.filter((id) => Number.isInteger(id) && id >= 0 && id !== sourceId))];
  if (!successors.length && !removeSource) return entries;
  return entries.map((entry) => {
    if (!entry.objects.some(({ type, id }) => type === 'country' && id === sourceId)) return entry;
    const retained = entry.objects.filter((reference) =>
      !(removeSource && reference.type === 'country' && reference.id === sourceId));
    const links = new Map(retained.map((reference) => [`${reference.type}:${reference.id}`, reference]));
    for (const id of successors) links.set(`country:${id}`, chronicleReference('country', id));
    return { ...entry, objects: [...links.values()] };
  });
}

/** Drop deleted index-based entities and shift surviving references with their entity arrays. */
export function reindexChronicleObjects(
  entries: ChronicleEntry[],
  type: 'city',
  removedId: number,
): ChronicleEntry[] {
  return entries.map((entry) => ({
    ...entry,
    objects: entry.objects.flatMap((reference) => {
      if (reference.type !== type) return [reference];
      if (reference.id === removedId) return [];
      return [{ ...reference, id: reference.id > removedId ? reference.id - 1 : reference.id }];
    }),
  }));
}
