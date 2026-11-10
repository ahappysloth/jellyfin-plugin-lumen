/**
 * Inlined into index.html <head> by the server (Injection/HtmlInjector.cs), so it runs before jellyfin-web paints.
 * See runGuard.ts. Keep it tiny (`npm run size` checks a 4 KB gzip budget) and free of Preact.
 */
import { runGuard } from './runGuard';

try {
  runGuard(window, document);
} catch {
  // never break jellyfin-web
}
