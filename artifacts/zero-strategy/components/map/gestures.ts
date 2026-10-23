import type { Game, PixelInfo } from '@/game/game';
import type { MapTool, ViewTransform } from './types';
import { toMap, zoomAround, clampView } from './viewMath';

interface Point {
  x: number;
  y: number;
}

export interface GestureHost {
  game: Game;
  getView(): ViewTransform;
  setView(view: ViewTransform): void;
  size(): { width: number; height: number };
  tool(): MapTool;
  canPaint(): boolean;
  onInspect(info: PixelInfo | null): void;
  /** Brush cursor in screen coordinates, or null to hide it. */
  setCursor(point: Point | null): void;
}

type Kind = 'none' | 'paint' | 'pan' | 'pinch';

/**
 * One finger paints (brush) or pans; the city tool places a city on tap.
 * A short tap with the hand tool inspects the point. Shared by the phone and web map views.
 */
export class MapGestures {
  private readonly points = new Map<number, Point>();
  private kind: Kind = 'none';
  private start: Point = { x: 0, y: 0 };
  private moved = false;
  private pinchDist = 0;
  private pinchMid: Point = { x: 0, y: 0 };

  constructor(private readonly host: GestureHost) {}

  /** Syncs with the full list of touches currently on the map. */
  sync(touches: { id: number; x: number; y: number }[]): void {
    const seen = new Set<number>();
    for (const t of touches) {
      seen.add(t.id);
      if (this.points.has(t.id)) this.move(t.id, t.x, t.y);
      else this.down(t.id, t.x, t.y);
    }
    for (const id of [...this.points.keys()]) if (!seen.has(id)) this.up(id);
  }

  releaseAll(): void {
    for (const id of [...this.points.keys()]) this.up(id);
  }

  private pinchState(): { dist: number; mid: Point } {
    const [a, b] = [...this.points.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }

  down(id: number, x: number, y: number): void {
    const host = this.host;
    this.points.set(id, { x, y });
    if (this.points.size === 2) {
      if (this.kind === 'paint') host.game.endStroke();
      const { dist, mid } = this.pinchState();
      this.kind = 'pinch';
      this.pinchDist = dist;
      this.pinchMid = mid;
      this.moved = true;
      host.setCursor(null);
      return;
    }
    if (this.points.size > 2) return;
    const paint = host.tool() === 'brush' && host.canPaint() && !host.game.getSnapshot().busy;
    this.kind = paint ? 'paint' : 'pan';
    this.start = { x, y };
    this.moved = false;
    if (paint) {
      host.setCursor({ x, y });
      const m = toMap(host.getView(), x, y);
      host.game.beginStroke(m.x, m.y);
    }
  }

  move(id: number, x: number, y: number): void {
    const host = this.host;
    const previous = this.points.get(id);
    if (!previous) return;
    if (previous.x === x && previous.y === y) return;
    this.points.set(id, { x, y });
    if (Math.hypot(x - this.start.x, y - this.start.y) > 6) this.moved = true;
    const { width, height } = host.size();
    if (this.kind === 'pinch' && this.points.size >= 2) {
      const { dist, mid } = this.pinchState();
      const view = host.getView();
      const factor = this.pinchDist > 0 ? dist / this.pinchDist : 1;
      // Zoom around the old midpoint, then follow the midpoint as it moves.
      const zoomed = zoomAround(view, factor, this.pinchMid.x, this.pinchMid.y, width, height);
      host.setView(clampView({ ...zoomed, ox: zoomed.ox + mid.x - this.pinchMid.x, oy: zoomed.oy + mid.y - this.pinchMid.y }, width, height));
      this.pinchDist = dist;
      this.pinchMid = mid;
    } else if (this.kind === 'pan') {
      const view = host.getView();
      host.setView(clampView({ scale: view.scale, ox: view.ox + x - previous.x, oy: view.oy + y - previous.y }, width, height));
    } else if (this.kind === 'paint') {
      host.setCursor({ x, y });
      const m = toMap(host.getView(), x, y);
      host.game.strokeTo(m.x, m.y);
    }
  }

  up(id: number): void {
    const host = this.host;
    if (!this.points.has(id)) return;
    this.points.delete(id);
    if (this.kind === 'paint') {
      host.game.endStroke();
      host.setCursor(null);
    }
    if (this.kind === 'pan' && !this.moved) {
      const m = toMap(host.getView(), this.start.x, this.start.y);
      if (host.tool() === 'city') host.game.selectCityAt(m.x, m.y);
      else if (host.tool() === 'hand') host.onInspect(host.game.inspect(m.x, m.y));
    }
    if (this.points.size === 0) this.kind = 'none';
    else if (this.kind === 'pinch') {
      // One finger left after a pinch: keep panning, never paint by accident.
      this.kind = 'pan';
      this.moved = true;
    } else if (this.kind === 'paint') this.kind = 'none';
  }
}
