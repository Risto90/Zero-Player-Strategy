import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { useFonts } from 'expo-font';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Asset } from 'expo-asset';
import colors from '@/constants/colors';
import { MAP_HEIGHT, MAP_WIDTH } from '@/game/config';
import { cityLabelFontSize } from '@/game/cityVisibility';
import { Terrain3DRenderer } from './Terrain3DRenderer';
import {
  countryLabelViewportLayout,
  countryMapLabels,
  entityMapLabels,
  geographicVisibilityScale,
  labelVisibilityThreshold,
  riverVisibilityScale,
  shouldShowCityMarks,
  shouldShowGeographyMarks,
  visibleCityLabelIds,
  volcanoVisibilityScale,
} from '@/game/mapLabels';
import { discoveredRiverPaths } from '@/game/geographyGeometry';
import { elevationPackedColor, seaDepthPackedColor, STRIP_H } from '@/game/render';
import { cityInfluenceRadius } from '@/game/settlements';
import { CITY_ICON_SOURCES, cityIconIndex, cityVisibilityRank } from './cityIcons';
import { circleHatchLines } from './cityInfluenceHatching';
import { isCityVisibleAtZoom } from './cityIconMath';
import { MapGestures } from './gestures';
import { PAINT_BUDGET_MS, type MapViewHandle, type MapViewProps, type ViewTransform } from './types';
import { centerOnMapPoint, clampView, initialView, minScale, toMap, zoomAround } from './viewMath';

import { renderFlagSpec } from '@/game/flagRenderer';

const crownGlyph = String.fromCodePoint(Number(MaterialCommunityIcons.getRawGlyphMap().crown));
const crownFontFamily = MaterialCommunityIcons.getFontFamily();

