import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ChevronLeft } from 'lucide-react';
import { MapCanvas, type MapCanvasHandle, type MapTool } from '@/components/MapCanvas';
import { CardPanel } from '@/components/game/CardPanel';
import { MapControls } from '@/components/game/MapControls';
import { InspectCard } from '@/components/game/InspectCard';
import { ModeTabs } from '@/components/game/ModeTabs';
import { LegendPanel } from '@/components/game/LegendPanel';
import { LogPanel } from '@/components/game/LogPanel';
import { continueSavedGame, currentGame, leaveGame } from '@/game/session';
import { useGameSnapshot } from '@/game/useGame';
import type { Game, PixelInfo } from '@/game/game';

export function Loading({ text }: { text: string }) {
  return (
    <div className="grid min-h-[100dvh] place-items-center bg-background">
      <div className="text-center">
        <div className="mx-auto mb-4 h-14 w-14 animate-spin rounded-full border-2 border-foreground/20 border-t-primary [animation-duration:1.6s]" />
        <p className="font-display text-xl italic">{text}</p>
      </div>
    </div>
  );
}

export default function PlayPage() {
  const [, navigate] = useLocation();
  const [game, setGame] = useState<Game | null>(() => currentGame());
  useEffect(() => {
    let alive = true;
    if (!game) {
      void continueSavedGame().then((g) => {
        if (!alive) return;
        if (g) setGame(g);
        else navigate('/', { replace: true });
      });
    }
    return () => { alive = false; };
  }, [game, navigate]);
  useEffect(() => () => { void leaveGame(); }, []);
  if (!game) return <Loading text="Открываем атлас…" />;
  return <GameScreen game={game} />;
}

function GameScreen({ game }: { game: Game }) {
  const snap = useGameSnapshot(game);
  const mapRef = useRef<MapCanvasHandle>(null);
  const [tool, setTool] = useState<MapTool>('brush');
  const [inspect, setInspect] = useState<{ info: PixelInfo | null } | null>(null);
  const changeTool = (t: MapTool) => { setTool(t); if (t === 'brush') setInspect(null); };

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background md:flex-row">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 bg-secondary px-2 py-1 text-secondary-foreground md:hidden">
          <Link href="/" className="flex items-center gap-0.5 text-xs opacity-80" data-testid="link-home"><ChevronLeft className="h-4 w-4" />Меню</Link>
          <span className="ml-auto font-display text-sm italic">Zero Strategy</span>
        </div>
        <div className="md:hidden"><CardPanel game={game} snap={snap} /></div>
        <div className="relative min-h-0 flex-1">
          <MapCanvas
            ref={mapRef}
            game={game}
            tool={tool}
            canPaint={snap.canPaint}
            onInspect={(info) => setInspect({ info })}
            className="absolute inset-0"
          />
          <MapControls
            game={game}
            snap={snap}
            tool={tool}
            setTool={changeTool}
            onZoom={(f) => mapRef.current?.zoomBy(f)}
            onFit={() => mapRef.current?.fit()}
          />
          {tool === 'hand' && inspect && <InspectCard info={inspect.info} onClose={() => setInspect(null)} />}
          {tool === 'hand' && !inspect && (
            <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-sm bg-secondary/90 px-2.5 py-1 text-[11px] text-secondary-foreground">
              Коснитесь точки, чтобы её изучить
            </div>
          )}
        </div>
        <div className="md:hidden">
          <ModeTabs game={game} snap={snap} />
          <div className="flex h-[22dvh] min-h-0 flex-col bg-card"><LegendPanel game={game} snap={snap} /></div>
          <div className="h-[16dvh] border-t-2 border-foreground/80"><LogPanel log={snap.log} /></div>
        </div>
      </div>
      <aside className="hidden w-[380px] shrink-0 flex-col border-l-2 border-foreground/80 bg-card md:flex">
        <div className="flex items-center bg-secondary px-3 py-1.5 text-secondary-foreground">
          <Link href="/" className="flex items-center gap-0.5 text-xs opacity-80 hover:opacity-100" data-testid="link-home-desktop"><ChevronLeft className="h-4 w-4" />Меню</Link>
          <span className="ml-auto font-display italic">Zero Strategy</span>
        </div>
        <CardPanel game={game} snap={snap} />
        <ModeTabs game={game} snap={snap} />
        <div className="flex min-h-0 flex-1 flex-col"><LegendPanel game={game} snap={snap} /></div>
        <div className="h-[24dvh] border-t-2 border-foreground/80"><LogPanel log={snap.log} /></div>
      </aside>
    </div>
  );
}
