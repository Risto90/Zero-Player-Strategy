import { MAP_HEIGHT, MAP_WIDTH } from '@/game/config';
import { MAX_SCALE, type ViewTransform } from './types';

export interface MapPixelBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function minScale(width: number, height: number): number {
  return Math.min(width / MAP_WIDTH, height / MAP_HEIGHT);
}

/** Возвращает географическую рамку текущей области просмотра. */
export function visibleMapBounds(
  view: ViewTransform,
  width: number,
  height: number,
): MapPixelBounds | null {
  if (!(view.scale > 0) || width <= 0 || height <= 0) return null;
  const x0 = Math.max(0, Math.floor(-view.ox / view.scale));
  const y0 = Math.max(0, Math.floor(-view.oy / view.scale));
  const x1 = Math.min(MAP_WIDTH - 1, Math.ceil((width - view.ox) / view.scale) - 1);
  const y1 = Math.min(MAP_HEIGHT - 1, Math.ceil((height - view.oy) / view.scale) - 1);
  return x1 < x0 || y1 < y0 ? null : { x0, y0, x1, y1 };
}

/** Keeps the map inside the screen: centred when smaller, edge-locked when larger. */
export function clampView(view: ViewTransform, width: number, height: number): ViewTransform {
  const maxScale = Math.max(MAX_SCALE, view.maxScale ?? MAX_SCALE);
  const scale = Math.max(minScale(width, height), Math.min(maxScale, view.scale));
  const mapW = MAP_WIDTH * scale;
  const mapH = MAP_HEIGHT * scale;
  const ox = mapW <= width ? (width - mapW) / 2 : Math.min(0, Math.max(width - mapW, view.ox));
  const oy = mapH <= height ? (height - mapH) / 2 : Math.min(0, Math.max(height - mapH, view.oy));
  return { ...view, scale, ox, oy };
}

/** Starting view: land fills the screen height on phones. */
export function initialView(width: number, height: number): ViewTransform {
  const scale = Math.max(minScale(width, height), height / MAP_HEIGHT);
  return clampView({ scale, ox: (width - MAP_WIDTH * scale) / 2, oy: 0 }, width, height);
}

/** Scales by `factor` while keeping the map point under (sx, sy) in place. */
export function zoomAround(view: ViewTransform, factor: number, sx: number, sy: number, width: number, height: number): ViewTransform {
  const maxScale = Math.max(MAX_SCALE, view.maxScale ?? MAX_SCALE);
  const scale = Math.max(minScale(width, height), Math.min(maxScale, view.scale * factor));
  const mx = (sx - view.ox) / view.scale;
  const my = (sy - view.oy) / view.scale;
  return clampView({ ...view, scale, ox: sx - mx * scale, oy: sy - my * scale }, width, height);
}

/** Moves the map so a map coordinate is at the viewport center, preserving zoom. */
export function centerOnMapPoint(view: ViewTransform, x: number, y: number, width: number, height: number): ViewTransform {
  return clampView({ ...view, ox: width / 2 - x * view.scale, oy: height / 2 - y * view.scale }, width, height);
}

/** Подбирает наибольший масштаб, при котором вся рамка объекта остаётся на экране. */
export function fitMapBounds(
  bounds: MapPixelBounds,
  width: number,
  height: number,
  occupiedPixels = Math.max(1, (bounds.x1 - bounds.x0 + 1) * (bounds.y1 - bounds.y0 + 1)),
): ViewTransform {
  const mapWidth = Math.max(1, bounds.x1 - bounds.x0 + 1);
  const mapHeight = Math.max(1, bounds.y1 - bounds.y0 + 1);
  const fitScale = Math.min(width * 0.9 / mapWidth, height * 0.9 / mapHeight);
  const quarterScreenScale = Math.sqrt(width * height * 0.25 / Math.max(1, occupiedPixels));
  const scale = Math.max(minScale(width, height), Math.min(fitScale, quarterScreenScale));
  const centerX = (bounds.x0 + bounds.x1 + 1) / 2;
  const centerY = (bounds.y0 + bounds.y1 + 1) / 2;
  return {
    scale,
    maxScale: Math.max(MAX_SCALE, scale),
    ox: width / 2 - centerX * scale,
    oy: height / 2 - centerY * scale,
  };
}

export function toMap(view: ViewTransform, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - view.ox) / view.scale, y: (sy - view.oy) / view.scale };
}