function drawGoldCrown(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.save();
  ctx.font = `${size}px "${crownFontFamily}"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(1, size * 0.12);
  ctx.strokeStyle = 'rgba(35,30,24,0.8)';
  ctx.strokeText(crownGlyph, x, y);
  ctx.fillStyle = colors.light.crownGold;
  ctx.fillText(crownGlyph, x, y);
  ctx.restore();
}

function rgba(hex: string, alpha: number) {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function cachedSvgImage(
  svg: string,
  cache: Map<string, HTMLImageElement>,
  onLoad: () => void,
): HTMLImageElement | null {
  let image = cache.get(svg);
  if (!image) {
    image = new window.Image();
    image.onload = onLoad;
    image.onerror = () => cache.delete(svg);
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    cache.set(svg, image);
  }
  return image.complete && image.naturalWidth > 0 ? image : null;
}

function drawCityInfluence(
  ctx: CanvasRenderingContext2D,
  game: MapViewProps['game'],
  view: ViewTransform,
  width: number,
  height: number,
  baseScale: number,
) {
  const snapshot = game.getSnapshot();
  if (snapshot.mapMode !== 'cities') return;
  const selectedCityId = snapshot.selectedCityId;
  const selectedCity = selectedCityId === null ? null : game.world.cities[selectedCityId];
  for (const city of game.world.cities) {
    const centerX = view.ox + (city.pixel % MAP_WIDTH) * view.scale;
    const centerY = view.oy + Math.floor(city.pixel / MAP_WIDTH) * view.scale;
    const radius = cityInfluenceRadius(game.world, city) * view.scale;
    if (centerX + radius < 0 || centerY + radius < 0 || centerX - radius > width || centerY - radius > height) continue;
    const hasPort = game.world.isCoastal(city.pixel) || game.world.knownRivers[city.pixel] > 0;
    const selected = selectedCity?.id === city.id;
    if (!selected && !isCityVisibleAtZoom(view.scale, baseScale, cityVisibilityRank(city, hasPort))) continue;
    const color = game.world.countries[city.countryId]?.color ?? '#8f3036';
    if (selected) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = rgba(color, 0.12);
      ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
      ctx.strokeStyle = rgba(color, 0.72);
      ctx.lineWidth = 1.35;
      for (const line of circleHatchLines(centerX, centerY, radius, 8)) {
        ctx.beginPath();
        ctx.moveTo(line.x1, line.y1);
        ctx.lineTo(line.x2, line.y2);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.setLineDash(selected ? [8, 5] : []);
    ctx.lineWidth = selected ? 2.2 : Math.max(0.7, 0.7 + city.rank * 0.22);
    ctx.strokeStyle = rgba(color, selected ? 0.95 : 0.16 + city.rank * 0.075);
    ctx.stroke();
    if (selected) ctx.setLineDash([]);
  }
}

function mapTextColor(game: MapViewProps['game'], pixel: number): string {
  let packed = game.renderer.pixels[pixel] ?? 0xffeeeeee;
  if (game.getSnapshot().mapMode === 'elevation') {
    const elevation = game.world.elevation[pixel] ?? 0;
    packed = elevation < 0
      ? seaDepthPackedColor(elevation)
      : elevationPackedColor(elevation);
  }
  const red = packed & 255;
  const green = (packed >>> 8) & 255;
  const blue = (packed >>> 16) & 255;
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > 0.56 ? '#28231e' : '#fff7df';
}

const RIVER_COLORS: Record<number, string> = {
  1: '#6699ae',
  2: '#377497',
  3: '#22537d',
};

function drawRivers(
  ctx: CanvasRenderingContext2D,
  game: MapViewProps['game'],
  view: ViewTransform,
  baseScale: number,
) {
  const paths = discoveredRiverPaths(game.world);
  if (paths.length === 0 || view.scale < baseScale) return;
  ctx.save();
  for (const segment of paths) {
    if (view.scale < riverVisibilityScale(baseScale, segment.strength)) continue;
    const [minX, minY, maxX, maxY] = segment.bounds;
    if (view.ox + maxX * view.scale < 0 || view.oy + maxY * view.scale < 0 ||
      view.ox + minX * view.scale > ctx.canvas.clientWidth ||
      view.oy + minY * view.scale > ctx.canvas.clientHeight) continue;
    ctx.beginPath();
    for (let index = 0; index < segment.contourPoints.length; index += 1) {
      const point = segment.contourPoints[index];
      const x = view.ox + point.x * view.scale;
      const y = view.oy + point.y * view.scale;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = RIVER_COLORS[segment.strength];
    ctx.globalAlpha = segment.strength === 1 ? 0.82 : 0.94;
    ctx.fillStyle = RIVER_COLORS[segment.strength];
    ctx.fill();
  }
  ctx.restore();
}

function pointAlongPath(points: readonly { x: number; y: number }[], distance: number) {
  let traversed = 0;
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1];
    const after = points[index];
    const length = Math.hypot(after.x - before.x, after.y - before.y);
    if (traversed + length >= distance) {
      const ratio = length > 0 ? (distance - traversed) / length : 0;
      return {
        x: before.x + (after.x - before.x) * ratio,
        y: before.y + (after.y - before.y) * ratio,
        angle: Math.atan2(after.y - before.y, after.x - before.x),
      };
    }
    traversed += length;
  }
  const last = points[points.length - 1];
  const before = points[points.length - 2];
  return {
    x: last.x,
    y: last.y,
    angle: Math.atan2(last.y - before.y, last.x - before.x),
  };
}

function polylineLength(points: readonly ScreenPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return length;
}

function clipLineSegment(
  from: ScreenPoint,
  to: ScreenPoint,
  width: number,
  height: number,
): [ScreenPoint, ScreenPoint] | null {
  const left = 8, top = 8, right = width - 8, bottom = height - 8;
  const dx = to.x - from.x, dy = to.y - from.y;
  let start = 0, end = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [from.x - left, right - from.x, from.y - top, bottom - from.y];
  for (let index = 0; index < 4; index += 1) {
    if (Math.abs(p[index]) < 1e-9) {
      if (q[index] < 0) return null;
      continue;
    }
    const t = q[index] / p[index];
    if (p[index] < 0) start = Math.max(start, t);
    else end = Math.min(end, t);
    if (start > end) return null;
  }
  return [
    { x: from.x + dx * start, y: from.y + dy * start },
    { x: from.x + dx * end, y: from.y + dy * end },
  ];
}

function visibleRiverPaths(points: readonly (ScreenPoint | null)[], width: number, height: number): ScreenPoint[][] {
  const paths: ScreenPoint[][] = [];
  let current: ScreenPoint[] = [];
  const finish = () => {
    if (current.length > 1 && polylineLength(current) > 0) paths.push(current);
    current = [];
  };
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1], to = points[index];
    if (!from || !to) {
      finish();
      continue;
    }
    const clipped = clipLineSegment(from, to, width, height);
    if (!clipped) {
      finish();
      continue;
    }
    const [start, end] = clipped;
    const last = current[current.length - 1];
    if (last && Math.hypot(last.x - start.x, last.y - start.y) > 0.75) finish();
    if (!current.length) current.push(start);
    current.push(end);
  }
  finish();
  return paths;
}

function smoothRiverPath(points: readonly ScreenPoint[]): ScreenPoint[] {
  if (points.length < 5) return [...points];
  let smoothed = [...points];
  for (let pass = 0; pass < 2; pass += 1) {
    const next = [smoothed[0]];
    for (let index = 1; index < smoothed.length - 1; index += 1) {
      next.push({
        x: smoothed[index - 1].x * 0.2 + smoothed[index].x * 0.6 + smoothed[index + 1].x * 0.2,
        y: smoothed[index - 1].y * 0.2 + smoothed[index].y * 0.6 + smoothed[index + 1].y * 0.2,
      });
    }
    next.push(smoothed[smoothed.length - 1]);
    smoothed = next;
  }
  return smoothed;
}

function riverTextPath(points: readonly ScreenPoint[], textWidth: number): ScreenPoint[] | null {
  const length = polylineLength(points);
  if (length < textWidth) return null;
  const start = (length - textWidth) / 2;
  const end = start + textWidth;
  const firstPoint = pointAlongPath(points, start);
  const result: ScreenPoint[] = [{ x: firstPoint.x, y: firstPoint.y }];
  let traversed = 0;
  for (let index = 1; index < points.length; index += 1) {
    traversed += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
    if (traversed > start && traversed < end) result.push(points[index]);
  }
  const lastPoint = pointAlongPath(points, end);
  result.push({ x: lastPoint.x, y: lastPoint.y });
  return result;
}

function riverTextPathIsReadable(points: readonly ScreenPoint[], fontSize: number): boolean {
  if (points.length < 2) return false;
  let previousAngle: number | null = null;
  let totalTurn = 0;
  let minimumRadius = Infinity;
  for (let index = 1; index < points.length; index += 1) {
    const angle = Math.atan2(points[index].y - points[index - 1].y, points[index].x - points[index - 1].x);
    if (previousAngle !== null) {
      let turn = angle - previousAngle;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      totalTurn += Math.abs(turn);
      const segmentLength = Math.hypot(points[index].x - points[index - 1].x,
        points[index].y - points[index - 1].y);
      if (Math.abs(turn) > 0.001) minimumRadius = Math.min(minimumRadius, segmentLength / Math.abs(turn));
    }
    previousAngle = angle;
  }
  const chord = Math.hypot(points.at(-1)!.x - points[0].x, points.at(-1)!.y - points[0]!.y);
  return totalTurn <= (120 * Math.PI) / 180 &&
    minimumRadius >= 3 * fontSize &&
    polylineLength(points) / Math.max(1, chord) <= 1.25;
}

type LabelScreenBounds = { left: number; top: number; right: number; bottom: number };

function labelBoundsOverlap(a: LabelScreenBounds, b: LabelScreenBounds): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function drawRiverNames(
  ctx: CanvasRenderingContext2D,
  game: MapViewProps['game'],
  view: ViewTransform,
  baseScale: number,
  width: number,
  height: number,
  projectMapPoint?: (x: number, y: number) => ScreenPoint | null,
  occupiedLabels: LabelScreenBounds[] = [],
  additionalObstacles: readonly LabelScreenBounds[] = [],
) {
  const byRiver = new Map<number, ReturnType<typeof discoveredRiverPaths>>();
  for (const segment of discoveredRiverPaths(game.world)) {
    if (!segment.name || view.scale < riverVisibilityScale(baseScale, segment.strength)) continue;
    const paths = byRiver.get(segment.riverId) ?? [];
    paths.push(segment);
    byRiver.set(segment.riverId, paths);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const segments of byRiver.values()) {
    let visibleSegment: ReturnType<typeof discoveredRiverPaths>[number] | null = null;
    let screenPoints: ScreenPoint[] | null = null;
    let visibleLength = 0;
    for (const segment of segments) {
      const projectedPoints = projectMapPoint
        ? segment.points.map((point) => projectMapPoint(point.x, point.y))
        : segment.points.map((point) => ({
          x: view.ox + point.x * view.scale,
          y: view.oy + point.y * view.scale,
        }));
      for (const path of visibleRiverPaths(projectedPoints, width, height)) {
        const smoothed = smoothRiverPath(path);
        const length = polylineLength(smoothed);
        if (length > visibleLength) {
          visibleSegment = segment;
          screenPoints = smoothed;
          visibleLength = length;
        }
      }
    }
    if (!visibleSegment || !screenPoints) continue;
    const segment = visibleSegment;
    const screenLength = polylineLength(screenPoints);
    const characters = [...(segment.name ?? '')];
    const screenWidth = projectMapPoint
      ? segment.width * (screenLength / Math.max(1, segment.length))
      : segment.width * view.scale;
    const maximumFont = Math.min(18, Math.max(11, screenWidth * 0.8));
    let chosen: { size: number; widths: number[]; tracking: number; textWidth: number; path: ScreenPoint[] } | null = null;
    for (let size = maximumFont; size >= 11; size -= 1) {
      ctx.font = `600 ${size}px "IBM Plex Sans", sans-serif`;
      const widths = characters.map((character) => ctx.measureText(character).width);
      const glyphWidth = widths.reduce((sum, item) => sum + item, 0);
      const available = screenLength - 2 * size;
      const gaps = Math.max(0, characters.length - 1);
      const tracking = gaps > 0
        ? Math.max(0, Math.min(size * 0.45, (available * 0.75 - glyphWidth) / gaps))
        : 0;
      const textWidth = glyphWidth + gaps * tracking;
      if (available <= 0 || textWidth > available * 0.9) continue;
      const path = riverTextPath(screenPoints, textWidth);
      if (!path || !riverTextPathIsReadable(path, size)) continue;
      chosen = { size, widths, tracking, textWidth, path };
      break;
    }
    if (!chosen) continue;
    ctx.font = `600 ${chosen.size}px "IBM Plex Sans", sans-serif`;
    const midpoint = pointAlongPath(chosen.path, chosen.textWidth / 2);
    const centerX = midpoint.x;
    const centerY = midpoint.y;
    if (centerX < 8 || centerY < 8 || centerX > width - 8 || centerY > height - 8) continue;
    let cursor = 0;
    const glyphs: {
      character: string;
      x: number;
      y: number;
      angle: number;
      bounds: LabelScreenBounds;
    }[] = [];
    for (let index = 0; index < chosen.widths.length; index += 1) {
      const characterWidth = chosen.widths[index];
      const location = pointAlongPath(chosen.path, cursor + characterWidth / 2);
      let angle = location.angle;
      if (angle > Math.PI / 2) angle -= Math.PI;
      else if (angle <= -Math.PI / 2) angle += Math.PI;
      const pad = chosen.size * 0.3;
      const extentX = (
        Math.abs(Math.cos(angle)) * characterWidth +
        Math.abs(Math.sin(angle)) * chosen.size
      ) / 2 + pad;
      const extentY = (
        Math.abs(Math.sin(angle)) * characterWidth +
        Math.abs(Math.cos(angle)) * chosen.size
      ) / 2 + pad;
      glyphs.push({
        character: characters[index],
        x: location.x,
        y: location.y,
        angle,
        bounds: {
          left: location.x - extentX,
          top: location.y - extentY,
          right: location.x + extentX,
          bottom: location.y + extentY,
        },
      });
      cursor += characterWidth + chosen.tracking;
    }
    const obstacles = [...occupiedLabels, ...additionalObstacles];
    if (glyphs.some((glyph) => obstacles.some((other) => labelBoundsOverlap(glyph.bounds, other)))) continue;
    occupiedLabels.push(...glyphs.map((glyph) => glyph.bounds));

    for (const glyph of glyphs) {
      ctx.save();
      ctx.translate(glyph.x, glyph.y);
      ctx.rotate(glyph.angle);
      ctx.lineWidth = Math.max(1.2, chosen.size * 0.24);
      ctx.strokeStyle = '#fff';
      ctx.strokeText(glyph.character, 0, 0);
      ctx.fillStyle = '#17130f';
      ctx.fillText(glyph.character, 0, 0);
      ctx.restore();
    }
  }
}

const countryTextWidthFactorCache = new Map<string, number>();

function measuredCountryTextWidthFactor(ctx: CanvasRenderingContext2D, value: string): number {
  const cached = countryTextWidthFactorCache.get(value);
  if (cached !== undefined) return cached;
  const characters = [...value];
  ctx.save();
  ctx.font = '600 100px "IBM Plex Sans", sans-serif';
  const glyphWidth = characters.reduce((sum, character) => sum + ctx.measureText(character).width, 0);
  ctx.restore();
  const factor = glyphWidth / 100;
  if (countryTextWidthFactorCache.size >= 4096) countryTextWidthFactorCache.clear();
  countryTextWidthFactorCache.set(value, factor);
  return factor;
}

function drawMapLabels(
  ctx: CanvasRenderingContext2D,
  game: MapViewProps['game'],
  view: ViewTransform,
  baseScale: number,
  width: number,
  height: number,
  projectMapPoint?: (x: number, y: number) => ScreenPoint | null,
  avoidToolOverlay = false,
): LabelScreenBounds[] {
  const snapshot = game.getSnapshot();
  const ratio = view.scale / Math.max(baseScale, 0.0001);
  const text = (value: string, x: number, y: number, size: number, color: string, maxWidth?: number) => {
    if (x < -100 || y < -30 || x > width + 100 || y > height + 30) return;
    ctx.font = `600 ${size}px "IBM Plex Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(1, size * 0.2);
    ctx.strokeStyle = color === '#fff7df' ? 'rgba(35,30,24,0.75)' : 'rgba(255,248,229,0.8)';
    ctx.strokeText(value, x, y, maxWidth);
    ctx.fillStyle = color;
    ctx.fillText(value, x, y, maxWidth);
  };
  const trackedCountryLabel = (
    value: string,
    x: number,
    y: number,
    size: number,
    tracking: number,
    color: string,
    angle: number,
    path: ScreenPoint[] | null,
    lines: string[] = [value],
  ) => {
    const displayLines = lines.length ? lines : [value];
    ctx.font = `600 ${size}px "IBM Plex Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lineMetrics = displayLines.map((line) => {
      const characters = [...line];
      const widths = characters.map((character) => ctx.measureText(character).width);
      const totalWidth = widths.reduce((sum, charWidth) => sum + charWidth, 0) +
        Math.max(0, characters.length - 1) * tracking;
      return { characters, widths, totalWidth };
    });
    ctx.lineWidth = Math.max(1, size * 0.2);
    ctx.strokeStyle = color === '#fff7df' ? 'rgba(35,30,24,0.75)' : 'rgba(255,248,229,0.85)';
    ctx.fillStyle = color;
    const drawGlyph = (character: string, glyphX: number, glyphY: number, glyphAngle: number) => {
      ctx.save();
      ctx.translate(glyphX, glyphY);
      ctx.rotate(glyphAngle);
      ctx.strokeText(character, 0, 0);
      ctx.fillText(character, 0, 0);
      ctx.restore();
    };
    if (path && path.length >= 2 && lineMetrics.length === 1) {
      const { characters, widths, totalWidth } = lineMetrics[0];
      const pathLength = path.slice(1).reduce((sum, point, index) =>
        sum + Math.hypot(point.x - path[index].x, point.y - path[index].y), 0);
      let cursor = Math.max(0, (pathLength - totalWidth) / 2);
      characters.forEach((character, index) => {
        const charWidth = widths[index];
        const location = pointAlongPath(path, cursor + charWidth / 2);
        let glyphAngle = location.angle;
        if (glyphAngle > Math.PI / 2) glyphAngle -= Math.PI;
        else if (glyphAngle <= -Math.PI / 2) glyphAngle += Math.PI;
        drawGlyph(character, location.x, location.y, glyphAngle);
        cursor += charWidth + tracking;
      });
      return;
    }

    lineMetrics.forEach(({ characters, widths, totalWidth }, lineIndex) => {
      let cursor = -totalWidth / 2;
      const normalOffset = (lineIndex - (lineMetrics.length - 1) / 2) * size * 1.2;
      const lineX = x - Math.sin(angle) * normalOffset;
      const lineY = y + Math.cos(angle) * normalOffset;
      characters.forEach((character, index) => {
        const charWidth = widths[index];
        const along = cursor + charWidth / 2;
        drawGlyph(
          character,
          lineX + Math.cos(angle) * along,
          lineY + Math.sin(angle) * along,
          angle,
        );
        cursor += charWidth + tracking;
      });
    });
  };

  const cityIconBounds: LabelScreenBounds[] = [];
  if (shouldShowCityMarks(snapshot.mapMode)) for (const city of game.world.cities) {
    const hasPort = game.world.isCoastal(city.pixel) || game.world.knownRivers[city.pixel] > 0;
    if (!isCityVisibleAtZoom(view.scale, baseScale, cityVisibilityRank(city, hasPort))) continue;
    const size = hasPort ? 30 + city.rank : 24 + city.rank;
    const x = view.ox + (city.pixel % MAP_WIDTH) * view.scale;
    const y = view.oy + Math.floor(city.pixel / MAP_WIDTH) * view.scale;
    if (x + size < 0 || y + size < 0 || x - size > width || y - size > height) continue;
    cityIconBounds.push({
      left: x - size / 2 - 2,
      top: y - size / 2 - 2,
      right: x + size / 2 + 2,
      bottom: y + size / 2 + 2,
    });
  }

  const featureMarks: {
    feature: (typeof game.world.peaks)[number] | (typeof game.world.volcanoes)[number];
    active: boolean;
    isVolcano: boolean;
    x: number;
    y: number;
    size: number;
  }[] = [];
  if (shouldShowGeographyMarks(snapshot.mapMode)) for (const feature of [...game.world.peaks, ...game.world.volcanoes]) {
    if (!feature.discoveredBy.length) continue;
    const isVolcano = game.world.volcanoes.includes(feature);
    const active = isVolcano && feature.active === true;
    if (isVolcano && !active) continue;
    const visibilityScale = active
      ? volcanoVisibilityScale(baseScale, feature.activityIntervalYears, feature.eruptionIntensity)
      : geographicVisibilityScale(baseScale, feature.elevation);
    if (view.scale < visibilityScale) continue;
    const mapX = feature.pixel % MAP_WIDTH;
    const mapY = Math.floor(feature.pixel / MAP_WIDTH);
    const projected = projectMapPoint?.(mapX, mapY);
    if (projectMapPoint && !projected) continue;
    const x = projected?.x ?? view.ox + mapX * view.scale;
    const y = projected?.y ?? view.oy + mapY * view.scale;
    if (x < -24 || y < -30 || x > width + 24 || y > height + 30) continue;
    featureMarks.push({
      feature,
      active,
      isVolcano,
      x,
      y,
      size: Math.max(5, Math.min(11, 6 + ratio * 1.5)),
    });
  }
  const uiOverlayBounds: LabelScreenBounds[] = [
    { left: Math.max(0, width - 120), top: 0, right: width, bottom: 44 },
    { left: Math.max(0, width - 58), top: 44, right: width, bottom: 188 },
    ...(avoidToolOverlay
      ? [{ left: 0, top: 0, right: Math.min(width, width < 420 ? 200 : 280), bottom: 140 }]
      : []),
  ];
  const occupiedLabels: LabelScreenBounds[] = [
    ...uiOverlayBounds,
    ...featureMarks.map(({ x, y, size }) => ({
      left: x - size * 0.85 - 2,
      top: y - size - 2,
      right: x + size * 0.85 + 2,
      bottom: y + size * 0.62 + 2,
    })),
  ];

  const labels = [
    ...countryMapLabels(game.world, null, snapshot.mapMode, snapshot.selectedCountryId, false),
    ...entityMapLabels(game.world, snapshot.mapMode, snapshot.layer, undefined, false),
  ];
  const pendingLabels: {
    label: (typeof labels)[number];
    layout: ReturnType<typeof countryLabelViewportLayout>;
    color: string;
    bounds: LabelScreenBounds;
  }[] = [];
  for (const label of labels) {
    const layout = countryLabelViewportLayout(
      label,
      view.scale,
      view.ox,
      view.oy,
      width,
      height,
      measuredCountryTextWidthFactor(ctx, label.text),
      labelVisibilityThreshold(label.key),
      (line) => measuredCountryTextWidthFactor(ctx, line),
      [...occupiedLabels, ...cityIconBounds],
    );
    if (!layout.visible) continue;
    const mapX = Math.max(0, Math.min(MAP_WIDTH - 1, Math.floor(layout.worldX)));
    const mapY = Math.max(0, Math.min(MAP_HEIGHT - 1, Math.floor(layout.worldY)));
    const pixel = mapY * MAP_WIDTH + mapX;
    const color = label.selected ? '#e7c56e' : mapTextColor(game, pixel);
    const textWidth = Math.max(...layout.lines.map((line) =>
      measuredCountryTextWidthFactor(ctx, line) * layout.fontSize +
      Math.max(0, [...line].length - 1) * layout.letterSpacing));
    const textHeight = layout.fontSize * 1.2 * layout.lines.length;
    let extentX: number;
    let extentY: number;
    if (layout.path?.length) {
      const pathX = layout.path.map((point) => point.x);
      const pathY = layout.path.map((point) => point.y);
      extentX = (Math.max(...pathX) - Math.min(...pathX) + textHeight) / 2;
      extentY = (Math.max(...pathY) - Math.min(...pathY) + textHeight) / 2;
    } else {
      extentX = (Math.abs(Math.cos(layout.angle)) * textWidth +
        Math.abs(Math.sin(layout.angle)) * textHeight) / 2;
      extentY = (Math.abs(Math.sin(layout.angle)) * textWidth +
        Math.abs(Math.cos(layout.angle)) * textHeight) / 2;
    }
    const margin = layout.fontSize * 0.3;
    pendingLabels.push({
      label,
      layout,
      color,
      bounds: {
        left: layout.x - extentX - margin,
        top: layout.y - extentY - margin,
        right: layout.x + extentX + margin,
        bottom: layout.y + extentY + margin,
      },
    });
  }
  pendingLabels.sort((a, b) =>
    Number(b.label.selected) - Number(a.label.selected) ||
    b.layout.fontSize - a.layout.fontSize ||
    a.label.key.localeCompare(b.label.key));
  for (const pending of pendingLabels) {
    if ([...occupiedLabels, ...cityIconBounds].some((bounds) =>
      labelBoundsOverlap(pending.bounds, bounds))) continue;
    occupiedLabels.push(pending.bounds);
    trackedCountryLabel(
      pending.label.text,
      pending.layout.x,
      pending.layout.y,
      pending.layout.fontSize,
      pending.layout.letterSpacing,
      pending.color,
      pending.layout.angle,
      pending.layout.path,
      pending.layout.lines,
    );
  }

  for (const { feature, active, isVolcano, x, y, size } of featureMarks) {
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x - size * 0.78, y + size * 0.62);
    ctx.lineTo(x + size * 0.78, y + size * 0.62);
    ctx.closePath();
    ctx.fillStyle = active ? '#bd382c' : isVolcano ? '#b2763e' : '#594b3c';
    ctx.strokeStyle = 'rgba(250,244,224,0.9)';
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
    if (feature.name) {
      const pixel = feature.pixel;
      const labelY = y + size + 6;
      ctx.font = '600 7px "IBM Plex Sans", sans-serif';
      const labelWidth = ctx.measureText(feature.name).width;
      const labelBounds = {
        left: x - labelWidth / 2 - 2,
        top: labelY - 7 * 0.6,
        right: x + labelWidth / 2 + 2,
        bottom: labelY + 7 * 0.6,
      };
      if (![...occupiedLabels, ...cityIconBounds].some((bounds) =>
        labelBoundsOverlap(labelBounds, bounds))) {
        text(feature.name, x, labelY, 7, mapTextColor(game, pixel));
        occupiedLabels.push(labelBounds);
      }
    }
  }

  drawRiverNames(ctx, game, view, baseScale, width, height, projectMapPoint, occupiedLabels, cityIconBounds);
  return occupiedLabels;
}

type ScreenPoint = { x: number; y: number };

/** Браузерная карта: растровые слои, управление жестами и 3D-рельеф высот. */
export const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(
  { game, tool, canPaint, avoidToolOverlay = false, onInspect, onMapActivity },
  ref,
) {
  const [iconFontsLoaded] = useFonts(MaterialCommunityIcons.font);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const terrainCanvasRef = useRef<HTMLCanvasElement>(null);
  const terrainRendererRef = useRef<Terrain3DRenderer | null>(null);
  const terrainErrorRef = useRef<string | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<ImageData | null>(null);
  const cityImagesRef = useRef<(HTMLImageElement | null)[]>([]);
  const svgImagesRef = useRef(new Map<string, HTMLImageElement>());
  const redrawRef = useRef<() => void>(() => {});
  const viewRef = useRef<ViewTransform>({ scale: 1, ox: 0, oy: 0 });
  const sizeRef = useRef({ width: 1, height: 1, dpr: 1 });
  const baseScaleRef = useRef(1);
  const frameRef = useRef(0);
  const orbitPointerRef = useRef<number | null>(null);
  const orbitLastRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const toolRef = useRef(tool);
  const canPaintRef = useRef(canPaint);
  const inspectRef = useRef(onInspect);
  toolRef.current = tool;
  canPaintRef.current = canPaint;
  inspectRef.current = onInspect;

  const draw = useCallback(() => {
    frameRef.current = 0;
    const canvas = canvasRef.current;
    const terrainCanvas = terrainCanvasRef.current;
    const offscreen = offscreenRef.current;
    const image = imageRef.current;
    if (!canvas || !offscreen || !image) return;
    const octx = offscreen.getContext('2d');
    for (const s of game.renderer.flushSome(PAINT_BUDGET_MS)) octx?.putImageData(image, 0, 0, 0, s * STRIP_H, MAP_WIDTH, STRIP_H);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height, dpr } = sizeRef.current;
    const view = viewRef.current;
    const mapMode = game.getSnapshot().mapMode;
    const isElevation = mapMode === 'elevation';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (isElevation) {
      ctx.clearRect(0, 0, width, height);
      if (terrainCanvas) {
        terrainCanvas.style.display = 'block';
        if (!terrainRendererRef.current && !terrainErrorRef.current) {
          try {
            terrainRendererRef.current = new Terrain3DRenderer(terrainCanvas);
          } catch (error) {
            terrainErrorRef.current = error instanceof Error ? error.message : String(error);
            console.error('Не удалось создать 3D-рельеф:', error);
          }
        }
        if (terrainRendererRef.current) {
          terrainRendererRef.current.render(game.world, view, { width, height, dpr }, baseScaleRef.current);
        }
      }
      if (terrainErrorRef.current) {
        ctx.fillStyle = '#241e18';
        ctx.font = '600 15px "IBM Plex Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`3D-рельеф недоступен: ${terrainErrorRef.current}`, width / 2, height / 2, width - 32);
      }
    } else {
      if (terrainCanvas) terrainCanvas.style.display = 'none';
      ctx.fillStyle = colors.light.mapBackdrop;
      ctx.fillRect(0, 0, width, height);
      ctx.imageSmoothingEnabled = view.scale < 1;
      ctx.drawImage(offscreen, view.ox, view.oy, MAP_WIDTH * view.scale, MAP_HEIGHT * view.scale);
      drawRivers(ctx, game, view, baseScaleRef.current);
    }
    drawCityInfluence(ctx, game, view, width, height, baseScaleRef.current);
    const projectMapPoint = isElevation && terrainRendererRef.current
      ? (x: number, y: number) => terrainRendererRef.current?.projectMapPoint(
        x,
        y,
        sizeRef.current,
        game.world,
      ) ?? null
      : undefined;
    const occupiedMapLabels = drawMapLabels(
      ctx,
      game,
      view,
      baseScaleRef.current,
      width,
      height,
      projectMapPoint,
      avoidToolOverlay,
    );
    const cityLabelIds = visibleCityLabelIds(
      game.world,
      mapMode,
      view.scale,
      baseScaleRef.current,
      view.ox,
      view.oy,
      width,
      height,
      occupiedMapLabels,
    );
    if (shouldShowCityMarks(mapMode)) for (const city of game.world.cities) {
      const hasPort = game.world.isCoastal(city.pixel) || game.world.knownRivers[city.pixel] > 0;
      const zoomRank = cityVisibilityRank(city, hasPort);
      if (!isCityVisibleAtZoom(view.scale, baseScaleRef.current, zoomRank)) continue;
      const icon = cityImagesRef.current[cityIconIndex(city, hasPort)];
      if (!icon?.complete || icon.naturalWidth === 0) continue;
      const size = hasPort ? 30 + city.rank : 24 + city.rank;
      const x = view.ox + (city.pixel % MAP_WIDTH) * view.scale;
      const y = view.oy + Math.floor(city.pixel / MAP_WIDTH) * view.scale;
      if (x + size < 0 || y + size < 0 || x - size > width || y - size > height) continue;
      ctx.drawImage(icon, x - size / 2, y - size / 2, size, size);
      if (city.name && cityLabelIds.has(city.id)) {
        const labelFontSize = cityLabelFontSize(view.scale, baseScaleRef.current);
        ctx.font = `600 ${labelFontSize}px "IBM Plex Sans", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const labelY = y - size / 2 - Math.max(2, labelFontSize * 0.22);
        const textWidth = ctx.measureText(city.name).width;
        const flagSvg = city.emblemSpec ? renderFlagSpec(city.emblemSpec) : null;
        const flagImage = flagSvg
          ? cachedSvgImage(flagSvg, svgImagesRef.current, () => redrawRef.current())
          : null;
        const flagAspect = city.emblemSpec
          ? Math.max(0.5, Math.min(2.6, city.emblemSpec.outline.aspect))
          : 1;
        const flagHeight = flagSvg ? Math.max(8, labelFontSize * 1.1) : 0;
        const flagWidth = flagSvg ? flagHeight * flagAspect : 0;
        const crownSize = city.capital ? labelFontSize * 1.45 : 0;
        const markWidth = flagSvg ? Math.max(flagWidth, crownSize) : crownSize;
        const gap = markWidth ? Math.max(4, labelFontSize * 0.35) : 0;
        const labelLeft = x - (textWidth + markWidth + gap) / 2;
        const textCenter = labelLeft + markWidth + gap + textWidth / 2;
        const color = mapTextColor(game, city.pixel);
        ctx.lineWidth = Math.max(1, labelFontSize * 0.22);
        ctx.strokeStyle = color === '#fff7df' ? 'rgba(35,30,24,0.75)' : 'rgba(255,248,229,0.85)';
        ctx.fillStyle = color;
        if (flagSvg && flagImage) {
          ctx.drawImage(
            flagImage,
            labelLeft + (markWidth - flagWidth) / 2,
            labelY - labelFontSize * 0.88,
            flagWidth,
            flagHeight,
          );
          if (city.capital && iconFontsLoaded) {
            drawGoldCrown(
              ctx,
              labelLeft + markWidth / 2,
              labelY - labelFontSize * 0.88 - crownSize / 2 - 2,
              crownSize,
            );
          }
        } else if (city.capital && iconFontsLoaded) {
          drawGoldCrown(ctx, labelLeft + markWidth / 2, labelY - labelFontSize / 2, crownSize);
        }
        ctx.strokeText(city.name, textCenter, labelY);
        ctx.fillText(city.name, textCenter, labelY);
      }
    }
    const cursor = cursorRef.current;
    if (cursor) {
      const radius = game.brushRadius * view.scale;
      ctx.beginPath();
      ctx.arc(cursor.x, cursor.y, radius, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(30,26,20,0.9)';
      ctx.stroke();
    }
    if (game.renderer.pending) frameRef.current = requestAnimationFrame(draw);
    else game.mapDrawn();
  }, [game, iconFontsLoaded]);

  const requestDraw = useCallback(() => {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(draw);
  }, [draw]);
  redrawRef.current = requestDraw;

  const mapMode = game.getSnapshot().mapMode;
  useEffect(() => {
    requestDraw();
  }, [mapMode, requestDraw]);

  useEffect(() => {
    const images = CITY_ICON_SOURCES.map((source, index) => {
      const asset = Asset.fromModule(source);
      const uri = asset.localUri ?? asset.uri;
      if (!uri) {
        console.error(`City icon ${index} has no resolved asset URI`);
        return null;
      }
      const image = new window.Image();
      image.onload = requestDraw;
      image.onerror = () => console.error(`Failed to load city icon ${index}`);
      image.src = uri;
      return image;
    });
    cityImagesRef.current = images;
    return () => {
      for (const image of images) if (image) image.onload = null;
    };
  }, [requestDraw]);

  useEffect(() => () => {
    terrainRendererRef.current?.dispose();
    terrainRendererRef.current = null;
  }, []);

  const applyView = useCallback(
    (view: ViewTransform) => {
      viewRef.current = view;
      requestDraw();
    },
    [requestDraw],
  );

  useImperativeHandle(ref, () => ({
    zoomBy: (factor: number) => {
      const { width, height } = sizeRef.current;
      applyView(zoomAround(viewRef.current, factor, width / 2, height / 2, width, height));
    },
    fit: () => {
      const { width, height } = sizeRef.current;
      applyView(clampView({ scale: minScale(width, height), ox: 0, oy: 0 }, width, height));
    },
    centerAtPixel: (pixel: number) => {
      const { width, height } = sizeRef.current;
      applyView(centerOnMapPoint(viewRef.current, pixel % MAP_WIDTH, Math.floor(pixel / MAP_WIDTH), width, height));
    },
  }));

  const gestures = useMemo(
    () =>
      new MapGestures({
        game,
        getView: () => viewRef.current,
        setView: applyView,
        size: () => sizeRef.current,
        tool: () => toolRef.current,
        canPaint: () => canPaintRef.current,
        onInspect: (info) => inspectRef.current?.(info),
        mapPointAt: (x, y) => game.getSnapshot().mapMode === 'elevation'
          ? terrainRendererRef.current?.mapPointAt(x, y, viewRef.current, sizeRef.current, game.world) ??
            toMap(viewRef.current, x, y)
          : toMap(viewRef.current, x, y),
        setCursor: (point) => {
          cursorRef.current = point;
          requestDraw();
        },
      }),
    [game, applyView, requestDraw],
  );

  // Изображение вне экрана использует тот же буфер памяти, что и пиксели отрисовщика.
  useEffect(() => {
    const offscreen = document.createElement('canvas');
    offscreen.width = MAP_WIDTH;
    offscreen.height = MAP_HEIGHT;
    offscreenRef.current = offscreen;
    imageRef.current = new ImageData(new Uint8ClampedArray(game.renderer.pixels.buffer), MAP_WIDTH, MAP_HEIGHT);
    game.redrawAll();
    requestDraw();
    const off = game.onMapChange(requestDraw);
    return () => {
      off();
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [game, requestDraw]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const terrainCanvas = terrainCanvasRef.current;
    if (!wrap || !canvas || !terrainCanvas) return;
    let first = true;
    const observer = new ResizeObserver(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, wrap.clientWidth);
      const height = Math.max(1, wrap.clientHeight);
      sizeRef.current = { width, height, dpr };
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      terrainCanvas.style.width = `${width}px`;
      terrainCanvas.style.height = `${height}px`;
      baseScaleRef.current = initialView(width, height).scale;
      applyView(first ? initialView(width, height) : clampView(viewRef.current, width, height));
      first = false;
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [applyView]);

  // Масштабирование колёсиком мыши.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      onMapActivity?.();
      const rect = canvas.getBoundingClientRect();
      const { width, height } = sizeRef.current;
      applyView(zoomAround(viewRef.current, Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top, width, height));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [applyView, onMapActivity]);

  const local = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  return (
    <div ref={wrapRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden', touchAction: 'none' }}>
      <canvas
        ref={terrainCanvasRef}
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          display: 'none',
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      />
      <canvas
        ref={canvasRef}
        data-testid="map-canvas"
        style={{
          position: 'absolute',
          inset: 0,
          display: 'block',
          background: 'transparent',
          touchAction: 'none',
          cursor: tool === 'brush' && canPaint ? 'crosshair' : 'grab',
        }}
        onPointerEnter={onMapActivity}
        onPointerDown={(event) => {
          onMapActivity?.();
          event.currentTarget.setPointerCapture(event.pointerId);
          const p = local(event);
          if (event.button === 2 && game.getSnapshot().mapMode === 'elevation') {
            event.preventDefault();
            orbitPointerRef.current = event.pointerId;
            orbitLastRef.current = p;
            return;
          }
          if (event.button !== 0) return;
          gestures.down(event.pointerId, p.x, p.y);
        }}
        onPointerMove={(event) => {
          onMapActivity?.();
          const p = local(event);
          if (orbitPointerRef.current === event.pointerId) {
            terrainRendererRef.current?.orbit(p.x - orbitLastRef.current.x, p.y - orbitLastRef.current.y);
            orbitLastRef.current = p;
            requestDraw();
            return;
          }
          gestures.move(event.pointerId, p.x, p.y);
        }}
        onPointerUp={(event) => {
          if (orbitPointerRef.current === event.pointerId) orbitPointerRef.current = null;
          else gestures.up(event.pointerId);
        }}
        onPointerCancel={(event) => {
          if (orbitPointerRef.current === event.pointerId) orbitPointerRef.current = null;
          else gestures.up(event.pointerId);
        }}
        onContextMenu={(event) => event.preventDefault()}
      />
    </div>
  );
});
