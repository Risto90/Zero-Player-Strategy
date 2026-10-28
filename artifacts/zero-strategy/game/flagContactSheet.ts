import { renderFlagSpec } from './flagRenderer';
import { validateFlagSpec, type FlagSpec } from './flagSpec';

export interface FlagContactSheetOptions {
  title?: string;
  columns?: number;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function inlineImage(spec: FlagSpec, index: number): string {
  const svg = renderFlagSpec(spec);
  const image = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const caption = `${spec.profile_id} · ${String(spec.seed)}`;
  const alt = `Флаг ${index + 1}: ${caption}`;
  return `<figure><img src="${image}" alt="${escapeHtml(alt)}" style="aspect-ratio:${spec.outline.aspect} / 1"><figcaption><strong>${escapeHtml(spec.profile_id)}</strong><span>начальное значение: ${escapeHtml(String(spec.seed))}</span><span>эра: ${spec.era}</span></figcaption></figure>`;
}

/** Создаёт автономный HTML-контактный лист из переданных спецификаций флагов. */
export function renderFlagContactSheet(
  specs: readonly FlagSpec[],
  options: FlagContactSheetOptions = {},
): string {
  if (!Array.isArray(specs) || specs.length === 0) {
    throw new RangeError('Для контактного листа нужен непустой список флагов.');
  }
  const columns = options.columns ?? 4;
  if (!Number.isSafeInteger(columns) || columns < 1 || columns > 12) {
    throw new RangeError('Число колонок должно быть целым от 1 до 12.');
  }
  specs.forEach((spec, index) => {
    const issues = validateFlagSpec(spec);
    if (issues.length) {
      throw new TypeError(`Флаг ${index + 1} не соответствует FlagSpec: ${issues.map(({ path }) => path).join(', ')}`);
    }
  });

  const title = options.title ?? 'Контактный лист флагов';
  const cells = specs.map(inlineImage).join('\n');
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:24px;background:#f1f2f4;color:#1c2430;font:14px/1.4 system-ui,sans-serif}
header{margin:0 auto 20px;max-width:1600px;display:flex;justify-content:space-between;gap:16px;align-items:baseline}
h1{font-size:20px;margin:0}header span{color:#657080}
main{max-width:1600px;margin:auto;display:grid;grid-template-columns:repeat(${columns},minmax(0,1fr));gap:12px}
figure{min-width:0;margin:0;padding:10px;background:#fff;border:1px solid #dce0e5;border-radius:8px;break-inside:avoid}
img{display:block;width:100%;height:auto;object-fit:contain;background:#f9fafb}
figcaption{display:grid;grid-template-columns:1fr auto;gap:2px 8px;margin-top:8px;font-size:12px}
figcaption strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}figcaption span{color:#657080}
figcaption span:last-child{grid-column:1/-1}
@media(max-width:900px){main{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:600px){body{padding:12px}main{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}}
@media print{body{padding:0;background:#fff}header{padding:8px 0}main{gap:6px}figure{padding:5px;border-color:#bbb}}
</style>
</head>
<body>
<header><h1>${escapeHtml(title)}</h1><span>${specs.length} флагов · профилей: ${new Set(specs.map(({ profile_id }) => profile_id)).size}</span></header>
<main>
${cells}
</main>
</body>
</html>`;
}
