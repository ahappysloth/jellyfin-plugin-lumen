/**
 * The stylesheets of the stock pages' look (veil/skin.ts), linked where they're used. Its own module, apart from
 * skin.ts, which the core imports too: only the inline guard and the settings pages' frame need this (what the core and
 * the item menu need of them is in ./stockCss.ts).
 */
import { parseRoute } from '../takeover/routes';
import { isAdminRoute, isSignInRoute } from './skin';
import { CSS_ATTR, DASHBOARD_CSS, findLink, SKIN_WAIT_MS, STOCK_CSS } from './stockCss';

export { DASHBOARD_CSS, SKIN_WAIT_MS, STOCK_CSS };
/** On <html> while a restyled page waits for its stylesheet: base.css hides the page meanwhile (not the veil). */
export const SKIN_WAIT_CLASS = 'lmn-skin-wait';
/** Lumen's files, relative to jellyfin-web's page (as Injection/HtmlInjector.cs links lumen.css). */
const ASSETS = '../Lumen/Assets/';
/** Where jellyfin-web keeps the signed-in servers (its Credentials class, in jellyfin-apiclient). */
const CREDENTIALS_KEY = 'jellyfin_credentials';

/**
 * The page's wait for its stylesheets (SKIN_WAIT_CLASS): one deadline at a time, for the links not in yet. Leaving for
 * a page that doesn't wait ends it (stopWaiting), so coming back starts a new one rather than meet the old deadline. A
 * link that arrived, failed or ran out the clock is never waited for again (`settled`): its page shows as it is.
 */
let deadline = 0;
const waiting: HTMLLinkElement[] = [];
const settled = new WeakSet<HTMLLinkElement>();

function stopWaiting(doc: Document): void {
  clearTimeout(deadline);
  deadline = 0;
  waiting.length = 0;
  doc.documentElement.classList.remove(SKIN_WAIT_CLASS);
}

function settle(doc: Document, link: HTMLLinkElement): void {
  settled.add(link);
  const i = waiting.indexOf(link);
  if (i >= 0) waiting.splice(i, 1);
  if (!waiting.length) stopWaiting(doc);
}

/** Hides the page until `link` is in, or SKIN_WAIT_MS from the first stylesheet it waits for. */
function waitFor(doc: Document, link: HTMLLinkElement): void {
  if (link.sheet || settled.has(link)) return;
  if (!waiting.includes(link)) waiting.push(link);
  doc.documentElement.classList.add(SKIN_WAIT_CLASS);
  if (!deadline)
    deadline = window.setTimeout(() => {
      waiting.forEach((l) => settled.add(l));
      stopWaiting(doc);
    }, SKIN_WAIT_MS);
}

/**
 * Links one of the stock pages' stylesheets, once, with the build's version (a <meta> the server adds), so it's cached
 * for good like lumen.css. `now`: the page shows something it styles. While the inline guard runs as the page is parsed
 * (`parsing`, a cold load) it's written into the page, so the browser holds the first paint for it as it does for
 * lumen.css; later (after a navigation) the page is hidden until it's in (SKIN_WAIT_CLASS) rather than show unstyled.
 * Otherwise it downloads without holding anything up (media print until it's in, at a stylesheet's priority), for a
 * dialog or page that needs it.
 * Either way it goes before lumen.css, so lumen.css wins ties.
 */
export function linkSkinCss(doc: Document, name: string, now: boolean, parsing = false): void {
  const version = doc.querySelector<HTMLMetaElement>('meta[name="lumen-version"]')?.content;
  const href = ASSETS + name + (version ? '?v=' + version.replace(/[^\w.~%-]/g, '') : '');
  let link = findLink(doc, name);
  if (!link) {
    // Only from the guard's own script as the parser runs it: anywhere else (an event during the parse, a script run
    // later) document.write would replace the whole page.
    if (now && parsing && doc.readyState === 'loading' && doc.currentScript) {
      doc.write(`<link rel="stylesheet" ${CSS_ATTR}="${name}" href="${href}">`);
      return;
    }
    const created = (link = doc.createElement('link'));
    created.rel = 'stylesheet';
    created.setAttribute(CSS_ATTR, name);
    created.href = href;
    if (!now) {
      created.media = 'print';
      // A print stylesheet is otherwise fetched last of all, behind every image: on a slow network it came long after
      // Lumen's first page, so a dialog from the More menu or a settings page opened without it. High doesn't hold
      // Lumen's first page up (measured on Slow 3G), and Chromium can't raise a request already under way.
      created.setAttribute('fetchpriority', 'high');
    }
    // Listened to once, here, however many pages wait for it. (One written into the page is in, or failed, before any
    // navigation: a wait for one that failed runs out once.)
    created.onload = created.onerror = () => {
      created.media = 'all';
      settle(doc, created);
    };
    doc.head.insertBefore(created, doc.querySelector('link[href*="lumen.css"]'));
  }
  if (!now) return;
  link.media = 'all';
  waitFor(doc, link);
}

/** No one is signed in on this browser: jellyfin-web is about to send the visit to its sign-in page. */
function signedOut(): boolean {
  try {
    return !/"AccessToken":"/.test(localStorage.getItem(CREDENTIALS_KEY) ?? '');
  } catch {
    return false;
  }
}

/**
 * Links the stock pages' stylesheets the current route needs, while the server has the stock pages restyled
 * (`data-lmn-skin`). lumen-stock.css goes on every page (jellyfin-web's dialogs and menus open anywhere), in the way of
 * the first paint only on the pages it restyles; lumen-dashboard.css only once an admin page shows. `parsing`: the
 * guard's first run, from its own script as the page is parsed. A signed-out visit to Lumen's home lands on the sign-in
 * page, so on a cold load with no one signed in the sign-in page's stylesheet is part of the first paint too.
 */
export function applySkinCss(doc: Document, hash: string, parsing = false): void {
  const root = doc.documentElement;
  if (!root.hasAttribute('data-lmn-skin')) return;
  const admin = isAdminRoute(hash);
  const stock =
    admin || isSignInRoute(hash) || parseRoute(hash).kind === 'settings' || (parsing && signedOut());
  // Left a page before its stylesheet came: this one doesn't wait for it.
  if (!stock) stopWaiting(doc);
  linkSkinCss(doc, STOCK_CSS, stock, parsing);
  if (admin) linkSkinCss(doc, DASHBOARD_CSS, true, parsing);
}

/**
 * The settings pages' frame: links the stock pages' stylesheet if the inline guard didn't (a Content-Security-Policy
 * blocked it). When the guard did, it waits for it, so this leaves it be.
 */
export function ensureStockCss(doc: Document): void {
  if (!findLink(doc, STOCK_CSS)) linkSkinCss(doc, STOCK_CSS, true);
}
