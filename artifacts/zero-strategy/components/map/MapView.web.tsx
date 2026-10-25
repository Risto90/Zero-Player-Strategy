import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { Asset } from 'expo-asset';
import colors from '@/constants/colors';
import { MAP_HEIGHT, MAP_WIDTH } from '@/game/config';
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
    const hasPort = game.world.isCoastal(city.pixel) || game.world.rivers[city.pixel] > 0;
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

/** Browser preview of the map: a plain 2D canvas, same gestures as on the phone. */
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
    for (const city of game.world.cities) {
      const hasPort = game.world.isCoastal(city.pixel) || game.world.rivers[city.pixel] > 0;
      const zoomRank = cityVisibilityRank(city, hasPort);
      if (!isCityVisibleAtZoom(view.scale, baseScaleRef.current, zoomRank)) continue;
      const icon = cityImagesRef.current[cityIconIndex(city, hasPort)];
      if (!icon?.complete || icon.naturalWidth === 0) continue;
      const size = city.capital ? 40 : hasPort ? 30 + city.rank : 24 + city.rank;
      const x = view.ox + (city.pixel % MAP_WIDTH) * view.scale;
      const y = view.oy + Math.floor(city.pixel / MAP_WIDTH) * view.scale;
      if (x + size < 0 || y + size < 0 || x - size > width || y - size > height) continue;
      ctx.drawImage(icon, x - size / 2, y - size / 2, size, size);
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

  // The offscreen image shares memory with the renderer's pixel buffer.
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

  // Mouse wheel zoom.
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
