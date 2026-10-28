/** Детерминированная растеризация по центрам пикселей для тестов валидатора и геометрических адаптеров. */
export interface FlagRasterPoint {
  x: number;
  y: number;
}

export type FlagRasterShape =
  | { type: 'polygon'; points: FlagRasterPoint[] }
  | { type: 'multipolygon'; polygons: FlagRasterPoint[][] }
  | { type: 'circle'; cx: number; cy: number; radius: number }
  | { type: 'ring'; cx: number; cy: number; innerRadius: number; outerRadius: number }
  | { type: 'rect'; x: number; y: number; width: number; height: number };

export interface FlagRasterLayerInput {
  id: string;
  color: string;
  shapes: FlagRasterShape[];
}

type RasterIndexBuffer = Uint8Array | Uint16Array | Uint32Array;

export interface FlagReferenceRaster {
  width: number;
  height: number;
  /** Итоговые цвета после наложения слоёв; null означает прозрачный пиксель вне флага. */
  colors: (string | null)[];
  /** Идентификатор видимого слоя для каждого пикселя. */
  layerIds: (string | null)[];
  /** Независимые маски каждого слоя до перекрытия последующими слоями. */
  layerMasks: Record<string, Uint8Array>;
  colorIds?: RasterIndexBuffer;
  colorPalette?: string[];
  /** Числовой идентификатор верхнего слоя каждого пикселя и таблица соответствий. */
  layerIdIndices?: RasterIndexBuffer;
  layerIdPalette?: string[];
  layerBounds?: Record<string, { minX: number; minY: number; maxX: number; maxY: number } | null>;
  layerAreas?: Record<string, number>;
}

function inPolygon(x: number, y: number, points: readonly FlagRasterPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i], b = points[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function createRasterIndexBuffer(size: number, maximumIndex: number): RasterIndexBuffer {
  if (maximumIndex <= 0xff) return new Uint8Array(size);
  if (maximumIndex <= 0xffff) return new Uint16Array(size);
  return new Uint32Array(size);
}

function contains(shape: FlagRasterShape, x: number, y: number): boolean {
  if (shape.type === 'multipolygon') {
    return shape.polygons.some((polygon) => polygon.length >= 3 && inPolygon(x, y, polygon));
  }
  if (shape.type === 'circle') return (x - shape.cx) ** 2 + (y - shape.cy) ** 2 <= shape.radius ** 2;
  if (shape.type === 'ring') {
    const distanceSquared = (x - shape.cx) ** 2 + (y - shape.cy) ** 2;
    return distanceSquared <= shape.outerRadius ** 2 && distanceSquared >= shape.innerRadius ** 2;
  }
  if (shape.type === 'rect') {
    return x >= shape.x && x <= shape.x + shape.width && y >= shape.y && y <= shape.y + shape.height;
  }
  return shape.points.length >= 3 && inPolygon(x, y, shape.points);
}

function pixelBounds(shape: FlagRasterShape, width: number, height: number): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let left: number, top: number, right: number, bottom: number;
  if (shape.type === 'circle') {
    left = shape.cx - shape.radius; top = shape.cy - shape.radius;
    right = shape.cx + shape.radius; bottom = shape.cy + shape.radius;
  } else if (shape.type === 'ring') {
    left = shape.cx - shape.outerRadius; top = shape.cy - shape.outerRadius;
    right = shape.cx + shape.outerRadius; bottom = shape.cy + shape.outerRadius;
  } else if (shape.type === 'rect') {
    left = shape.x; top = shape.y; right = shape.x + shape.width; bottom = shape.y + shape.height;
  } else {
    const contours = shape.type === 'multipolygon' ? shape.polygons : [shape.points];
    left = Infinity; top = Infinity; right = -Infinity; bottom = -Infinity;
    let foundPoint = false;
    for (const contour of contours) {
      for (const point of contour) {
        foundPoint = true;
        left = Math.min(left, point.x);
        top = Math.min(top, point.y);
        right = Math.max(right, point.x);
        bottom = Math.max(bottom, point.y);
      }
    }
    if (!foundPoint) return null;
  }
  const minX = Math.max(0, Math.floor(left));
  const minY = Math.max(0, Math.floor(top));
  const maxX = Math.min(width - 1, Math.ceil(right));
  const maxY = Math.min(height - 1, Math.ceil(bottom));
  return minX <= maxX && minY <= maxY ? { minX, minY, maxX, maxY } : null;
}

