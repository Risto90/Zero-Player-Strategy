/** Small seeded PRNG so the real-world map and its climate are identical on every launch. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomItem<T>(items: readonly T[], rng: () => number = Math.random): T {
  return items[Math.floor(rng() * items.length)];
}

export function weightedPick<T>(options: { value: T; weight: number }[], rng: () => number = Math.random): T | null {
  const valid = options.filter((option) => option.weight > 0);
  const total = valid.reduce((sum, option) => sum + option.weight, 0);
  if (total <= 0) return null;
  let roll = rng() * total;
  for (const option of valid) {
    roll -= option.weight;
    if (roll <= 0) return option.value;
  }
  return valid[valid.length - 1].value;
}

function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise, wrapping horizontally with period `wrapX` cells. Returns 0..1. */
export function valueNoise(x: number, y: number, seed: number, wrapX: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const xa = ((x0 % wrapX) + wrapX) % wrapX;
  const xb = (xa + 1) % wrapX;
  const a = hash2(xa, y0, seed);
  const b = hash2(xb, y0, seed);
  const c = hash2(xa, y0 + 1, seed);
  const d = hash2(xb, y0 + 1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** Fractal noise field sampled on a coarse grid and upscaled bilinearly (fast enough for big maps). */
export function fractalField(width: number, height: number, seed: number, baseCells: number, octaves: number): Float32Array {
  const step = 4;
  const gw = Math.ceil(width / step) + 2;
  const gh = Math.ceil(height / step) + 2;
  const grid = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy += 1) {
    for (let gx = 0; gx < gw; gx += 1) {
      let amplitude = 1;
      let frequency = baseCells / width;
      let sum = 0;
      let norm = 0;
      for (let o = 0; o < octaves; o += 1) {
        const wrap = Math.max(1, Math.round(width * frequency));
        sum += amplitude * valueNoise(gx * step * frequency, gy * step * frequency, seed + o * 101, wrap);
        norm += amplitude;
        amplitude *= 0.5;
        frequency *= 2;
      }
      grid[gy * gw + gx] = sum / norm;
    }
  }
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const fy = y / step;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    for (let x = 0; x < width; x += 1) {
      const fx = x / step;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const i = y0 * gw + x0;
      const top = grid[i] + (grid[i + 1] - grid[i]) * tx;
      const bottom = grid[i + gw] + (grid[i + gw + 1] - grid[i + gw]) * tx;
      out[y * width + x] = top + (bottom - top) * ty;
    }
  }
  return out;
}
