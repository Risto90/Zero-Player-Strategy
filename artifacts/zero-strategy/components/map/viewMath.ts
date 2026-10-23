import { MAP_HEIGHT, MAP_WIDTH } from '@/game/config';
import { MAX_SCALE, type ViewTransform } from './types';

export function minScale(width: number, height: number): number {
  return Math.min(width / MAP_WIDTH, height / MAP_HEIGHT);
}

/** Keeps the map inside the screen: centred when smaller, edge-locked when larger. */
export function clampView(view: ViewTransform, width: number, height: number): ViewTransform {
  const scale = Math.max(minScale(width, height), Math.min(MAX_SCALE, view.scale));
  const mapW = MAP_WIDTH * scale;
  const mapH = MAP_HEIGHT * scale;
  const ox = mapW <= width ? (width - mapW) / 2 : Math.min(0, Math.max(width - mapW, view.ox));
  const oy = mapH <= height ? (height - mapH) / 2 : Math.min(0, Math.max(height - mapH, view.oy));
  return { scale, ox, oy };
}

/** Starting view: land fills the screen height on phones. */
export function initialView(width: number, height: number): ViewTransform {
  const scale = Math.max(minScale(width, height), height / MAP_HEIGHT);
  return clampView({ scale, ox: (width - MAP_WIDTH * scale) / 2, oy: 0 }, width, height);
}

/** Scales by `factor` while keeping the map point under (sx, sy) in place. */
export function zoomAround(view: ViewTransform, factor: number, sx: number, sy: number, width: number, height: number): ViewTransform {
  const scale = Math.max(minScale(width, height), Math.min(MAX_SCALE, view.scale * factor));
  const mx = (sx - view.ox) / view.scale;
  const my = (sy - view.oy) / view.scale;
  return clampView({ scale, ox: sx - mx * scale, oy: sy - my * scale }, width, height);
}

/** Moves the map so a map coordinate is at the viewport center, preserving zoom. */
export function centerOnMapPoint(view: ViewTransform, x: number, y: number, width: number, height: number): ViewTransform {
  return clampView({ ...view, ox: width / 2 - x * view.scale, oy: height / 2 - y * view.scale }, width, height);
}

export function toMap(view: ViewTransform, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - view.ox) / view.scale, y: (sy - view.oy) / view.scale };
}
