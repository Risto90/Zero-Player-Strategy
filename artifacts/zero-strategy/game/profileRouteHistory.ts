const profileHistory: string[] = [];

export function rememberProfilePath(path: string): void {
  if (path === '/play' || path === '/') {
    profileHistory.length = 0;
    return;
  }
  if (!/^\/(country|city|culture|religion|race|person|dynasty)\/[^/]+\/?$/.test(path)) return;
  const existingIndex = profileHistory.indexOf(path);
  if (existingIndex >= 0) profileHistory.splice(existingIndex + 1);
  else profileHistory.push(path);
}

export function hasVisitedProfilePath(path: string): boolean {
  return profileHistory.includes(path);
}

export function clearProfileHistory(): void {
  profileHistory.length = 0;
}
