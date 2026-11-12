import { getApiClient } from '../compat/jellyfin';
import { QUICK_CONNECT, STOCK_SELECTORS } from '../compat/registry';
import { loadQuickConnect } from '../views/quickconnect/lazyQuickConnect';
import type { SignInDeps } from '../views/quickconnect/SignInScreen';

type LoadScreen = () => Promise<{ openSignInScreen: (deps: SignInDeps) => () => void }>;

function splitHash(hash: string): { path: string; query: URLSearchParams } {
  const value = hash.replace(/^#!?/, '');
  const q = value.indexOf('?');
  return {
    path: (q < 0 ? value : value.slice(0, q)).toLowerCase(),
    query: new URLSearchParams(q < 0 ? '' : value.slice(q + 1)),
  };
}

/**
 * Where a sign-in goes next: the sign-in page's `url` (jellyfin-web adds it when a signed-out visit redirects to sign
 * in), as jellyfin-web does, but only an in-app path. Dashboard.navigate routes within the app; nothing from the address
 * is ever loaded as a page.
 */
export function signInTarget(hash: string): string {
  const url = splitHash(hash).query.get(QUICK_CONNECT.loginUrlParam);
  return url && url.startsWith('/') && !url.startsWith('//') ? url : '/home';
}

/**
 * What Lumen's Quick Connect screen needs from jellyfin-web, or null: then jellyfin-web's own dialog runs. It signs in
 * through internals (registry.ts QUICK_CONNECT), one of them on a `window.Dashboard` upstream means to remove, so each
 * is checked on every click. In the official apps the sign-in page can be another server's than `window.ApiClient`
 * (its `serverid` says): that one stays jellyfin-web's too.
 */
export function signInDeps(win: Window, button: HTMLElement): SignInDeps | null {
  const client = getApiClient(win) as (SignInDeps['client'] & Record<string, unknown>) | undefined;
  const dashboard = (win as Window & { Dashboard?: Record<string, unknown> }).Dashboard;
  if (!client || typeof client[QUICK_CONNECT.apiClientMethod] !== 'function') return null;
  if (typeof client.ajax !== 'function' || typeof client.getUrl !== 'function') return null;
  if (!dashboard || !QUICK_CONNECT.dashboardMethods.every((m) => typeof dashboard[m] === 'function'))
    return null;
  const serverId = splitHash(win.location.hash).query.get(QUICK_CONNECT.loginServerParam);
  if (serverId && serverId.toLowerCase() !== (client.serverId?.() ?? '').toLowerCase()) return null;
  return {
    client,
    dashboard: dashboard as unknown as SignInDeps['dashboard'],
    target: signInTarget(win.location.hash),
    returnFocus: button,
  };
}

/**
 * On jellyfin-web's sign-in page, "Use Quick Connect" opens Lumen's screen (views/quickconnect/SignInScreen.tsx)
 * instead of jellyfin-web's dialog, which can't get a new code when one expires, keeps asking the server after it's
 * closed, and on a TV shows the code in small print. Lumen listens on the document in the capture phase, so it hears the
 * click (Enter on the button, or a remote's OK, arrives as one too) before jellyfin-web's own listener on the button,
 * and stops it there. Only where Lumen restyles the sign-in page (`data-lmn-skin`: a strict CSP that blocks the inline
 * guard leaves it off, and the stock dialog with it) and everything it needs is there; and if its file can't load, the
 * click is handed back to jellyfin-web.
 */
export function createQuickConnectSignIn(
  doc: Document,
  win: Window,
  load: LoadScreen = loadQuickConnect,
): () => void {
  /** Set while a click is passed through to jellyfin-web. */
  let passThrough = false;
  let close: (() => void) | null = null;

  const onClick = (e: MouseEvent): void => {
    if (passThrough) return;
    const button = (e.target as Element | null)?.closest?.<HTMLElement>(
      STOCK_SELECTORS.quickConnectButton.selector,
    );
    if (!button || !doc.documentElement.hasAttribute('data-lmn-skin')) return;
    if (splitHash(win.location.hash).path !== QUICK_CONNECT.loginRoute) return;
    const deps = signInDeps(win, button);
    if (!deps) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close?.();
    load().then(
      (module) => {
        close = module.openSignInScreen(deps);
      },
      () => {
        passThrough = true;
        try {
          button.click();
        } finally {
          passThrough = false;
        }
      },
    );
  };

  doc.addEventListener('click', onClick, true);
  return () => {
    doc.removeEventListener('click', onClick, true);
    close?.();
  };
}
