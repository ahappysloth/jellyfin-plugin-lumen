// Copies Lumen's jellyfin-web plugin (src/compat/webPluginDefiner.js) to dist/lumen-web-plugin.js, which the server
// inlines into index.html as a script of its own. Verbatim, not built: it must stay ES5, and a bundler targeting newer
// browsers would rewrite it (arrow functions, for one).
import { copyFileSync } from 'node:fs';

copyFileSync(
  new URL('../src/compat/webPluginDefiner.js', import.meta.url),
  new URL('../dist/lumen-web-plugin.js', import.meta.url),
);
// Lumen's service worker for push notifications (src/views/push/pushWorker.js), which the server serves at
// /Lumen/Push/sw.js. Verbatim too: a worker is one classic script, and it's plain ES5 with nothing to bundle.
copyFileSync(
  new URL('../src/views/push/pushWorker.js', import.meta.url),
  new URL('../dist/lumen-push-sw.js', import.meta.url),
);
