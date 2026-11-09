/**
 * Lumen's look for jellyfin-web's signed-out pages (sign in, forgot password, server select). It's CSS only: an
 * `lmn-signin` class on <html> and the server name as a CSS string the stylesheet prints above the form, so nothing in
 * jellyfin-web's DOM is touched. Opt-in per server: the index.html injection sets `data-lmn-skin` when the admin
 * leaves "Restyle Jellyfin's sign-in and settings pages" on (it runs before anyone is signed in, so no client config).
 */
import { SIGN_IN_PATHS } from '../takeover/routes';
import { veilName } from './veil';

export const SIGN_IN_CLASS = 'lmn-signin';
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
