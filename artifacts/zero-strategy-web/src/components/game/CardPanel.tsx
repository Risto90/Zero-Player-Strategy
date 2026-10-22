import { Pause, Play, SkipForward } from 'lucide-react';
import type { Game, GameSnapshot } from '@/game/game';
import { fmt } from './format';

const ROLE_LABEL: Record<string, string> = {
  all: 'Весь мир',
  country: 'Одна страна',
  world: 'Мировые события',
  observer: 'Наблюдатель',
};

export function CardPanel({ game, snap }: { game: Game; snap: GameSnapshot }) {
  const card = snap.card;
  const inkShare = card && card.inkTotal > 0 ? card.ink / card.inkTotal : 0;
  const lastLabel = snap.queuedCards > 0 ? 'Следующая карта' : 'Следующий год';
  const message = snap.message && snap.message !== card?.detail ? snap.message : '';
  return (
    <section className="border-b-2 border-foreground/80 bg-card px-3 pb-2.5 pt-2" data-testid="panel-card">
      <div className="flex items-center gap-2">
        <div className="flex items-baseline gap-1.5">
          <span className="font-display text-2xl font-bold leading-none" data-testid="text-year">{snap.year}</span>
          <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">год</span>
        </div>
        <span className="truncate text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{ROLE_LABEL[snap.role]}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <span
            className={`font-num rounded-sm border border-border px-1.5 py-0.5 text-sm ${snap.paused ? 'ink-pulse text-primary' : ''} ${snap.secondsLeft <= 10 && !snap.paused ? 'text-primary' : ''}`}
            data-testid="text-timer"
          >
            {String(Math.max(0, snap.secondsLeft)).padStart(2, '0')}с
          </span>
          <button
            onClick={() => game.togglePause()}
            className="grid h-8 w-8 place-items-center rounded-sm border border-foreground/70 bg-background active:scale-95"
            aria-label={snap.paused ? 'Продолжить' : 'Пауза'}
            data-testid="button-pause"
          >
            {snap.paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </button>
          <button
            onClick={() => game.nextTurn()}
            disabled={snap.busy}
            className="seal flex h-8 items-center gap-1 rounded-sm bg-primary px-2.5 text-[13px] font-semibold text-primary-foreground active:translate-y-px disabled:opacity-60"
            data-testid="button-next"
          >
            <span className="hidden min-[380px]:inline">{card ? (snap.queuedCards > 0 ? 'Готово' : lastLabel) : 'Следующий год'}</span>
            <SkipForward className="h-4 w-4" />
          </button>
        </div>
      </div>

      {card ? (
        <div className="mt-2">
          <div className="flex items-center gap-2">
            {snap.cardCountry && (
              <span className="h-3 w-3 shrink-0 rounded-[2px] border border-foreground/50" style={{ background: snap.cardCountry.color }} />
            )}
            <h2 className="font-display truncate text-lg font-bold leading-tight" data-testid="text-card-title">{card.title}</h2>
            {snap.queuedCards > 0 && (
              <span className="ml-auto shrink-0 rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-secondary-foreground" data-testid="text-queued">
                ещё {snap.queuedCards}
              </span>
            )}
          </div>
          {snap.cardCountry && (
            <div className="text-xs text-muted-foreground" data-testid="text-card-country">{snap.cardCountry.rank} {snap.cardCountry.name}</div>
          )}
          <p className="mt-1 text-[13px] leading-snug text-foreground/80" data-testid="text-card-detail">{card.detail}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="hatch relative h-2 flex-1 overflow-hidden rounded-[2px] border border-foreground/40">
              <div className="absolute inset-y-0 left-0 bg-foreground transition-[width] duration-200" style={{ width: `${inkShare * 100}%` }} />
            </div>
            <span className="font-num shrink-0 text-[11px]" data-testid="text-ink">
              {fmt(card.ink)} / {fmt(card.inkTotal)}
            </span>
          </div>
        </div>
      ) : (
        <p className="mt-1.5 text-[13px] italic text-muted-foreground font-display">Карт нет. Мир идёт своим чередом.</p>
      )}
      {message && (
        <p className="mt-1.5 border-l-2 border-primary pl-2 text-[12.5px] leading-snug text-primary" data-testid="text-message">{message}</p>
      )}
    </section>
  );
}
