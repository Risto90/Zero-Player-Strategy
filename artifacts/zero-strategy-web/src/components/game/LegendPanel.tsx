import { ArrowLeft } from 'lucide-react';
import type { Game, GameSnapshot, LegendRow } from '@/game/game';
import { BIOME_NOTE } from '@/game/config';
import { RAMPS } from '@/game/render';
import { fmt, pct } from './format';

const VALUE_NOTE: Record<string, string> = {
  humidity: 'Влажность почвы и воздуха. Ливни поднимают, засуха снижает.',
  temperature: 'Средняя температура. От ледников до тропиков.',
  drainage: 'Как быстро уходит вода. Низкий дренаж заболачивает.',
  density: 'Плотность населения на освоенной земле.',
};
const VALUE_TITLE: Record<string, string> = { humidity: 'Влажность', temperature: 'Температура', drainage: 'Дренаж', density: 'Население' };

function Row({ row, unit, onClick, active }: { row: LegendRow; unit: string; onClick?: () => void; active?: boolean }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`group relative flex w-full items-center gap-2 border-b border-border/70 px-2 py-1.5 text-left ${onClick ? 'hover:bg-muted/70' : ''} ${active ? 'bg-muted' : ''}`}
      data-testid={`row-legend-${row.id}`}
    >
      <span className="absolute inset-y-0 left-0 opacity-15" style={{ width: `${Math.min(100, row.percent)}%`, background: row.color }} />
      <span className="relative h-3 w-3 shrink-0 rounded-[2px] border border-foreground/40" style={{ background: row.color }} />
      <span className="relative min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{row.name}</span>
        {row.detail && <span className="block truncate text-[11px] text-muted-foreground">{row.detail}</span>}
      </span>
      <span className="relative shrink-0 text-right">
        <span className="font-num block text-[12px] font-semibold">{pct(row.percent)}</span>
        <span className="font-num block text-[10px] text-muted-foreground">{fmt(row.value)} {unit}</span>
      </span>
    </Tag>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-3 py-4 font-display text-sm italic text-muted-foreground">{text}</p>;
}

export function LegendPanel({ game, snap }: { game: Game; snap: GameSnapshot }) {
  const { legend, mapMode, layer } = snap;
  let body;
  let title = '';
  let sub = '';
  if (mapMode === 'political') {
    title = 'Страны';
    sub = `${legend.countries.length} · население ${fmt(legend.totalPopulation)}`;
    body = legend.countries.length ? legend.countries.map((r) => <Row key={r.id} row={r} unit="чел." />) : <Empty text="Ни одного государства. Пока." />;
  } else if (mapMode === 'cultures' || mapMode === 'religions') {
    const kind = mapMode === 'cultures' ? 'culture' : 'religion';
    const rows = mapMode === 'cultures' ? legend.cultures : legend.religions;
    title = mapMode === 'cultures' ? 'Культуры' : 'Религии';
    const single = layer && layer.kind === kind ? rows.find((r) => r.id === layer.id) : null;
    sub = single ? `слой: ${single.name}` : 'нажмите строку — слой одной общности';
    body = (
      <>
        {layer && (
          <button onClick={() => game.showLayer(null)} className="sticky top-0 z-10 flex w-full items-center gap-1.5 border-b-2 border-primary bg-card px-2 py-1.5 text-[12.5px] font-semibold text-primary" data-testid="button-layer-back">
            <ArrowLeft className="h-4 w-4" /> Все {mapMode === 'cultures' ? 'культуры' : 'веры'} вместе
          </button>
        )}
        {rows.length === 0 && <Empty text="Пока никого." />}
        {rows.map((r) => (
          <Row key={r.id} row={r} unit="чел." active={layer?.id === r.id && layer.kind === kind} onClick={() => game.showLayer({ kind, id: r.id })} />
        ))}
        {mapMode === 'religions' && legend.totalPopulation > 0 && <Row row={legend.nonBelievers} unit="чел." />}
      </>
    );
  } else if (mapMode === 'biomes') {
    title = 'Биомы';
    sub = 'доля суши';
    body = (
      <>
        {legend.biomes.map((r) => <Row key={r.id} row={r} unit="земель" />)}
        <p className="px-2 py-2 text-[11px] leading-snug text-muted-foreground">{BIOME_NOTE}</p>
      </>
    );
  } else {
    const stops = RAMPS[mapMode];
    title = VALUE_TITLE[mapMode];
    sub = 'шкала 0–100';
    body = (
      <div className="px-3 py-3">
        <div className="h-4 rounded-[2px] border border-foreground/50" style={{ background: `linear-gradient(90deg, ${stops.join(', ')})` }} />
        <div className="font-num mt-1 flex justify-between text-[10px] text-muted-foreground">
          {[0, 25, 50, 75, 100].map((v) => <span key={v}>{v}</span>)}
        </div>
        <p className="mt-2 text-[12px] text-foreground/75">{VALUE_NOTE[mapMode]}</p>
        {mapMode === 'density' && <p className="mt-1 text-[12px] text-foreground/75">Всего: <span className="font-num">{fmt(legend.totalPopulation)}</span> чел.</p>}
      </div>
    );
  }
  return (
    <section className="flex min-h-0 flex-col" data-testid="panel-legend">
      <header className="flex items-baseline gap-2 px-2 pb-1 pt-2">
        <h3 className="font-display text-base font-bold">{title}</h3>
        <span className="truncate text-[11px] text-muted-foreground">{sub}</span>
      </header>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">{body}</div>
    </section>
  );
}
