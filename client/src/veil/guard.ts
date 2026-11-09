/**
 * Inlined into index.html <head> by the server (Injection/HtmlInjector.cs), so it runs before jellyfin-web paints.
 * On routes Lumen may take over, it hides the stock chrome (lmn-pending) and shows the veil; lumen.js lifts both.
 * The timeout is a safety net in case lumen.js never loads.
 */
import { MARK_SVG } from '../brand/mark';
import { applySignInSkin } from './skin';
import { liftVeil, PENDING_CLASS, shouldVeil, showVeil } from './veil';

const SAFETY_MS = 8000;

try {
  applySignInSkin(document, location.hash);
  // Follow navigation on our own too, so the sign-in look comes off even if lumen.js never loads.
  window.addEventListener('hashchange', () => applySignInSkin(document, location.hash));
  if (shouldVeil(location.hash)) {
    document.documentElement.classList.add(PENDING_CLASS);
    showVeil(document, MARK_SVG);
    setTimeout(() => liftVeil(document), SAFETY_MS);
  }
} catch {
  // never break jellyfin-web
}
