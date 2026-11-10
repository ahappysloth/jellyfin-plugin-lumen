import { render } from 'preact';
import './styles/lumen.css';
import './styles/stock-skin.css';
import './styles/dropdown.css';
import './styles/player.css';
import './styles/feedback.css';
// Lumen's jellyfin-web plugin, unless the inline script already defined it (it keeps that one). Essential, not a
// nicety: config.json lists the plugin while the server's latest page carries the inline definer, but this tab's page
// may not: one served while Lumen was off or before an update, taken from the browser cache on back/forward, or whose inline
// scripts a Content-Security-Policy blocked. jellyfin-web loads its plugins only after its translations and
// config.json have loaded, and this file is preloaded with lumen.js, so it normally runs first.
import './compat/webPluginDefiner.js';
import { startLumen } from './takeover/bootstrap';
import { App } from './views/App';

startLumen({
  mount: (route, root, ctx) => render(<App route={route} ctx={ctx} />, root),
  unmount: (root) => render(null, root),
});
