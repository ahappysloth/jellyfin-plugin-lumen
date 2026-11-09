/**
 * The inline guard's work (guard.ts is its entry; kept separate so it can be tested). Runs in index.html <head>,
 * before jellyfin-web paints: on routes Lumen may take over it hides the stock chrome (lmn-pending) and shows the
 * veil; lumen.js lifts both. The safety timer lifts them if lumen.js never loads; lumen.js clears it on start and
 * takes over (takeover/bootstrap.ts), so a slow server doesn't flash the stock page before Lumen's.
 */
import { MARK_SVG } from '../brand/mark';
import { applySignInSkin } from './skin';
import { liftVeil, PENDING_CLASS, shouldVeil, showVeil } from './veil';

export const SAFETY_MS = 8000;
/** The guard's safety timer id, on window, for lumen.js to clear. */
export const SAFETY_TIMER_KEY = '__lmnVeilSafety';

export function runGuard(win: Window, doc: Document): void {
  const follow = (): void => applySignInSkin(doc, win.location.hash);
  follow();
  // Follow navigation on our own too, so the sign-in look comes off even if lumen.js never loads. jellyfin-web
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
      () => liftVeil(doc),
      SAFETY_MS,
    );
  }
}
