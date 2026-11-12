/**
 * The stock pages' stylesheets as the core and the item menu see them, once the inline guard has linked them
 * (./skinCss.ts). Its own small module, so the core doesn't carry the guard's linking code.
 */

/**
 * The stock pages' stylesheets (vite.styles.config.ts), linked where they're used rather than in lumen.css or on every
 * page: jellyfin-web's sign-in, settings and admin pages' controls and its dialogs and menus (styles/stock.css), and
 * the admin pages' own look (styles/dashboard.css).
 */
export const STOCK_CSS = 'lumen-stock.css';
export const DASHBOARD_CSS = 'lumen-dashboard.css';
/** How long a page, or a dialog, waits for its stylesheet before it shows anyway. */
export const SKIN_WAIT_MS = 3000;
export const CSS_ATTR = 'data-lmn-css';

export const findLink = (doc: Document, name: string): HTMLLinkElement | null =>
  doc.querySelector<HTMLLinkElement>(`link[${CSS_ATTR}="${name}"]`);

let stockReady: Promise<void> | null = null;

/**
 * Resolves once lumen-stock.css is in, or after SKIN_WAIT_MS, so a jellyfin-web dialog opened from Lumen (the item
 * menu) opens styled rather than restyle as it shows. At once when the guard didn't link it (the stock pages aren't
 * restyled). Waits once a page load: past the deadline, the dialogs open as they are.
 */
export function whenStockCss(doc: Document = document): Promise<void> {
  const link = findLink(doc, STOCK_CSS);
  if (!link || link.sheet) return Promise.resolve();
  stockReady ??= new Promise((resolve) => {
    link.addEventListener('load', () => resolve());
    link.addEventListener('error', () => resolve());
    setTimeout(resolve, SKIN_WAIT_MS);
  });
  return stockReady;
}
