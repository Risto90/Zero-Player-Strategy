import { X } from 'lucide-react';
import type { PixelInfo } from '@/game/game';
import { MAX_DENSITY } from '@/game/config';

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-[74px] shrink-0 text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-[1px] bg-muted"><div className="h-full bg-foreground/80" style={{ width: `${value}%` }} /></div>
      <span className="font-num w-7 text-right">{value}</span>
    </div>
  );
}

function Shares({ title, rows, extra }: { title: string; rows: { id: number; name: string; color: string; share: number }[]; extra?: { name: string; share: number } }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</div>
      <div className="mb-1 flex h-2 overflow-hidden rounded-[1px] bg-muted">
        {rows.map((r) => <div key={r.id} style={{ width: `${r.share}%`, background: r.color }} />)}
      </div>
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-1.5 text-[12px]">
          <span className="h-2.5 w-2.5 shrink-0 rounded-[1px]" style={{ background: r.color }} />
          <span className="truncate">{r.name}</span>
          <span className="font-num ml-auto">{r.share}%</span>
        </div>
      ))}
      {extra && (
        <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <span className="h-2.5 w-2.5 shrink-0 rounded-[1px] border border-foreground/30" />
          <span>{extra.name}</span>
          <span className="font-num ml-auto">{extra.share}%</span>
        </div>
      )}
    </div>
  );
}

export function InspectCard({ info, onClose }: { info: PixelInfo | null; onClose: () => void }) {
  return (
    <div className="rise absolute inset-x-2 bottom-2 max-h-[70%] overflow-y-auto scroll-thin rounded-sm border-2 border-foreground/80 bg-card/97 p-3 shadow-xl md:left-auto md:w-80" data-testid="panel-inspect">
      <button onClick={onClose} className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-sm hover:bg-muted" aria-label="Закрыть" data-testid="button-close-inspect">
        <X className="h-4 w-4" />
      </button>
      {!info ? (
        <p className="text-sm text-muted-foreground">За краем карты.</p>
      ) : !info.land ? (
        <div>
          <div className="font-display text-lg font-bold">Море</div>
          <div className="font-num text-[11px] text-muted-foreground">x {info.x} · y {info.y}</div>
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="pr-8">
            <div className="flex items-center gap-2">
              {info.country && <span className="h-3 w-3 rounded-[2px] border border-foreground/50" style={{ background: info.country.color }} />}
              <span className="font-display text-lg font-bold leading-tight" data-testid="text-inspect-country">
                {info.country ? info.country.name : 'Ничья земля'}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {info.country ? `${info.country.rank} · ` : ''}{info.biome} · <span className="font-num">x {info.x}, y {info.y}</span>
            </div>
          </div>
          <div className="space-y-1">
            <Bar label="Влажность" value={info.humidity} />
            <Bar label="Температура" value={info.temperature} />
            <Bar label="Дренаж" value={info.drainage} />
            <Bar label="Население" value={Math.round((info.density / MAX_DENSITY) * 100)} />
            <div className="text-right text-[10px] text-muted-foreground">плотность <span className="font-num">{info.density}</span> из {MAX_DENSITY}</div>
          </div>
          {info.country ? (
            <>
              <Shares title="Народы" rows={info.cultures} />
              <Shares title="Веры" rows={info.religions} extra={{ name: 'Без веры', share: info.nonBelievers }} />
            </>
          ) : (
            <p className="text-xs italic text-muted-foreground">Здесь никто не живёт.</p>
          )}
        </div>
      )}
    </div>
  );
}
