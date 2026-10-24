export type ChronicleObjectType = 'country' | 'city' | 'person' | 'culture' | 'religion';

export interface ChronicleReference {
  type: ChronicleObjectType;
  id: number;
}

export interface ChronicleObjectOption {
  reference: ChronicleReference;
  label: string;
}

export interface ChronicleEntry {
  year: number;
  text: string;
  objects: ChronicleReference[];
  importantObjects: ChronicleReference[];
}

export const CHRONICLE_OBJECT_HISTORY_LIMIT = 100;
export const CHRONICLE_PAGE_SIZE = 25;
const OBJECT_TYPES = new Set<ChronicleObjectType>(['country', 'city', 'person', 'culture', 'religion']);

function normalizeChronicleSearch(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/ё/gu, 'е').normalize('NFD').replace(/[\u0300-\u036f]/gu, '');
}

export function chronicleObjectOptions(world: import('./world').World): ChronicleObjectOption[] {
  return [
    ...world.countries.map((country) => ({
      reference: chronicleReference('country', country.id),
      label: `${country.name} · страна`,
    })),
    ...world.cities.map((city) => ({
      reference: chronicleReference('city', city.chronicleId),
      label: `${city.name ?? `Город ${city.id + 1}`} · город`,
    })),
    ...world.people.map((person) => ({
      reference: chronicleReference('person', person.id),
      label: `${person.name} · персонаж`,
    })),
    ...world.cultures.map((culture) => ({
      reference: chronicleReference('culture', culture.id),
      label: `${culture.name} · этнос`,
    })),
    ...world.religions.map((religion) => ({
      reference: chronicleReference('religion', religion.id),
      label: `${religion.name} · религия`,
    })),
  ];
}

export function chronicleReference(type: ChronicleObjectType, id: number): ChronicleReference {
  return { type, id };
}

/** Old saves contain plain strings. Keep their wording and year, but never guess object links. */
export function migrateChronicle(
  value: unknown,
  legacyNomadIds: ReadonlyMap<number, number> = new Map(),
  legacyCityIds: ReadonlyMap<number, number> = new Map(),
): ChronicleEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ChronicleEntry[] => {
    if (typeof item === 'string') {
      const match = /^(-?\d+):\s*(.*)$/u.exec(item);
      return [{
        year: match ? Number(match[1]) : 0,
        text: match ? match[2] : item,
        objects: [],
        importantObjects: [],
      }];
    }
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Partial<ChronicleEntry>;
    if (typeof candidate.text !== 'string' || !Number.isFinite(candidate.year)) return [];
    const hasScopedImportance = Array.isArray((item as { importantObjects?: unknown }).importantObjects);
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
      return [{
        type: reference.type as ChronicleObjectType,
        id: !hasScopedImportance && reference.type === 'city' && legacyCityIds.has(id)
          ? legacyCityIds.get(id)!
          : id,
      }];
    }) : [];
    const objectKeys = new Set(objects.map(({ type, id }) => `${type}:${id}`));
    const importantObjects = hasScopedImportance
      ? ((item as { importantObjects: unknown[] }).importantObjects).flatMap((raw): ChronicleReference[] => {
        if (!raw || typeof raw !== 'object') return [];
        const reference = raw as { type?: unknown; id?: unknown };
        if (typeof reference.type !== 'string' || !OBJECT_TYPES.has(reference.type as ChronicleObjectType) ||
          !Number.isInteger(reference.id) || Number(reference.id) < 0) return [];
        const id = Number(reference.id);
        return objectKeys.has(`${reference.type}:${id}`)
          ? [{ type: reference.type as ChronicleObjectType, id }]
          : [];
      })
      : [];
    return [{
      year: candidate.year as number,
      text: candidate.text,
      objects,
      importantObjects: [...new Map(importantObjects.map((reference) =>
        [`${reference.type}:${reference.id}`, reference])).values()],
    }];
  });
}

export function isChronicleImportant(entry: ChronicleEntry, reference: ChronicleReference | null): boolean {
  return !!reference && entry.importantObjects.some((item) =>
    item.type === reference.type && item.id === reference.id);
}

export function filterChronicle(entries: ChronicleEntry[], references: ChronicleReference[]): ChronicleEntry[] {
  const keys = new Set(references.map(({ type, id }) => `${type}:${id}`));
  if (!keys.size) return [];
  const linked = entries.filter((entry) => entry.objects.some(({ type, id }) => keys.has(`${type}:${id}`)));
  const recent = new Set(linked.slice(0, CHRONICLE_OBJECT_HISTORY_LIMIT));
  return linked.filter((entry) => recent.has(entry) ||
    entry.importantObjects.some(({ type, id }) => keys.has(`${type}:${id}`)));
}

/** Filter the archive without changing its newest-first order or limiting the matching history. */
export function searchChronicle(
  entries: ChronicleEntry[],
  filters: { text?: string; year?: string; reference?: ChronicleReference | null },
): ChronicleEntry[] {
  const terms = normalizeChronicleSearch(filters.text ?? '').split(/\s+/u).filter(Boolean);
  const yearQuery = (filters.year ?? '').trim();
  const year = yearQuery === '' ? null : /^-?\d+$/u.test(yearQuery) ? Number(yearQuery) : Number.NaN;
  const reference = filters.reference;
  if (yearQuery !== '' && !Number.isSafeInteger(year)) return [];

  return entries.filter((entry) => {
    if (year !== null && entry.year !== year) return false;
    if (reference && !entry.objects.some((item) =>
      item.type === reference.type && item.id === reference.id)) return false;
    if (terms.length) {
      const text = normalizeChronicleSearch(entry.text);
      if (!terms.every((term) => text.includes(term))) return false;
    }
    return true;
  });
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
    const sourceWasImportant = isChronicleImportant(entry, chronicleReference('country', sourceId));
    const retainedImportance = entry.importantObjects.filter((reference) =>
      !(removeSource && reference.type === 'country' && reference.id === sourceId));
    const importance = new Map(retainedImportance.map((reference) => [`${reference.type}:${reference.id}`, reference]));
    if (sourceWasImportant) {
      for (const id of successors) importance.set(`country:${id}`, chronicleReference('country', id));
    }
    return { ...entry, objects: [...links.values()], importantObjects: [...importance.values()] };
  });
}
