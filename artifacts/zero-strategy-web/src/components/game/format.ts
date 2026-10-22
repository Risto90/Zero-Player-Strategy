export const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');
export const pct = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString('ru-RU')}%`;
