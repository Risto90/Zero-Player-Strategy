export function countryProfileRoute(id: number) {
  return { pathname: '/country/[id]' as const, params: { id: String(id) } };
}

export function countryCandidatesRoute(id: number) {
  return { pathname: '/country/[id]/candidates' as const, params: { id: String(id) } };
}

export function countryRulersRoute(id: number) {
  return { pathname: '/country/[id]/rulers' as const, params: { id: String(id) } };
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
