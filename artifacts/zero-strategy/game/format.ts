/** Форматирует числа по русским правилам без зависимости от Intl: 12 345 и 4,5%. */
export function fmt(n: number): string {
  const value = Math.round(n);
  const digits = String(Math.abs(value));
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) groups.unshift(digits.slice(Math.max(0, end - 3), end));
  return `${value < 0 ? '−' : ''}${groups.join('\u00a0')}`;
}

/** Форматирует дробную плотность в людях на км², сохраняя до шести знаков после запятой. */
export function fmtDensity(n: number): string {
  const value = Math.round(n * 1_000_000) / 1_000_000;
  const [whole, decimals = ''] = Math.abs(value).toFixed(6).split('.');
  const groups: string[] = [];
  for (let end = whole.length; end > 0; end -= 3) {
    groups.unshift(whole.slice(Math.max(0, end - 3), end));
  }
  const fraction = decimals.replace(/0+$/u, '');
  return `${value < 0 ? '−' : ''}${groups.join('\u00a0')}${fraction ? `,${fraction}` : ''}`;
}

export function pct(n: number): string {
  const tenths = Math.round(n * 10);
  const whole = Math.trunc(tenths / 10);
  const rest = Math.abs(tenths % 10);
  return `${fmt(whole)}${rest ? `,${rest}` : ''}%`;
}
