export function LogPanel({ log }: { log: string[] }) {
  return (
    <section className="flex h-full min-h-0 flex-col bg-secondary text-secondary-foreground" data-testid="panel-log">
      <header className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-secondary-foreground/60">Летопись</header>
      <ol className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-2 pt-1">
        {log.length === 0 && <li className="font-display text-sm italic opacity-60">Страницы пока пусты.</li>}
        {log.map((line, i) => {
          const idx = line.indexOf(': ');
          const year = idx > 0 ? line.slice(0, idx) : '';
          const text = idx > 0 ? line.slice(idx + 2) : line;
          return (
            <li key={`${i}-${line}`} className={`flex gap-2 py-0.5 text-[12.5px] leading-snug ${i === 0 ? 'text-secondary-foreground' : 'text-secondary-foreground/70'}`} data-testid={`text-log-${i}`}>
              <span className="font-num shrink-0 text-[11px] text-primary brightness-150">{year}</span>
              <span>{text}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
