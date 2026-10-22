import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowRight, Trash2 } from 'lucide-react';
import { deleteSavedGame, hasSavedGame, startNewGame } from '@/game/session';
import type { PlayerRole } from '@/game/game';
import { Loading } from './Play';

type MapKind = 'world' | 'random';
const MAPS: { id: MapKind; title: string; note: string }[] = [
  { id: 'world', title: 'Реальная Земля', note: 'Знакомые берега, чистая история' },
  { id: 'random', title: 'Новый мир', note: 'Материки, которых никто не видел' },
];
const ROLES: { id: PlayerRole; title: string; note: string }[] = [
  { id: 'all', title: 'Весь мир и все страны', note: 'Каждый год — мировая карта и карта каждой страны. Вы рисуете всё.' },
  { id: 'country', title: 'Одна страна', note: 'Вы — первое основанное государство. Остальных ведёт ИИ.' },
  { id: 'world', title: 'Только мировые события', note: 'Засухи, ливни, веры и народы. Страны живут сами.' },
  { id: 'observer', title: 'Наблюдатель', note: 'ИИ играет всё, годы идут сами. Смотрите.' },
];

export default function HomePage() {
  const [, navigate] = useLocation();
  const [hasSave, setHasSave] = useState<boolean | null>(null);
  const [map, setMap] = useState<MapKind>('world');
  const [role, setRole] = useState<PlayerRole>('all');
  const [starting, setStarting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => { void hasSavedGame().then(setHasSave); }, []);

  const start = () => {
    setStarting(true);
    requestAnimationFrame(() => setTimeout(() => { startNewGame(map, role); navigate('/play'); }, 30));
  };
  const remove = async () => { await deleteSavedGame(); setConfirmDelete(false); setHasSave(false); };

  if (starting) return <Loading text="Мир сотворяется…" />;

  return (
    <main className="mx-auto min-h-[100dvh] max-w-xl px-5 pb-12 pt-[max(2rem,env(safe-area-inset-top))]">
      <header className="rise">
        <div className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          <span className="h-px flex-1 bg-foreground/40" /> Атлас без полководцев <span className="h-px flex-1 bg-foreground/40" />
        </div>
        <h1 className="mt-4 font-display text-[3.6rem] font-bold leading-[0.9] tracking-tight">
          Zero<br /><span className="italic font-normal text-primary">Strategy</span>
        </h1>
        <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-foreground/80">
          Вы не командуете армиями. Каждый год вам выпадают карты — основать державу, расколоть её, наслать засуху, зажечь новую веру — и вы рисуете их кистью по карте мира. Остальное дорисует история.
        </p>
      </header>

      {hasSave && (
        <section className="rise mt-8 [animation-delay:80ms]">
          <button onClick={() => navigate('/play')} className="seal group flex w-full items-center justify-between rounded-sm bg-primary px-4 py-4 text-left text-primary-foreground" data-testid="button-continue">
            <span>
              <span className="block font-display text-xl font-bold">Продолжить летопись</span>
              <span className="block text-xs opacity-80">Сохранено на этом устройстве</span>
            </span>
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
          </button>
          {!confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)} className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive" data-testid="button-delete-save">
              <Trash2 className="h-3.5 w-3.5" /> Удалить сохранение
            </button>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-sm border border-destructive/60 bg-destructive/5 p-2.5 text-xs">
              <span className="flex-1">Стереть этот мир навсегда?</span>
              <button onClick={() => void remove()} className="rounded-sm bg-destructive px-3 py-1.5 font-semibold text-destructive-foreground" data-testid="button-confirm-delete">Удалить</button>
              <button onClick={() => setConfirmDelete(false)} className="rounded-sm border border-border px-3 py-1.5" data-testid="button-cancel-delete">Отмена</button>
            </div>
          )}
        </section>
      )}

      <section className="rise mt-10 [animation-delay:140ms]">
        <h2 className="flex items-baseline gap-2 font-display text-2xl font-bold"><span className="font-num text-sm text-primary">I</span> Карта</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {MAPS.map((m) => (
            <button key={m.id} onClick={() => setMap(m.id)} className={`rounded-sm border-2 p-3 text-left transition-colors ${map === m.id ? 'border-foreground bg-foreground text-background' : 'border-border bg-card hover:border-foreground/50'}`} data-testid={`button-map-${m.id}`}>
              <span className="block font-display text-lg font-bold leading-tight">{m.title}</span>
              <span className="mt-1 block text-[12px] opacity-75">{m.note}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="rise mt-8 [animation-delay:200ms]">
        <h2 className="flex items-baseline gap-2 font-display text-2xl font-bold"><span className="font-num text-sm text-primary">II</span> Роль</h2>
        <div className="mt-3 divide-y divide-border overflow-hidden rounded-sm border-2 border-border bg-card">
          {ROLES.map((r) => {
            const on = role === r.id;
            return (
              <button key={r.id} onClick={() => setRole(r.id)} className={`flex w-full items-start gap-3 px-3 py-3 text-left ${on ? 'bg-muted' : 'hover:bg-muted/50'}`} data-testid={`button-role-${r.id}`}>
                <span className={`mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 ${on ? 'border-primary' : 'border-foreground/40'}`}>
                  {on && <span className="h-2 w-2 rounded-full bg-primary" />}
                </span>
                <span>
                  <span className="block text-[15px] font-semibold">{r.title}</span>
                  <span className="block text-[12.5px] text-muted-foreground">{r.note}</span>
                </span>
              </button>
            );
          })}
        </div>
        <button onClick={start} className="seal mt-5 flex w-full items-center justify-center gap-2 rounded-sm bg-primary py-4 font-display text-xl font-bold text-primary-foreground active:translate-y-px" data-testid="button-start">
          Сотворить мир <ArrowRight className="h-5 w-5" />
        </button>
        {hasSave && <p className="mt-2 text-center text-[11px] text-muted-foreground">Новый мир заменит текущее сохранение.</p>}
      </section>

      <section className="rise mt-12 border-t-2 border-foreground/80 pt-4 [animation-delay:260ms]">
        <h2 className="font-display text-lg font-bold">Поставить на телефон</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-foreground/75">
          Игра работает без интернета. В Android Chrome откройте меню (три точки справа вверху) и выберите «Установить приложение» или «Добавить на главный экран». На iPhone в Safari: «Поделиться» → «На экран Домой».
        </p>
      </section>
    </main>
  );
}
