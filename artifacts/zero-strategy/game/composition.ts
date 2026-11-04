/**
 * Состав хранит точные доли групп в точке. Остаток веры означает атеистов.
 */
export interface Composition {
  ids: number[];
  shares: number[];
  total: number;
}

/** Нормирует доли без округления до порогов, применяемых только к отдельным персонам. */
export function quantizeShares(values: Map<number, number>, total: number): Map<number, number> {
  const valid = [...values].filter(([, value]) => Number.isFinite(value) && value > 0);
  const sum = valid.reduce((a, [, value]) => a + value, 0);
  const result = new Map<number, number>();
  if (!(total > 0) || !(sum > 0)) return result;
  for (const [id, value] of valid) result.set(id, total * value / sum);
  const largest = [...result].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
  if (largest !== undefined) {
    result.set(largest, (result.get(largest) ?? 0) + total - [...result.values()].reduce((a, b) => a + b, 0));
  }
  return result;
}

export class CompositionTable {
  readonly entries: Composition[] = [{ ids: [], shares: [], total: 0 }];
  private readonly index = new Map<string, number>([['', 0]]);
  private readonly opCache = new Map<string, Map<number, number>>();

  intern(mix: Map<number, number>): number {
    const ids = [...mix.keys()].filter((id) => (mix.get(id) ?? 0) > 0).sort((a, b) => a - b);
    const key = ids.map((id) => `${id}:${mix.get(id)}`).join(',');
    const known = this.index.get(key);
    if (known !== undefined) return known;
    const shares = ids.map((id) => mix.get(id) as number);
    const id = this.entries.length;
    this.entries.push({ ids, shares, total: shares.reduce((a, b) => a + b, 0) });
    this.index.set(key, id);
    return id;
  }

  shareOf(comp: number, entity: number): number {
    const entry = this.entries[comp];
    const at = entry.ids.indexOf(entity);
    return at < 0 ? 0 : entry.shares[at];
  }

  toMap(comp: number): Map<number, number> {
    const entry = this.entries[comp];
    return new Map(entry.ids.map((id, i) => [id, entry.shares[i]]));
  }

  single(entity: number, share: number): number {
    return share > 0 ? this.intern(new Map([[entity, share]])) : 0;
  }

  /** Добавляет долю сущности в смесь при восстановлении растра из зон. */
  withEntry(comp: number, entity: number, share: number): number {
    return this.cached(`add|${entity}|${share}`, comp, () => {
      const mix = this.toMap(comp);
      mix.set(entity, share);
      return this.intern(mix);
    });
  }

  /**
   * Переводит долю населения в `to`.
   * С `from` обращаются только последователи этой сущности (ветвление культуры).
   * Без `from` преобразуются все пропорционально, включая неверующих (распространение веры).
   */
  convert(comp: number, to: number, fraction: number, from: number | null): number {
    return this.cached(`conv|${to}|${from}|${fraction}`, comp, () => {
      const mix = this.toMap(comp);
      const entry = this.entries[comp];
      if (from !== null) {
        const source = mix.get(from) ?? 0;
        if (source <= 0) return comp;
        const moved = source * fraction;
        mix.set(from, source - moved);
        mix.set(to, (mix.get(to) ?? 0) + moved);
        return this.intern(quantizeShares(mix, entry.total));
      }
      const scaled = new Map<number, number>();
      mix.forEach((share, id) => scaled.set(id, share * (1 - fraction)));
      scaled.set(to, (scaled.get(to) ?? 0) + 100 * fraction);
      const total = Math.min(100, entry.total * (1 - fraction) + 100 * fraction);
      return this.intern(quantizeShares(scaled, total));
    });
  }

  private cached(op: string, comp: number, compute: () => number): number {
    let cache = this.opCache.get(op);
    if (!cache) {
      cache = new Map();
      this.opCache.set(op, cache);
    }
    const hit = cache.get(comp);
    if (hit !== undefined) return hit;
    const result = compute();
    cache.set(comp, result);
    return result;
  }
}
