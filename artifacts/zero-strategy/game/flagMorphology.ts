export type FlagMorphologyOperation = 'dilate' | 'erode';

type MorphologySpan = { dy: number; halfWidth: number };
const diskSpanCache = new Map<number, readonly MorphologySpan[]>();

function validateMorphologyInput(mask: ArrayLike<number>, width: number, height: number, radius: number): void {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1 ||
    !Number.isFinite(radius) || radius < 0 || mask.length !== width * height) {
    throw new RangeError('Некорректные параметры морфологической обработки маски');
  }
}

function diskSpans(radius: number): readonly MorphologySpan[] {
  const cached = diskSpanCache.get(radius);
  if (cached) return cached;
  const spans: MorphologySpan[] = [{ dy: 0, halfWidth: Math.floor(radius) }];
  for (let distance = 1; distance <= radius; distance += 1) {
    const halfWidth = Math.floor(Math.sqrt(radius * radius - distance * distance));
    spans.push({ dy: -distance, halfWidth }, { dy: distance, halfWidth });
  }
  diskSpanCache.set(radius, spans);
  return spans;
}

function packMask(mask: ArrayLike<number>, width: number, height: number, wordsPerRow: number): Uint32Array {
  const packed = new Uint32Array(height * wordsPerRow);
  for (let y = 0; y < height; y += 1) {
    const sourceRow = y * width, packedRow = y * wordsPerRow;
    for (let x = 0; x < width; x += 1) {
      if (mask[sourceRow + x]) packed[packedRow + (x >>> 5)] |= 1 << (x & 31);
    }
  }
  return packed;
}

function clearPaddingBits(packed: Uint32Array, width: number, height: number, wordsPerRow: number): void {
  const lastBits = width & 31;
  if (!lastBits) return;
  const finalWordMask = 0xffff_ffff >>> (32 - lastBits);
  for (let y = 0; y < height; y += 1) {
    const index = y * wordsPerRow + wordsPerRow - 1;
    packed[index] &= finalWordMask;
  }
}

function applyPackedMorphology(
  packed: Uint32Array,
  width: number,
  height: number,
  wordsPerRow: number,
  spans: readonly MorphologySpan[],
  operation: FlagMorphologyOperation,
): Uint32Array {
  const horizontalByWidth = new Map<number, Uint32Array>();
  for (const halfWidth of new Set(spans.map(({ halfWidth }) => halfWidth))) {
    if (halfWidth === 0) {
      horizontalByWidth.set(halfWidth, packed);
      continue;
    }
    const first = new Uint32Array(packed.length);
    const second = new Uint32Array(packed.length);
    let current = packed;
    let destination = first;
    let coveredRadius = 0;
    while (coveredRadius < halfWidth) {
      const shift = Math.min(coveredRadius + 1, halfWidth - coveredRadius);
      for (let y = 0; y < height; y += 1) {
        const row = y * wordsPerRow;
        for (let word = 0; word < wordsPerRow; word += 1) {
          const index = row + word;
          const source = current[index];
          const left = ((source << shift) |
            (word > 0 ? current[index - 1] >>> (32 - shift) : 0)) >>> 0;
          const right = ((source >>> shift) |
            (word + 1 < wordsPerRow ? current[index + 1] << (32 - shift) : 0)) >>> 0;
          destination[index] = operation === 'dilate'
            ? source | left | right
            : source & left & right;
        }
      }
      coveredRadius += shift;
      current = destination;
      destination = destination === first ? second : first;
    }
    horizontalByWidth.set(halfWidth, current);
  }
  const horizontalSpans = spans.map(({ dy, halfWidth }) => ({
    dy,
    values: horizontalByWidth.get(halfWidth)!,
  }));
  const outputPacked = new Uint32Array(packed.length);
  for (let y = 0; y < height; y += 1) {
    const outputRow = y * wordsPerRow;
    for (let word = 0; word < wordsPerRow; word += 1) {
      let value = operation === 'dilate' ? 0 : 0xffff_ffff;
      for (const span of horizontalSpans) {
        const sourceY = y + span.dy;
        if (sourceY < 0 || sourceY >= height) {
          if (operation === 'erode') {
            value = 0;
            break;
          }
          continue;
        }
        const pixelRow = span.values[sourceY * wordsPerRow + word];
        if (operation === 'dilate') value |= pixelRow;
        else value &= pixelRow;
      }
      outputPacked[outputRow + word] = value;
    }
  }
  clearPaddingBits(outputPacked, width, height, wordsPerRow);
  return outputPacked;
}

function unpackMask(packed: Uint32Array, width: number, height: number, wordsPerRow: number): Uint8Array {
  const result = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * width, packedRow = y * wordsPerRow;
    for (let x = 0; x < width; x += 1) {
      result[row + x] = Number((packed[packedRow + (x >>> 5)] & (1 << (x & 31))) !== 0);
    }
  }
  return result;
}

export function morphologyMask(
  mask: ArrayLike<number>,
  width: number,
  height: number,
  radius: number,
  operation: FlagMorphologyOperation,
): Uint8Array {
  validateMorphologyInput(mask, width, height, radius);
  const wordsPerRow = Math.ceil(width / 32);
  const packed = packMask(mask, width, height, wordsPerRow);
  const result = applyPackedMorphology(packed, width, height, wordsPerRow, diskSpans(radius), operation);
  return unpackMask(result, width, height, wordsPerRow);
}

export function morphologySequenceMask(
  mask: ArrayLike<number>,
  width: number,
  height: number,
  radius: number,
  operations: readonly FlagMorphologyOperation[],
): Uint8Array {
  validateMorphologyInput(mask, width, height, radius);
  if (!operations.length) return Uint8Array.from({ length: mask.length }, (_, index) => Number(Boolean(mask[index])));
  const wordsPerRow = Math.ceil(width / 32);
  const spans = diskSpans(radius);
  let packed = packMask(mask, width, height, wordsPerRow);
  for (const operation of operations) {
    if (operation !== 'dilate' && operation !== 'erode') {
      throw new RangeError(`Неизвестная операция морфологии: ${String(operation)}`);
    }
    packed = applyPackedMorphology(packed, width, height, wordsPerRow, spans, operation);
  }
  return unpackMask(packed, width, height, wordsPerRow);
}
