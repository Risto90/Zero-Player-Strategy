/** Детерминированная растеризация по центрам пикселей для тестов валидатора и геометрических адаптеров. */
export interface FlagRasterPoint {
  x: number;
  y: number;
}

export type FlagRasterShape =
  | { type: 'polygon'; points: FlagRasterPoint[] }
  | { type: 'circle'; cx: number; cy: number; radius: number }
  | { type: 'ring'; cx: number; cy: number; innerRadius: number; outerRadius: number }
  | { type: 'rect'; x: number; y: number; width: number; height: number };

export interface FlagRasterLayerInput {
  id: string;
  color: string;
  shapes: FlagRasterShape[];
}

export interface FlagReferenceRaster {
  width: number;
  height: number;
  /** Итоговые цвета после наложения слоёв; null означает прозрачный пиксель вне флага. */
  colors: (string | null)[];
  /** Идентификатор видимого слоя для каждого пикселя. */
  layerIds: (string | null)[];
  /** Независимые маски каждого слоя до перекрытия последующими слоями. */
  layerMasks: Record<string, Uint8Array>;
}

function inPolygon(x: number, y: number, points: readonly FlagRasterPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i], b = points[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function contains(shape: FlagRasterShape, x: number, y: number): boolean {
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

/** Растеризует упорядоченную геометрию в координатах растра по центрам пикселей. Координаты заданы в пикселях. */
export function rasterizeFlagReference(
  width: number,
  height: number,
  layers: readonly FlagRasterLayerInput[],
): FlagReferenceRaster {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new RangeError('Размеры эталонного растра должны быть положительными целыми числами');
  }
  const size = width * height;
  const colors: (string | null)[] = Array(size).fill(null);
  const layerIds: (string | null)[] = Array(size).fill(null);
  const layerMasks: Record<string, Uint8Array> = {};
  for (const layer of layers) {
    if (!layer.id || layerMasks[layer.id]) throw new TypeError(`Пустой или повторяющийся идентификатор слоя растра "${layer.id}"`);
    if (!/^#[\da-f]{6}$/i.test(layer.color)) throw new TypeError(`Для слоя "${layer.id}" нужен шестизначный HEX-цвет`);
    layerMasks[layer.id] = new Uint8Array(size);
    const validShapes = layer.shapes;
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
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (!validShapes.some((shape) => contains(shape, x + 0.5, y + 0.5))) continue;
        layerMasks[layer.id][index] = 1;
        colors[index] = layer.color.toLowerCase();
        layerIds[index] = layer.id;
      }
    }
  }
  return { width, height, colors, layerIds, layerMasks };
}
