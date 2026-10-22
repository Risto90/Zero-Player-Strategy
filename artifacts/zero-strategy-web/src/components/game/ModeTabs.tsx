import type { Game, GameSnapshot } from '@/game/game';
import type { MapMode } from '@/game/render';

export const MODES: { id: MapMode; label: string }[] = [
  { id: 'political', label: 'Страны' },
  { id: 'biomes', label: 'Биомы' },
  { id: 'cultures', label: 'Культуры' },
  { id: 'religions', label: 'Религии' },
  { id: 'humidity', label: 'Влажность' },
  { id: 'temperature', label: 'Температура' },
  { id: 'drainage', label: 'Дренаж' },
  { id: 'density', label: 'Население' },
];

export function ModeTabs({ game, snap }: { game: Game; snap: GameSnapshot }) {
  return (
    <nav className="no-scrollbar flex gap-1 overflow-x-auto border-y-2 border-foreground/80 bg-secondary px-1.5 py-1.5" data-testid="nav-modes">
      {MODES.map((m) => {
        const active = snap.mapMode === m.id;
        return (
          <button
            key={m.id}
            onClick={() => game.setMapMode(m.id)}
            className={`shrink-0 rounded-sm px-2.5 py-1 text-[12.5px] font-medium transition-colors ${active ? 'bg-primary text-primary-foreground' : 'text-secondary-foreground/75 hover:text-secondary-foreground'}`}
            data-testid={`button-mode-${m.id}`}
          >
            {m.label}
          </button>
        );
      })}
    </nav>
  );
}
