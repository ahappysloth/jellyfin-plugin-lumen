import { render } from 'preact';
import type { JellyfinApiClient } from '../compat/jellyfin';
import { AdminApp } from './AdminApp';
import { createAdminApi } from './adminApi';

const ROOT_ID = 'lmn-admin-root';

/** The dashboard's real background colour (themes vary), for surfaces that must be opaque like the save bar. */
function dashboardBackground(from: Element): string {
  for (let el: Element | null = from; el; el = el.parentElement) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)) return bg;
  }
  return '#181818';
}

/**
 * Mounts the settings app into every copy of the page that doesn't have it yet. jellyfin-web keeps pages it has shown
 * in the DOM and opens a new copy for a new URL (`?name=Lumen&check=updates` next to `?name=Lumen`), so the page's root
 * id can be there more than once; looking up only the first found the old, hidden copy and left the visible one on
 * "Loading Lumen settings…".
 */
export function mountAdmin(
  doc: Document,
  client: JellyfinApiClient | null | undefined,
  mountApp = renderApp,
): number {
  if (!client) return 0;
  let mounted = 0;
  for (const root of doc.querySelectorAll<HTMLElement>(`[id="${ROOT_ID}"]`)) {
    if (root.dataset.lmnMounted) continue;
    root.dataset.lmnMounted = 'true';
    // configPage.html ships a "Loading…" placeholder; Preact renders beside existing children, so clear it first.
    root.textContent = '';
    root.style.setProperty('--a-bg', dashboardBackground(root));
    mountApp(root, client);
    mounted++;
  }
  return mounted;
}

function renderApp(root: HTMLElement, client: JellyfinApiClient): void {
  render(<AdminApp api={createAdminApi(client)} />, root);
}
