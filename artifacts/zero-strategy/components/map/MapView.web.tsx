import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { Asset } from 'expo-asset';
import colors from '@/constants/colors';
import { MAP_HEIGHT, MAP_WIDTH } from '@/game/config';
import { countryMapLabels, geographicVisibilityScale } from '@/game/mapLabels';
import { STRIP_H } from '@/game/render';
import { cityInfluenceRadius } from '@/game/settlements';
import { CITY_ICON_SOURCES, cityIconIndex, cityVisibilityRank } from './cityIcons';
import { circleHatchLines } from './cityInfluenceHatching';
import { isCityVisibleAtZoom } from './cityIconMath';
import { MapGestures } from './gestures';
import { PAINT_BUDGET_MS, type MapViewHandle, type MapViewProps, type ViewTransform } from './types';
import { centerOnMapPoint, clampView, initialView, minScale, zoomAround } from './viewMath';

function rgba(hex: string, alpha: number) {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
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
  const packed = game.renderer.pixels[pixel] ?? 0xffeeeeee;
  const red = packed & 255;
  const green = (packed >>> 8) & 255;
  const blue = (packed >>> 16) & 255;
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > 0.56 ? '#28231e' : '#fff7df';
}

function drawMapLabels(
  ctx: CanvasRenderingContext2D,
  game: MapViewProps['game'],
  view: ViewTransform,
  baseScale: number,
  width: number,
  height: number,
) {
  const snapshot = game.getSnapshot();
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

  for (const label of countryMapLabels(game.world, view.scale, snapshot.mapMode, snapshot.selectedCountryId)) {
    const x = view.ox + label.x * view.scale;
    const y = view.oy + label.y * view.scale;
    const pixel = Math.floor(label.y) * MAP_WIDTH + Math.floor(label.x);
    const color = label.selected ? '#e7c56e' : mapTextColor(game, pixel);
    text(label.text, x, y, Math.max(7, Math.min(18, label.fontSize * view.scale)), color,
      Math.max(1, label.width * view.scale));
  }

  const ratio = view.scale / Math.max(baseScale, 0.0001);
  for (const feature of [...game.world.peaks, ...game.world.volcanoes]) {
    if (!feature.discoveredBy.length) continue;
    const isVolcano = game.world.volcanoes.includes(feature);
    const active = isVolcano && feature.active === true;
    if (view.scale < geographicVisibilityScale(baseScale, feature.elevation, active)) continue;
    const x = view.ox + (feature.pixel % MAP_WIDTH) * view.scale;
    const y = view.oy + Math.floor(feature.pixel / MAP_WIDTH) * view.scale;
    if (x < -24 || y < -30 || x > width + 24 || y > height + 30) continue;
    const size = Math.max(5, Math.min(11, 6 + ratio * 1.5));
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
      text(feature.name, x, y + size + 6, 7, mapTextColor(game, pixel));
    }
  }

  for (const river of game.world.riverFeatures) {
    if (!river.name || !river.discoveredBy.length) continue;
    let bestPath: { x: number; y: number }[] | null = null;
    let bestLength = 0;
    for (const path of river.paths) {
      let length = 0;
      for (let i = 1; i < path.length; i += 1) {
        length += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
      }
      if (length > bestLength) {
        bestLength = length;
        bestPath = path;
      }
    }
    if (!bestPath || bestLength * view.scale < Math.max(24, river.name.length * 6)) continue;
    let accumulated = 0;
    const half = bestLength / 2;
    let midIndex = 1;
    for (; midIndex < bestPath.length; midIndex += 1) {
      accumulated += Math.hypot(bestPath[midIndex].x - bestPath[midIndex - 1].x, bestPath[midIndex].y - bestPath[midIndex - 1].y);
      if (accumulated >= half) break;
    }
    const point = bestPath[Math.min(bestPath.length - 1, midIndex)];
    const before = bestPath[Math.max(0, midIndex - 2)];
    const after = bestPath[Math.min(bestPath.length - 1, midIndex + 2)];
    const x = view.ox + point.x * view.scale;
    const y = view.oy + point.y * view.scale;
    let angle = Math.atan2(after.y - before.y, after.x - before.x);
    if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
    if (x < -100 || y < -30 || x > width + 100 || y > height + 30) continue;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.font = '600 6px "IBM Plex Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(245,243,231,0.9)';
    ctx.strokeText(river.name, 0, 0);
    ctx.fillStyle = '#255c78';
    ctx.fillText(river.name, 0, 0);
    ctx.restore();
  }
}

