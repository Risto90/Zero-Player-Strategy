import { Brush, Hand, Maximize, Minus, Plus, Repeat, Repeat1 } from 'lucide-react';
import type { MapTool } from '@/components/MapCanvas';
import type { Game, GameSnapshot } from '@/game/game';
import { BRUSH_SIZES } from '@/game/config';

const btn = 'grid h-10 w-10 place-items-center rounded-sm border border-foreground/70 bg-card/95 shadow-md active:scale-95 transition-transform';

export function MapControls({
  game, snap, tool, setTool, onZoom, onFit,
}: { game: Game; snap: GameSnapshot; tool: MapTool; setTool: (t: MapTool) => void; onZoom: (f: number) => void; onFit: () => void }) {
  const optionLabel =
    snap.brushOption === 'density'
      ? snap.brushMode === 'repeat' ? 'Повтор: +население на своей земле' : 'Каждая точка — один раз'
      : snap.brushMode === 'repeat' ? 'Каждый мазок действует снова' : 'Каждая точка — один раз';
  return (
    <>
      <div className="pointer-events-none absolute left-2 top-2 flex flex-col items-start gap-1.5">
        <div className="pointer-events-auto flex overflow-hidden rounded-sm border border-foreground/70 bg-card/95 shadow-md">
          <button
            onClick={() => setTool('brush')}
            className={`flex h-10 items-center gap-1 px-2.5 text-xs font-semibold ${tool === 'brush' ? 'bg-foreground text-background' : ''}`}
            data-testid="button-tool-brush"
          >
            <Brush className="h-4 w-4" /> Кисть
          </button>
          <button
            onClick={() => setTool('hand')}
            className={`flex h-10 items-center gap-1 border-l border-foreground/70 px-2.5 text-xs font-semibold ${tool === 'hand' ? 'bg-foreground text-background' : ''}`}
            data-testid="button-tool-hand"
          >
            <Hand className="h-4 w-4" /> Рука
          </button>
        </div>
        {tool === 'brush' && (
          <div className="pointer-events-auto flex overflow-hidden rounded-sm border border-foreground/70 bg-card/95 shadow-md">
            {BRUSH_SIZES.map((s, i) => (
              <button
                key={s.id}
                onClick={() => game.setBrushSize(s.id)}
                className={`font-num h-9 w-9 text-xs font-semibold ${i ? 'border-l border-foreground/70' : ''} ${snap.brushSize === s.id ? 'bg-primary text-primary-foreground' : ''}`}
                data-testid={`button-size-${s.id}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
        {tool === 'brush' && snap.brushOption !== null && (
          <button
            onClick={() => game.toggleBrushMode()}
            className={`pointer-events-auto flex max-w-[190px] items-center gap-1.5 rounded-sm border border-foreground/70 px-2 py-1.5 text-left text-[11px] font-medium leading-tight shadow-md ${snap.brushMode === 'repeat' ? 'bg-accent text-accent-foreground' : 'bg-card/95'}`}
            data-testid="button-brush-mode"
          >
            {snap.brushMode === 'repeat' ? <Repeat className="h-4 w-4 shrink-0" /> : <Repeat1 className="h-4 w-4 shrink-0" />}
            {optionLabel}
          </button>
        )}
        {tool === 'brush' && !snap.canPaint && (
          <span className="rounded-sm bg-secondary/90 px-2 py-1 text-[11px] text-secondary-foreground">Рисовать нечем — сдвигайте карту</span>
        )}
      </div>
      <div className="absolute right-2 top-2 flex flex-col gap-1.5">
        <button className={btn} onClick={() => onZoom(1.5)} aria-label="Приблизить" data-testid="button-zoom-in"><Plus className="h-4 w-4" /></button>
        <button className={btn} onClick={() => onZoom(1 / 1.5)} aria-label="Отдалить" data-testid="button-zoom-out"><Minus className="h-4 w-4" /></button>
        <button className={btn} onClick={onFit} aria-label="Весь мир" data-testid="button-zoom-fit"><Maximize className="h-4 w-4" /></button>
      </div>
    </>
  );
}
