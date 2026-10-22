import { SHARE_STEP } from './config';

/**
 * A composition is the mix of cultures (or religions) at a point: entity → share %.
 * Culture mixes always sum to 100%. Religion mixes may sum to less; the rest are non-believers.
 * Each distinct mix is stored once and referenced by index from the working raster.
 */
export interface Composition {
  ids: number[];
  shares: number[];
  total: number;
}

/** Splits `total` (a multiple of the step) between entities proportionally, in whole steps. */
export function quantizeShares(values: Map<number, number>, total: number): Map<number, number> {
  const units = Math.round(total / SHARE_STEP);
  const sum = [...values.values()].reduce((a, b) => a + b, 0);
  const result = new Map<number, number>();
  if (units <= 0 || sum <= 0) return result;
  const parts = [...values.entries()].map(([id, value]) => {
    const exact = (value / sum) * units;
    return { id, whole: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  let left = units - parts.reduce((a, part) => a + part.whole, 0);
  parts.sort((a, b) => b.rest - a.rest || a.id - b.id);
  for (const part of parts) {
    if (left <= 0) break;
    part.whole += 1;
    left -= 1;
  }
  for (const part of parts) if (part.whole > 0) result.set(part.id, part.whole * SHARE_STEP);
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

  /** Adds an entity at a share to a mix (used when rebuilding rasters from zones). */
  withEntry(comp: number, entity: number, share: number): number {
    return this.cached(`add|${entity}|${share}`, comp, () => {
      const mix = this.toMap(comp);
      mix.set(entity, share);
      return this.intern(mix);
    });
  }

  /**
   * Converts a fraction of the population to `to`.
   * With `from`: only that entity's followers convert (culture branching).
   * Without: everyone converts proportionally, including non-believers (new faith spreading).
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
      const total = Math.min(100, Math.round((entry.total * (1 - fraction) + 100 * fraction) / SHARE_STEP) * SHARE_STEP);
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
