import { render } from 'preact';
import { getApiClient } from '../compat/jellyfin';
import { AdminApp } from './AdminApp';
import { createAdminApi } from './adminApi';
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

/** The dashboard's real background colour (themes vary), for surfaces that must be opaque like the save bar. */
function dashboardBackground(from: Element): string {
  for (let el: Element | null = from; el; el = el.parentElement) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)) return bg;
  }
  return '#181818';
}

/** The dashboard re-inserts the page HTML on each visit, so mount on load and on every page show. */
function mount(): void {
  const root = document.getElementById('lmn-admin-root');
  const client = getApiClient();
  if (!root || !client || root.dataset.lmnMounted) return;
  root.dataset.lmnMounted = 'true';
  injectStyles();
  // configPage.html ships a "Loading…" placeholder; Preact renders beside existing children, so clear it first.
  root.textContent = '';
  root.style.setProperty('--a-bg', dashboardBackground(root));
  render(<AdminApp api={createAdminApi(client)} />, root);
}

mount();
document.addEventListener('viewshow', mount);
document.addEventListener('pageshow', mount);