/** Создаёт маску объединения многоугольников по тем же центрам пикселей, что и эталонный растр. */
export function rasterizeFlagPolygonMask(
  width: number,
  height: number,
  polygons: readonly (readonly FlagRasterPoint[])[],
): Uint8Array {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new RangeError('Размеры маски должны быть положительными целыми числами');
  }
  const mask = new Uint8Array(width * height);
  for (const polygon of polygons) {
    if (polygon.length < 3) continue;
    const shape: FlagRasterShape = { type: 'polygon', points: [...polygon] };
    const bounds = pixelBounds(shape, width, height);
    if (!bounds) continue;
    const intersections: number[] = [];
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      const sampleY = y + 0.5;
      intersections.length = 0;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
        const a = polygon[i], b = polygon[j];
        if ((a.y > sampleY) !== (b.y > sampleY)) {
          intersections.push(((b.x - a.x) * (sampleY - a.y)) / (b.y - a.y) + a.x);
        }
      }
      intersections.sort((a, b) => a - b);
      const row = y * width;
      for (let edge = 0; edge + 1 < intersections.length; edge += 2) {
        const startX = Math.max(bounds.minX, Math.ceil(intersections[edge] - 0.5));
        const endX = Math.min(bounds.maxX + 1, Math.ceil(intersections[edge + 1] - 0.5));
        for (let x = startX; x < endX; x += 1) mask[row + x] = 1;
      }
    }
  }
  return mask;
}

