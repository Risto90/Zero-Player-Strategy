export function nomadProfileRoute(id: number) {
  return {
    pathname: '/country/[id]' as const,
    params: { id: String(id), type: 'nomad' as const },
  };
}

export function countryProfileRoute(id: number) {
  return { pathname: '/country/[id]' as const, params: { id: String(id) } };
}

export function cityProfileRoute(id: number) {
  return { pathname: '/city/[id]' as const, params: { id: String(id) } };
}

export function cultureProfileRoute(id: number) {
  return { pathname: '/culture/[id]' as const, params: { id: String(id) } };
}

export function religionProfileRoute(id: number) {
  return { pathname: '/religion/[id]' as const, params: { id: String(id) } };
}
