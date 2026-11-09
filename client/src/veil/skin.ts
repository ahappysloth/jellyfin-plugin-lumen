/**
 * Lumen's look for jellyfin-web's signed-out pages (sign in, forgot password, server select). It's CSS only: an
 * `lmn-signin` class on <html> and the server name as a CSS string the stylesheet prints above the form, so nothing in
 * jellyfin-web's DOM is touched. Opt-in per server: the index.html injection sets `data-lmn-skin` when the admin
 * leaves "Restyle Jellyfin's sign-in, settings and Dashboard pages" on (it runs before anyone is signed in, so no client config).
 */
import { ADMIN_ROUTES } from '../compat/registry';
import { SIGN_IN_PATHS } from '../takeover/routes';
import { veilName } from './veil';

export const SIGN_IN_CLASS = 'lmn-signin';
/** The admin pages' look (styles/dashboard.css, its own stylesheet linked by Injection/HtmlInjector.cs). */
export const DASHBOARD_CLASS = 'lmn-skin-dashboard';
const NAME_PROPERTY = '--lmn-signin-name';

function hashPath(hash: string): string {
  const value = hash.replace(/^#!?/, '');
  const q = value.indexOf('?');
  return (q < 0 ? value : value.slice(0, q)).toLowerCase();
}

export function isSignInRoute(hash: string): boolean {
  return SIGN_IN_PATHS.includes(hashPath(hash));
}

/** Turns the sign-in look on or off for the current route. */
export function applySignInSkin(doc: Document, hash: string, serverName: string = veilName()): void {
  const root = doc.documentElement;
  const on = root.hasAttribute('data-lmn-skin') && isSignInRoute(hash);
  root.classList.toggle(SIGN_IN_CLASS, on);
  if (on) root.style.setProperty(NAME_PROPERTY, JSON.stringify(serverName));
  else root.style.removeProperty(NAME_PROPERTY);
}

/** The Dashboard, the metadata manager and plugin settings pages. */
export function isAdminRoute(hash: string): boolean {
  const path = hashPath(hash);
  return ADMIN_ROUTES.some((route) => path === route || path.startsWith(`${route}/`));
}

/**
 * Turns the admin pages' look on or off for the current route. Same opt-in as the sign-in look, and like it, set by the
 * inline guard so the first paint is already Lumen's; it needs no session and no compatibility check, because it's CSS
 * over jellyfin-web's own pages and only changes how they look.
 */
export function applyDashboardSkin(doc: Document, hash: string): void {
  const root = doc.documentElement;
  root.classList.toggle(DASHBOARD_CLASS, root.hasAttribute('data-lmn-skin') && isAdminRoute(hash));
}