/** Растеризует упорядоченную геометрию в координатах растра по центрам пикселей. Координаты заданы в пикселях. */
export function rasterizeFlagReference(
  width: number,
  height: number,
  layers: readonly FlagRasterLayerInput[],
  options: { includeLayerMasks?: boolean } = {},
): FlagReferenceRaster {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new RangeError('Размеры эталонного растра должны быть положительными целыми числами');
  }
  const size = width * height;
  const includeLayerMasks = options.includeLayerMasks ?? true;
  const layerMasks: Record<string, Uint8Array> = {};
  const layerBounds: NonNullable<FlagReferenceRaster['layerBounds']> = {};
  const layerAreas: NonNullable<FlagReferenceRaster['layerAreas']> = {};
  const colorIds = createRasterIndexBuffer(size, layers.length);
  const colorPalette: string[] = [];
  const colorIdByHex = new Map<string, number>();
  const layerIdIndices = createRasterIndexBuffer(size, layers.length);
  const layerIdPalette: string[] = [];
  let colorStringsCache: (string | null)[] | null = null;
  let layerStringsCache: (string | null)[] | null = null;
  for (const layer of layers) {
    if (!layer.id || layerMasks[layer.id]) throw new TypeError(`Пустой или повторяющийся идентификатор слоя растра "${layer.id}"`);
    if (!/^#[\da-f]{6}$/i.test(layer.color)) throw new TypeError(`Для слоя "${layer.id}" нужен шестизначный HEX-цвет`);
    const validShapes = layer.shapes;
    const countUniquePixels = validShapes.length !== 1 ||
      validShapes[0]?.type === 'multipolygon' && validShapes[0].polygons.length > 1;
    const layerMask = includeLayerMasks || countUniquePixels ? new Uint8Array(size) : null;
    if (includeLayerMasks && layerMask) layerMasks[layer.id] = layerMask;
    const layerIdIndex = layerIdPalette.length + 1;
    layerIdPalette.push(layer.id);
    const color = layer.color.toLowerCase();
    let colorId = colorIdByHex.get(color);
    if (colorId === undefined) {
      colorId = colorPalette.length + 1;
      colorIdByHex.set(color, colorId);
      colorPalette.push(color);
    }
    let minX = width, minY = height, maxX = -1, maxY = -1, area = 0;
    const rowMinX = countUniquePixels ? new Int32Array(height).fill(width) : null;
    const rowMaxX = countUniquePixels ? new Int32Array(height).fill(-1) : null;
    for (const shape of validShapes) {
      if (shape.type === 'circle' && (![shape.cx, shape.cy, shape.radius].every(Number.isFinite) || shape.radius < 0)) {
        throw new RangeError(`Слой "${layer.id}" содержит некорректную окружность`);
      }
      if (shape.type === 'ring' && (![shape.cx, shape.cy, shape.innerRadius, shape.outerRadius].every(Number.isFinite) ||
        shape.innerRadius < 0 || shape.outerRadius <= shape.innerRadius)) {
        throw new RangeError(`Слой "${layer.id}" содержит некорректное кольцо`);
      }
      if (shape.type === 'rect' && (![shape.x, shape.y, shape.width, shape.height].every(Number.isFinite) ||
        shape.width < 0 || shape.height < 0)) throw new RangeError(`Слой "${layer.id}" содержит некорректный прямоугольник`);
      if (shape.type === 'polygon' && (!Array.isArray(shape.points) ||
        shape.points.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y)))) {
        throw new RangeError(`Слой "${layer.id}" содержит некорректные вершины многоугольника`);
      }
    }
    const paintSpan = (y: number, startX: number, endX: number) => {
      if (startX >= endX) return;
      const rowStart = y * width + startX;
      const rowEnd = y * width + endX;
      if (!countUniquePixels) {
        area += endX - startX;
        minX = Math.min(minX, startX);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, endX - 1);
        maxY = Math.max(maxY, y);
      }
      else {
        minX = Math.min(minX, startX);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, endX - 1);
        maxY = Math.max(maxY, y);
        rowMinX![y] = Math.min(rowMinX![y], startX);
        rowMaxX![y] = Math.max(rowMaxX![y], endX - 1);
      }
      layerMask?.fill(1, rowStart, rowEnd);
      colorIds.fill(colorId, rowStart, rowEnd);
      layerIdIndices.fill(layerIdIndex, rowStart, rowEnd);
    };
    for (const shape of validShapes) {
      const bounds = pixelBounds(shape, width, height);
      if (!bounds) continue;
      if (shape.type === 'polygon' || shape.type === 'multipolygon') {
        const intersections: number[] = [];
        const contours = shape.type === 'multipolygon' ? shape.polygons : [shape.points];
        for (const points of contours) {
          if (points.length < 3) continue;
          const contourBounds = shape.type === 'multipolygon'
            ? pixelBounds({ type: 'polygon', points }, width, height)
            : bounds;
          if (!contourBounds) continue;
          for (let y = contourBounds.minY; y <= contourBounds.maxY; y += 1) {
            const sampleY = y + 0.5;
            intersections.length = 0;
            for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
              const a = points[i], b = points[j];
              if ((a.y > sampleY) !== (b.y > sampleY)) {
                intersections.push(((b.x - a.x) * (sampleY - a.y)) / (b.y - a.y) + a.x);
              }
            }
            intersections.sort((a, b) => a - b);
            for (let edge = 0; edge + 1 < intersections.length; edge += 2) {
              const startX = Math.max(contourBounds.minX, Math.ceil(intersections[edge] - 0.5));
              const endX = Math.min(contourBounds.maxX + 1, Math.ceil(intersections[edge + 1] - 0.5));
              if (startX >= endX) continue;
              paintSpan(y, startX, endX);
            }
          }
        }
      } else if (shape.type === 'rect') {
        const startY = Math.max(bounds.minY, Math.ceil(shape.y - 0.5));
        const endY = Math.min(bounds.maxY + 1, Math.floor(shape.y + shape.height - 0.5) + 1);
        const startX = Math.max(bounds.minX, Math.ceil(shape.x - 0.5));
        const endX = Math.min(bounds.maxX + 1, Math.floor(shape.x + shape.width - 0.5) + 1);
        for (let y = startY; y < endY; y += 1) paintSpan(y, startX, endX);
      } else {
        const outerRadius = shape.type === 'circle' ? shape.radius : shape.outerRadius;
        const outerRadiusSquared = outerRadius * outerRadius;
        for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
          const dy = y + 0.5 - shape.cy;
          const verticalDistanceSquared = dy * dy;
          const remaining = outerRadiusSquared - verticalDistanceSquared;
          if (remaining < 0) continue;
          const halfWidth = Math.sqrt(remaining);
          const left = shape.cx - halfWidth;
          const right = shape.cx + halfWidth;
          const matchesOuter = (x: number) => {
            const dx = x + 0.5 - shape.cx;
            return dx * dx + verticalDistanceSquared <= outerRadiusSquared;
          };
          let outerStart = Math.max(bounds.minX, Math.ceil(left - 0.5));
          let outerEnd = Math.min(bounds.maxX + 1, Math.floor(right - 0.5) + 1);
          while (outerStart <= bounds.maxX && !matchesOuter(outerStart)) outerStart += 1;
          while (outerStart > bounds.minX && matchesOuter(outerStart - 1)) outerStart -= 1;
          while (outerEnd > outerStart && !matchesOuter(outerEnd - 1)) outerEnd -= 1;
          while (outerEnd <= bounds.maxX && matchesOuter(outerEnd)) outerEnd += 1;
          if (shape.type === 'circle') {
            paintSpan(y, outerStart, outerEnd);
            continue;
          }

          const innerRadiusSquared = shape.innerRadius * shape.innerRadius;
          const innerRemaining = innerRadiusSquared - verticalDistanceSquared;
          if (innerRemaining <= 0 || outerStart >= outerEnd) {
            paintSpan(y, outerStart, outerEnd);
            continue;
          }
          const innerHalfWidth = Math.sqrt(innerRemaining);
          const innerLeft = shape.cx - innerHalfWidth;
          const innerRight = shape.cx + innerHalfWidth;
          const insideHole = (x: number) => {
            const dx = x + 0.5 - shape.cx;
            return dx * dx + verticalDistanceSquared < innerRadiusSquared;
          };
          let holeStart = Math.max(outerStart, Math.floor(innerLeft - 0.5) + 1);
          let holeEnd = Math.min(outerEnd, Math.ceil(innerRight - 0.5));
          while (holeStart < outerEnd && !insideHole(holeStart)) holeStart += 1;
          while (holeStart > outerStart && insideHole(holeStart - 1)) holeStart -= 1;
          while (holeEnd > holeStart && !insideHole(holeEnd - 1)) holeEnd -= 1;
          while (holeEnd < outerEnd && insideHole(holeEnd)) holeEnd += 1;
          if (holeStart >= holeEnd) {
            paintSpan(y, outerStart, outerEnd);
          } else {
            paintSpan(y, outerStart, holeStart);
            paintSpan(y, holeEnd, outerEnd);
          }
        }
      }
    }
    if (countUniquePixels && maxX >= minX) {
      const mask = layerMask!;
      for (let y = minY; y <= maxY; y += 1) {
        if (rowMaxX![y] < rowMinX![y]) continue;
        const rowStart = y * width + rowMinX![y];
        const rowEnd = y * width + rowMaxX![y] + 1;
        for (let index = rowStart; index < rowEnd; index += 1) area += mask[index];
      }
    }
    layerBounds[layer.id] = maxX < minX ? null : { minX, minY, maxX, maxY };
    layerAreas[layer.id] = area;
  }
  return {
    width,
    height,
    get colors() {
      if (!colorStringsCache) {
        colorStringsCache = Array.from(colorIds, (colorId) => colorId ? colorPalette[colorId - 1] ?? null : null);
      }
      return colorStringsCache;
    },
    set colors(value) {
      colorStringsCache = value;
    },
    get layerIds() {
      if (!layerStringsCache) {
        layerStringsCache = Array.from(layerIdIndices, (layerIdIndex) =>
          layerIdIndex ? layerIdPalette[layerIdIndex - 1] ?? null : null);
      }
      return layerStringsCache;
    },
    set layerIds(value) {
      layerStringsCache = value;
    },
    layerMasks,
    colorIds,
    colorPalette,
    layerIdIndices,
    layerIdPalette,
    layerBounds,
    layerAreas,
  };
}
