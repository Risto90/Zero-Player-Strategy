export function nomadProfileRoute(id: number) {
  return {
    pathname: '/country/[id]' as const,
    params: { id: String(id), type: 'nomad' as const },
  };
}
