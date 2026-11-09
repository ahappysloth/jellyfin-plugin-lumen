import { render } from 'preact';
import './styles/lumen.css';
import './styles/stock-skin.css';
import { startLumen } from './takeover/bootstrap';
import { App } from './views/App';

startLumen({
  mount: (route, root, ctx) => render(<App route={route} ctx={ctx} />, root),
  unmount: (root) => render(null, root),
});
