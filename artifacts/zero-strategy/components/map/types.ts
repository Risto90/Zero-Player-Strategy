import type { Game, PixelInfo } from '@/game/game';

export type MapTool = 'brush' | 'hand' | 'city';

export interface MapViewHandle {
  zoomBy(factor: number): void;
  fit(): void;
  centerAtPixel(pixel: number): void;
}

export interface MapViewProps {
  game: Game;
  /** 'brush' paints with the active card (when it can be painted); 'hand' pans and inspects. */
  tool: MapTool;
  canPaint: boolean;
  avoidToolOverlay?: boolean;
  onInspect?: (info: PixelInfo | null) => void;
  onMapActivity?: () => void;
}

export interface ViewTransform {
  scale: number;
  ox: number;
  oy: number;
}

export const MAX_SCALE = 32;
/** Milliseconds of map repainting per frame; a full repaint is spread over several frames. */
export const PAINT_BUDGET_MS = 10;
