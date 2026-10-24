export type ChronicleObjectType = 'country' | 'city' | 'culture' | 'religion';

export interface ChronicleReference {
  type: ChronicleObjectType;
  id: number;
}

export interface ChronicleEntry {
  year: number;
  text: string;
  objects: ChronicleReference[];
}

const OBJECT_TYPES = new Set<ChronicleObjectType>(['country', 'city', 'culture', 'religion']);

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
    return [{ year: candidate.year as number, text: candidate.text, objects }];
  });
}

export function filterChronicle(entries: ChronicleEntry[], references: ChronicleReference[]): ChronicleEntry[] {
  const keys = new Set(references.map(({ type, id }) => `${type}:${id}`));
  if (!keys.size) return [];
  return entries.filter((entry) => entry.objects.some(({ type, id }) => keys.has(`${type}:${id}`)));
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
