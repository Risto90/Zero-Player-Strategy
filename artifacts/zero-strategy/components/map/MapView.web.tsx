import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { Asset } from 'expo-asset';
import colors from '@/constants/colors';
import { MAP_HEIGHT, MAP_WIDTH } from '@/game/config';
import { STRIP_H } from '@/game/render';
import { CITY_ICON_SOURCES, cityIconIndex, cityVisibilityRank } from './cityIcons';
import { MapGestures } from './gestures';
import { PAINT_BUDGET_MS, type MapViewHandle, type MapViewProps, type ViewTransform } from './types';
import { clampView, initialView, minScale, zoomAround } from './viewMath';

/** Browser preview of the map: a plain 2D canvas, same gestures as on the phone. */
export const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView({ game, tool, canPaint, onInspect }, ref) {
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
    for (const city of game.world.cities) {
      const hasPort = game.world.isCoastal(city.pixel) || game.world.rivers[city.pixel] > 0;
      const zoomRank = cityVisibilityRank(city, hasPort);
      if (view.scale < baseScaleRef.current * (1 + (6 - zoomRank) * 0.2)) continue;
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
      const rect = canvas.getBoundingClientRect();
      const { width, height } = sizeRef.current;
      applyView(zoomAround(viewRef.current, Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top, width, height));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [applyView]);

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
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          const p = local(event);
          gestures.down(event.pointerId, p.x, p.y);
        }}
        onPointerMove={(event) => {
          const p = local(event);
          gestures.move(event.pointerId, p.x, p.y);
        }}
        onPointerUp={(event) => gestures.up(event.pointerId)}
        onPointerCancel={(event) => gestures.up(event.pointerId)}
      />
    </div>
  );
});
