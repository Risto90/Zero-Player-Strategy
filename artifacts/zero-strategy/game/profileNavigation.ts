import { router, type Href } from 'expo-router';
import { clearProfileHistory, hasVisitedProfilePath, rememberProfilePath } from './profileRouteHistory';

function routePath(href: Href): string | null {
  if (typeof href === 'string') return href.split(/[?#]/, 1)[0] ?? null;
  const pathname = href.pathname;
  const params = href.params ?? {};
  return pathname.replace(/\[([^\]]+)\]/g, (_match, key: string) => {
    const value = params[key];
    return value === undefined ? '' : encodeURIComponent(String(value));
  });
}

export { rememberProfilePath };

/** Открывает уже посещённую карточку как переход назад, не наращивая цепочку ссылок. */
export function openProfile(href: Href): void {
  const path = routePath(href);
  if (path && hasVisitedProfilePath(path)) router.dismissTo(href);
  else router.push(href);
}

export function closeProfileToMap(): void {
  clearProfileHistory();
  router.replace('/play');
}
