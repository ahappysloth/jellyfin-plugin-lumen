/**
 * The inline guard's work (guard.ts is its entry; kept separate so it can be tested). Runs in index.html <head>,
 * before jellyfin-web paints: on routes Lumen may take over it hides the stock chrome (lmn-pending) and shows the
 * veil; lumen.js lifts both. The safety timer lifts them if lumen.js never loads; lumen.js clears it on start and
 * takes over (takeover/bootstrap.ts), so a slow server doesn't flash the stock page before Lumen's.
 */
import { MARK_SVG } from '../brand/mark';
import { applyDashboardSkin, applySignInSkin } from './skin';
import { applySkinCss } from './skinCss';
import { liftVeilNow, PENDING_CLASS, SAFETY_TIMER_KEY, shouldVeil, showVeil } from './veil';

export { SAFETY_TIMER_KEY };

export const SAFETY_MS = 8000;

export function runGuard(win: Window, doc: Document): void {
  // `parsing`: only this first, synchronous run, from the guard's own script as the parser runs it (skinCss.ts).
  const apply = (parsing: boolean): void => {
    applySignInSkin(doc, win.location.hash);
    applyDashboardSkin(doc, win.location.hash);
    applySkinCss(doc, win.location.hash, parsing);
  };
  const follow = (): void => apply(false);
  apply(true);
  // Follow navigation on our own too, so the sign-in and admin looks come off even if lumen.js never loads. jellyfin-web
  // navigates with history.pushState, which fires no event, so wrap it (and replaceState) as well.
  win.addEventListener('hashchange', follow);
  win.addEventListener('popstate', follow);
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = win.history[method];
    win.history[method] = function (this: History, ...args: Parameters<History['pushState']>) {
      original.apply(this, args);
      follow();
    };
  }
  if (shouldVeil(win.location.hash, win.location.pathname)) {
    doc.documentElement.classList.add(PENDING_CLASS);
    showVeil(doc, MARK_SVG);
    (win as unknown as Record<string, number>)[SAFETY_TIMER_KEY] = win.setTimeout(
      () => liftVeilNow(doc),
      SAFETY_MS,
    );
  }
}
