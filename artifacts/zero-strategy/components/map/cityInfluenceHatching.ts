export interface CircleHatchLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Produces evenly spaced diagonal strokes across the full interior of a circle. */
export function circleHatchLines(cx: number, cy: number, radius: number, spacing: number): CircleHatchLine[] {
  if (!(radius > 0) || !(spacing > 0) || !Number.isFinite(radius) || !Number.isFinite(spacing)) return [];

  let segments = Math.max(2, Math.ceil((2 * radius) / spacing));
  if (segments % 2 !== 0) segments += 1;
  const lines: CircleHatchLine[] = [];

  for (let index = 0; index <= segments; index += 1) {
    const offset = -radius + (2 * radius * index) / segments;
    const halfLength = Math.sqrt(Math.max(0, radius * radius - offset * offset));
    const midpointX = cx - offset / Math.SQRT2;
    const midpointY = cy + offset / Math.SQRT2;
    lines.push({
      x1: midpointX - halfLength / Math.SQRT2,
      y1: midpointY - halfLength / Math.SQRT2,
      x2: midpointX + halfLength / Math.SQRT2,
      y2: midpointY + halfLength / Math.SQRT2,
    });
  }

  return lines;
}
