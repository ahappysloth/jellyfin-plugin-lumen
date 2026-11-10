import { render } from 'preact';
import './styles/lumen.css';
import './styles/stock-skin.css';
import './styles/dropdown.css';
import './styles/player.css';
import './styles/feedback.css';
import { defineWebPlugin, WEB_PLUGIN_NAME } from './compat/webPlugin';
import { startLumen } from './takeover/bootstrap';
import { App } from './views/App';

// The inline guard defines Lumen's jellyfin-web plugin, but a Content-Security-Policy without the guard's hash blocks
// it. This file is preloaded with lumen.js and normally runs before jellyfin-web loads its plugins (that waits on its
// translations and config.json), so defining the plugin here too keeps jellyfin-web's plugin loading from failing.
if (!(WEB_PLUGIN_NAME in window)) defineWebPlugin(window);

startLumen({
  mount: (route, root, ctx) => render(<App route={route} ctx={ctx} />, root),
  unmount: (root) => render(null, root),
});
