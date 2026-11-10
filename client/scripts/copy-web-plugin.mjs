// Copies Lumen's jellyfin-web plugin (src/compat/webPluginDefiner.js) to dist/lumen-web-plugin.js, which the server
// inlines into index.html as a script of its own. Verbatim, not built: it must stay ES5, and a bundler targeting newer
// browsers would rewrite it (arrow functions, for one).
import { copyFileSync } from 'node:fs';

copyFileSync(
  new URL('../src/compat/webPluginDefiner.js', import.meta.url),
  new URL('../dist/lumen-web-plugin.js', import.meta.url),
);