/** Предварительный просмотр карты в браузере: холст 2D и те же жесты, что на телефоне. */
export const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView({ game, tool, canPaint, onInspect, onMapActivity }, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<ImageData | null>(null);
  const cityImagesRef = useRef<(HTMLImageElement | null)[]>([]);
  const viewRef = useRef<ViewTransform>({ scale: 1, ox: 0, oy: 0 });
  const sizeRef = useRef({ width: 1, height: 1, dpr: 1 });
  const baseScaleRef = useRef(1);
  const frameRef = useRef(0);
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
    const offscreen = offscreenRef.current;
    const image = imageRef.current;
    if (!canvas || !offscreen || !image) return;
    const octx = offscreen.getContext('2d');
    for (const s of game.renderer.flushSome(PAINT_BUDGET_MS)) octx?.putImageData(image, 0, 0, 0, s * STRIP_H, MAP_WIDTH, STRIP_H);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height, dpr } = sizeRef.current;
    const view = viewRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = colors.light.mapBackdrop;
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = view.scale < 1;
    ctx.drawImage(offscreen, view.ox, view.oy, MAP_WIDTH * view.scale, MAP_HEIGHT * view.scale);
    drawCityInfluence(ctx, game, view, width, height, baseScaleRef.current);
    drawMapLabels(ctx, game, view, baseScaleRef.current, width, height);
    for (const city of game.world.cities) {
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
      if (city.name) {
        ctx.font = '600 9px "IBM Plex Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const labelY = y - size / 2 - 2;
        const textWidth = ctx.measureText(city.name).width;
        const crownWidth = city.capital ? 8 : 0;
        const labelLeft = x - (textWidth + crownWidth) / 2;
        const labelCenter = labelLeft + crownWidth + textWidth / 2;
        const color = mapTextColor(game, city.pixel);
        ctx.lineWidth = 2;
        ctx.strokeStyle = color === '#fff7df' ? 'rgba(35,30,24,0.75)' : 'rgba(255,248,229,0.85)';
        ctx.fillStyle = color;
        if (city.capital) {
          ctx.beginPath();
          ctx.moveTo(labelLeft, labelY - 1);
          ctx.lineTo(labelLeft + 1, labelY - 7);
          ctx.lineTo(labelLeft + 3, labelY - 4);
          ctx.lineTo(labelLeft + 5, labelY - 7);
          ctx.lineTo(labelLeft + 7, labelY - 4);
          ctx.lineTo(labelLeft + 9, labelY - 7);
          ctx.lineTo(labelLeft + 10, labelY - 1);
          ctx.closePath();
          ctx.fillStyle = '#d0a239';
          ctx.fill();
          ctx.fillStyle = color;
        }
        ctx.strokeText(city.name, labelCenter, labelY);
        ctx.fillText(city.name, labelCenter, labelY);
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
  }, [game]);

  const requestDraw = useCallback(() => {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(draw);
  }, [draw]);

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
    if (!wrap || !canvas) return;
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
        ref={canvasRef}
        data-testid="map-canvas"
        style={{ display: 'block', touchAction: 'none', cursor: tool === 'brush' && canPaint ? 'crosshair' : 'grab' }}
        onPointerEnter={onMapActivity}
        onPointerDown={(event) => {
          onMapActivity?.();
          event.currentTarget.setPointerCapture(event.pointerId);
          const p = local(event);
          gestures.down(event.pointerId, p.x, p.y);
        }}
        onPointerMove={(event) => {
          onMapActivity?.();
          const p = local(event);
          gestures.move(event.pointerId, p.x, p.y);
        }}
        onPointerUp={(event) => gestures.up(event.pointerId)}
        onPointerCancel={(event) => gestures.up(event.pointerId)}
      />
    </div>
  );
});
