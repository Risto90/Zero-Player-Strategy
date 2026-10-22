/** Russian number formatting without relying on Intl: 12 345 and 4,5%. */
export function fmt(n: number): string {
  const value = Math.round(n);
  const digits = String(Math.abs(value));
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) groups.unshift(digits.slice(Math.max(0, end - 3), end));
  return `${value < 0 ? '−' : ''}${groups.join('\u00a0')}`;
}

export function pct(n: number): string {
  const tenths = Math.round(n * 10);
  const whole = Math.trunc(tenths / 10);
  const rest = Math.abs(tenths % 10);
  return `${fmt(whole)}${rest ? `,${rest}` : ''}%`;
}
