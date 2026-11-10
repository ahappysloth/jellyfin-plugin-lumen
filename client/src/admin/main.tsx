import { getApiClient } from '../compat/jellyfin';
import { mountAdmin } from './mount';
import dropdownCss from '../styles/dropdown.css?inline';
import css from './admin.css?inline';

/** The admin bundle has no separate stylesheet; inject it once, scoped to .lmn-admin. */
function injectStyles(): void {
  if (document.getElementById('lmn-admin-style')) return;
  const style = document.createElement('style');
  style.id = 'lmn-admin-style';
  style.textContent = dropdownCss + css;
  document.head.appendChild(style);
}

/** The dashboard re-inserts the page HTML on each visit, so mount on load and on every page show. */
function mount(): void {
  if (mountAdmin(document, getApiClient()) > 0) injectStyles();
}

mount();
// The dashboard can run this bundle again on later visits; install the page listeners only once.
const flagged = window as Window & { __lmnAdminListening?: boolean };
if (!flagged.__lmnAdminListening) {
  flagged.__lmnAdminListening = true;
  document.addEventListener('viewshow', mount);
  document.addEventListener('pageshow', mount);
}
