import { render } from 'preact';
import { getApiClient } from '../compat/jellyfin';
import { AdminApp } from './AdminApp';
import { createAdminApi } from './adminApi';

/** The dashboard re-inserts the page HTML on each visit, so mount on load and on every page show. */
function mount(): void {
  const root = document.getElementById('lmn-admin-root');
  const client = getApiClient();
  if (!root || !client || root.dataset.lmnMounted) return;
  root.dataset.lmnMounted = 'true';
  render(<AdminApp api={createAdminApi(client)} />, root);
}

mount();
document.addEventListener('viewshow', mount);
document.addEventListener('pageshow', mount);
