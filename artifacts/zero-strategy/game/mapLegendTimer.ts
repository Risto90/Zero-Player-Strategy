export const MAP_LEGEND_DURATION_MS = 5000;

export function scheduleMapLegend(
  setVisible: (visible: boolean) => void,
  timers: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'> = globalThis,
) {
  setVisible(true);
  const timer = timers.setTimeout(() => setVisible(false), MAP_LEGEND_DURATION_MS);
  return () => timers.clearTimeout(timer);
}
