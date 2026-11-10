/**
 * Inlined into index.html <head> by the server (Injection/HtmlInjector.cs), so it runs before jellyfin-web paints.
 * See runGuard.ts. Keep it tiny (`npm run size` checks a 4 KB gzip budget) and free of Preact.
 */
import { defineWebPlugin } from '../compat/webPlugin';
import { runGuard } from './runGuard';

// First and on its own: the server lists Lumen's plugin in config.json whenever it inlines this script, and
// jellyfin-web's plugin loading fails if the name isn't on window (compat/webPlugin.ts).
try {
  defineWebPlugin(window);
} catch {
  // never break jellyfin-web
}
try {
  runGuard(window, document);
} catch {
  // never break jellyfin-web
}
