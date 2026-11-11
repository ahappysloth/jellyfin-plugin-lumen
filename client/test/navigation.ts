import { act } from '@testing-library/preact';

/**
 * Changes page the way jellyfin-web does (history.pushState, which fires no event of its own: takeover/navigation.ts
 * reports it), or with a plain hash change. Returns a function that puts the URL back.
 */
export function changePage(how: 'pushState' | 'hash' = 'pushState'): () => void {
  const start = window.location.href;
  act(() => {
    if (how === 'pushState') window.history.pushState(null, '', '#/home');
    else {
      window.location.hash = '#/other';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  });
  return () => window.history.replaceState(null, '', start);
}
