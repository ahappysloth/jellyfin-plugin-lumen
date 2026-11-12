/**
 * The stylesheets of the stock pages' look (veil/skin.ts), linked where they're used. Its own module, apart from
 * skin.ts, which the core imports too: only the inline guard and the settings pages' frame need this.
 */
import { parseRoute } from '../takeover/routes';
import { isAdminRoute, isSignInRoute } from './skin';

/**
 * The stock pages' stylesheets (vite.styles.config.ts), linked where they're used rather than in lumen.css or on every
 * page: jellyfin-web's sign-in, settings and admin pages' controls and its dialogs and menus (styles/stock.css), and
 * the admin pages' own look (styles/dashboard.css).
 */
export const STOCK_CSS = 'lumen-stock.css';
export const DASHBOARD_CSS = 'lumen-dashboard.css';
/** On <html> while a restyled page waits for its stylesheet: base.css hides the page meanwhile (not the veil). */
export const SKIN_WAIT_CLASS = 'lmn-skin-wait';
/** How long a page waits for its stylesheet before it shows anyway. */
export const SKIN_WAIT_MS = 3000;
/** Lumen's files, relative to jellyfin-web's page (as Injection/HtmlInjector.cs links lumen.css). */
const ASSETS = '../Lumen/Assets/';
const CSS_ATTR = 'data-lmn-css';

/**
 * Links one of the stock pages' stylesheets, once, with the build's version (a <meta> the server adds), so it's cached
 * for good like lumen.css. `now`: the page shows something it styles. While the page is still being parsed (the inline
 * guard on a cold load) it's written into the page, so the browser holds the first paint for it as it does for
 * lumen.css; later (after a navigation) the page is hidden until it's in (SKIN_WAIT_CLASS) rather than show unstyled.
 * Otherwise it downloads without holding anything up (media print until it's in), for a dialog or page that needs it.
 * Either way it goes before lumen.css, so lumen.css wins ties.
 */
export function linkSkinCss(doc: Document, name: string, now: boolean): void {
  const version = doc.querySelector<HTMLMetaElement>('meta[name="lumen-version"]')?.content;
  const href = ASSETS + name + (version ? '?v=' + version.replace(/[^\w.~%-]/g, '') : '');
  let link = doc.querySelector<HTMLLinkElement>(`link[${CSS_ATTR}="${name}"]`);
  if (!link) {
    if (now && doc.readyState === 'loading') {
      doc.write(`<link rel="stylesheet" ${CSS_ATTR}="${name}" href="${href}">`);
      return;
    }
    const created = (link = doc.createElement('link'));
    created.rel = 'stylesheet';
    created.setAttribute(CSS_ATTR, name);
    created.href = href;
    if (!now) {
      created.media = 'print';
      created.onload = () => (created.media = 'all');
    }
    doc.head.insertBefore(created, doc.querySelector('link[href*="lumen.css"]'));
  }
  if (!now) return;
  link.media = 'all';
  if (link.sheet) return;
  const root = doc.documentElement;
  const done = (): void => root.classList.remove(SKIN_WAIT_CLASS);
  root.classList.add(SKIN_WAIT_CLASS);
  link.addEventListener('load', done);
  link.addEventListener('error', done);
  setTimeout(done, SKIN_WAIT_MS);
}

/**
 * Links the stock pages' stylesheets the current route needs, while the server has the stock pages restyled
 * (`data-lmn-skin`). lumen-stock.css goes on every page (jellyfin-web's dialogs and menus open anywhere), in the way of
 * the first paint only on the pages it restyles; lumen-dashboard.css only once an admin page shows.
 */
export function applySkinCss(doc: Document, hash: string): void {
  const root = doc.documentElement;
  if (!root.hasAttribute('data-lmn-skin')) return;
  const admin = isAdminRoute(hash);
  const stock = admin || isSignInRoute(hash) || parseRoute(hash).kind === 'settings';
  // Left a page before its stylesheet came: this one doesn't wait for it.
  if (!stock) root.classList.remove(SKIN_WAIT_CLASS);
  linkSkinCss(doc, STOCK_CSS, stock);
  if (admin) linkSkinCss(doc, DASHBOARD_CSS, true);
}
