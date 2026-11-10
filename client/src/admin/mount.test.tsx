import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JellyfinApiClient } from '../compat/jellyfin';
import { mountAdmin } from './mount';

describe('mounting the settings page', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const page = (): string => '<div class="page"><div id="lmn-admin-root">Loading Lumen settings…</div></div>';
  const client = {} as JellyfinApiClient;

  it('mounts the copy jellyfin-web just opened, not only the first one it kept', () => {
    document.body.innerHTML = page();
    const mountApp = vi.fn();
    expect(mountAdmin(document, client, mountApp)).toBe(1);

    // jellyfin-web opens a second copy for a new URL (…&check=updates) and keeps the first, hidden.
    document.body.insertAdjacentHTML('beforeend', page());
    expect(mountAdmin(document, client, mountApp)).toBe(1);
    const roots = document.querySelectorAll<HTMLElement>('[id="lmn-admin-root"]');
    expect([...roots].map((r) => r.dataset.lmnMounted)).toEqual(['true', 'true']);
    expect(mountApp).toHaveBeenLastCalledWith(roots[1], client);
    expect(roots[1]!.textContent).toBe('');

    // Nothing new: nothing mounted twice.
    expect(mountAdmin(document, client, mountApp)).toBe(0);
  });

  it('waits for a signed-in client', () => {
    document.body.innerHTML = page();
    expect(mountAdmin(document, null, vi.fn())).toBe(0);
    expect(document.getElementById('lmn-admin-root')!.dataset.lmnMounted).toBeUndefined();
  });
});
