export type Route = { kind: 'home' } | { kind: 'details'; id: string } | { kind: 'other' };
export type TakeoverRoute = Exclude<Route, { kind: 'other' }>;

const ITEM_ID = /^[0-9a-f]{32}$|^[0-9a-f-]{36}$/i;

/** Maps jellyfin-web hash routes to Lumen routes. Home tabs other than 0 (e.g. Favorites) stay stock. */
export function parseRoute(hash: string): Route {
  const value = hash.replace(/^#!?/, '');
  const queryStart = value.indexOf('?');
  const path = (queryStart < 0 ? value : value.slice(0, queryStart)).toLowerCase();
  const query = new URLSearchParams(queryStart < 0 ? '' : value.slice(queryStart + 1));

  if (path === '/home') {
    const tab = query.get('tab');
    return tab === null || tab === '0' ? { kind: 'home' } : { kind: 'other' };
  }
  if (path === '/details') {
    const id = query.get('id');
    if (id && ITEM_ID.test(id)) return { kind: 'details', id };
  }
  return { kind: 'other' };
}
