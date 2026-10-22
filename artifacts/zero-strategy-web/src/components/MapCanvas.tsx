import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { MAP_HEIGHT, MAP_WIDTH } from '@/game/config';
import type { Game, PixelInfo } from '@/game/game';

export type MapTool = 'brush' | 'hand';

export interface MapCanvasHandle {
  zoomBy(factor: number): void;
  fit(): void;
}

interface MapCanvasProps {
  game: Game;
  /** 'brush' paints with the active card (when it can be painted); 'hand' pans and inspects. */
  tool: MapTool;
  canPaint: boolean;
  onInspect?: (info: PixelInfo | null) => void;
  className?: string;
}

interface View {
  scale: number;
  ox: number;
  oy: number;
}

const MAX_SCALE = 32;

/** The pixel map: pan with one finger (hand tool) or two fingers, pinch or wheel to zoom, paint with the brush. */
export const MapCanvas = forwardRef<MapCanvasHandle, MapCanvasProps>(function MapCanvas({ game, tool, canPaint, onInspect, className }, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<ImageData | null>(null);
  const viewRef = useRef<View>({ scale: 1, ox: 0, oy: 0 });
  const sizeRef = useRef({ width: 1, height: 1, dpr: 1 });
  const frameRef = useRef(0);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureRef = useRef<{
    kind: 'none' | 'paint' | 'pan' | 'pinch';
    startX: number;
    startY: number;
    moved: boolean;
    pinchDist: number;
    pinchMid: { x: number; y: number };
  }>({ kind: 'none', startX: 0, startY: 0, moved: false, pinchDist: 0, pinchMid: { x: 0, y: 0 } });
  const toolRef = useRef(tool);
  const canPaintRef = useRef(canPaint);
  toolRef.current = tool;
  canPaintRef.current = canPaint;

  const minScale = () => {
    const { width, height } = sizeRef.current;
    return Math.min(width / MAP_WIDTH, height / MAP_HEIGHT);
  };

  const clampView = (view: View): View => {
    const { width, height } = sizeRef.current;
    const scale = Math.max(minScale(), Math.min(MAX_SCALE, view.scale));
    const mapW = MAP_WIDTH * scale;
    const mapH = MAP_HEIGHT * scale;
    const ox = mapW <= width ? (width - mapW) / 2 : Math.min(0, Math.max(width - mapW, view.ox));
    const oy = mapH <= height ? (height - mapH) / 2 : Math.min(0, Math.max(height - mapH, view.oy));
    return { scale, ox, oy };
  };

  const draw = useCallback(() => {
    frameRef.current = 0;
    const canvas = canvasRef.current;
    const offscreen = offscreenRef.current;
    const image = imageRef.current;
    if (!canvas || !offscreen || !image) return;
    const rect = game.renderer.flush();
    if (rect) {
      offscreen.getContext('2d')?.putImageData(image, 0, 0, rect.x0, rect.y0, rect.x1 - rect.x0 + 1, rect.y1 - rect.y0 + 1);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height, dpr } = sizeRef.current;
    const view = viewRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#b9cdd0';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = view.scale < 1;
    ctx.drawImage(offscreen, view.ox, view.oy, MAP_WIDTH * view.scale, MAP_HEIGHT * view.scale);
    const cursor = cursorRef.current;
    if (cursor && toolRef.current === 'brush' && canPaintRef.current) {
      const radius = game.brushRadius * view.scale;
      ctx.beginPath();
      ctx.arc(cursor.x, cursor.y, radius, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(30,26,20,0.9)';
      ctx.stroke();
    }
  }, [game]);

  const requestDraw = useCallback(() => {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(draw);
  }, [draw]);

  const setView = useCallback(
    (view: View) => {
      viewRef.current = clampView(view);
      requestDraw();
    },
    [requestDraw],
  );

  const zoomAround = useCallback(
    (factor: number, sx: number, sy: number) => {
      const view = viewRef.current;
      const scale = Math.max(minScale(), Math.min(MAX_SCALE, view.scale * factor));
      const mx = (sx - view.ox) / view.scale;
      const my = (sy - view.oy) / view.scale;
      setView({ scale, ox: sx - mx * scale, oy: sy - my * scale });
    },
    [setView],
  );

  useImperativeHandle(
    ref,
    () => ({
      zoomBy: (factor: number) => zoomAround(factor, sizeRef.current.width / 2, sizeRef.current.height / 2),
      fit: () => setView({ scale: minScale(), ox: 0, oy: 0 }),
    }),
    [zoomAround, setView],
  );

  // Offscreen map image shares memory with the renderer's pixel buffer.
  useEffect(() => {
    const offscreen = document.createElement('canvas');
    offscreen.width = MAP_WIDTH;
    offscreen.height = MAP_HEIGHT;
    offscreenRef.current = offscreen;
    imageRef.current = new ImageData(new Uint8ClampedArray(game.renderer.pixels.buffer), MAP_WIDTH, MAP_HEIGHT);
    game.renderer.markAll();
    requestDraw();
    const off = game.onMapChange(requestDraw);
    return () => {
      off();
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [game, requestDraw]);

  useEffect(() => {
    requestDraw();
  }, [tool, canPaint, requestDraw]);

  // Canvas size follows its container.
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
      if (first) {
        first = false;
        // Start zoomed so the land fills the screen height on phones.
        const scale = Math.max(minScale(), height / MAP_HEIGHT);
        setView({ scale, ox: (width - MAP_WIDTH * scale) / 2, oy: 0 });
      } else {
        setView(viewRef.current);
      }
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [setView]);

  // Wheel zoom (desktop).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAround(Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoomAround]);

  const toMap = (sx: number, sy: number) => {
    const view = viewRef.current;
    return { x: (sx - view.ox) / view.scale, y: (sy - view.oy) / view.scale };
  };

  const localPoint = (event: React.PointerEvent) => {
    const rect = (event.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const pinchState = () => {
    const points = [...pointersRef.current.values()];
    const [a, b] = points;
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = localPoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, point);
    cursorRef.current = point;
    const gesture = gestureRef.current;
    if (pointersRef.current.size === 2) {
      if (gesture.kind === 'paint') game.endStroke();
      const { dist, mid } = pinchState();
      gestureRef.current = { ...gesture, kind: 'pinch', pinchDist: dist, pinchMid: mid, moved: true };
      return;
    }
    if (pointersRef.current.size > 2) return;
    const paint = toolRef.current === 'brush' && canPaintRef.current;
    gestureRef.current = { kind: paint ? 'paint' : 'pan', startX: point.x, startY: point.y, moved: false, pinchDist: 0, pinchMid: point };
    if (paint) {
      const m = toMap(point.x, point.y);
      game.beginStroke(m.x, m.y);
    }
    requestDraw();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = localPoint(event);
    cursorRef.current = point;
    const previous = pointersRef.current.get(event.pointerId);
    if (!previous) {
      requestDraw();
      return;
    }
    pointersRef.current.set(event.pointerId, point);
    const gesture = gestureRef.current;
    if (Math.hypot(point.x - gesture.startX, point.y - gesture.startY) > 6) gesture.moved = true;
    if (gesture.kind === 'pinch' && pointersRef.current.size >= 2) {
      const { dist, mid } = pinchState();
      const view = viewRef.current;
      const factor = gesture.pinchDist > 0 ? dist / gesture.pinchDist : 1;
      const scale = Math.max(minScale(), Math.min(MAX_SCALE, view.scale * factor));
      const mx = (gesture.pinchMid.x - view.ox) / view.scale;
      const my = (gesture.pinchMid.y - view.oy) / view.scale;
      setView({ scale, ox: mid.x - mx * scale, oy: mid.y - my * scale });
      gesture.pinchDist = dist;
      gesture.pinchMid = mid;
    } else if (gesture.kind === 'pan') {
      const view = viewRef.current;
      setView({ scale: view.scale, ox: view.ox + point.x - previous.x, oy: view.oy + point.y - previous.y });
    } else if (gesture.kind === 'paint') {
      const m = toMap(point.x, point.y);
      game.strokeTo(m.x, m.y);
    }
    requestDraw();
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(event.pointerId);
    const gesture = gestureRef.current;
    if (gesture.kind === 'paint') game.endStroke();
    if (gesture.kind === 'pan' && !gesture.moved && onInspect) {
      const m = toMap(gesture.startX, gesture.startY);
      onInspect(game.inspect(m.x, m.y));
    }
    if (pointersRef.current.size === 0) gestureRef.current = { ...gesture, kind: 'none' };
    else if (gesture.kind === 'pinch') gestureRef.current = { ...gesture, kind: 'pan', moved: true };
    if (event.pointerType !== 'mouse') cursorRef.current = null;
    requestDraw();
  };

  return (
    <div ref={wrapRef} className={className} style={{ overflow: 'hidden', touchAction: 'none' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', touchAction: 'none', cursor: tool === 'brush' && canPaint ? 'none' : 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse' && !pointersRef.current.has(event.pointerId)) {
            cursorRef.current = null;
            requestDraw();
          }
        }}
      />
    </div>
  );
});
