import { useEffect, useState } from 'preact/hooks';
import { installHooks, NAVIGATE_EVENT } from './navigation';
import { parseRoute, routeKey } from './routes';

/**
 * How many of Lumen's sub-pages deep the user is, for the Back pill's Home button (views/BackHome.tsx). A sub-page is
 * one that draws its own Back button in place of the nav: a title, an episode, a person, a collection, a catalog title.
 * Home → movie is 1; → an actor from there is 2; Back is 1 again; any other page (home, a library, search, settings,
 * jellyfin-web's own) is 0. A details page opened from a link is 1.
 *
 * The depth is kept with the history entry itself, in `history.state`, so Back, Forward and a reload all find it again
 * with nothing to keep in step: a count kept beside the history (by its length, say) can't tell Back-then-a-new-page
 * from Forward. jellyfin-web's router (react-router's hash history, 12.4) keeps `usr`, `key` and `idx` there and reads
 * nothing else; entries made by a link or a hash assignment (most of Lumen's) have no state at all. The stamp is added
 * to whatever is there with History.prototype.replaceState and no URL: react-router isn't told (it has no event for
 * it), and neither are the guard's and navigation.ts's wrappers, which sit on the `history` object itself.
 */
const STATE_KEY = 'lmnDepth';

let depth = 0;
/** The sub-page the depth is for ('' on any other page). */
let page = '';
const listeners = new Set<() => void>();

/** The sub-page a URL shows (takeover/routes.ts routeKey), '' for the player, null for every other page. */
function subPage(hash: string): string | null {
  const route = parseRoute(hash);
  if (route.kind === 'details' || route.kind === 'title') return routeKey(route);
  // The player comes and goes over the page that started it (jellyfin-web pushes #/video, then goes back).
  return route.kind === 'player' ? '' : null;
}

function evaluate(win: Window): void {
  const key = subPage(win.location.hash);
  let next = 0;
  if (key) {
    const state = win.history.state as Record<string, unknown> | null;
    const stamp = state?.[STATE_KEY];
    // Seen before (Back, Forward, a reload; or replaced with another sub-page, which is no deeper).
    if (typeof stamp === 'number') next = stamp;
    else {
      // A new entry. The same page again (jellyfin-web pushes one for a dialog, and may replace it) stays where it
      // was; another page is one deeper.
      next = key === page ? Math.max(depth, 1) : depth + 1;
      if (state === null || typeof state === 'object') {
        try {
          History.prototype.replaceState.call(win.history, { ...state, [STATE_KEY]: next }, '');
        } catch {
          // Safari refuses more than 100 history changes in 30 s: the depth still holds until this entry is left.
        }
      }
    }
  } else if (key === '') next = depth;
  if (key !== '') page = key ?? '';
  if (next === depth) return;
  depth = next;
  listeners.forEach((listener) => listener());
}

/**
 * Follows the page's history from now on (the bootstrap calls it before it listens for navigation itself, so the depth
 * is right by the time a page mounts). Returns a function that stops.
 */
export function trackPageDepth(win: Window = window): () => void {
  depth = 0;
  page = '';
  installHooks(win);
  const handler = (): void => evaluate(win);
  const events = [NAVIGATE_EVENT, 'popstate', 'hashchange'];
  events.forEach((e) => win.addEventListener(e, handler));
  handler();
  return () => events.forEach((e) => win.removeEventListener(e, handler));
}

/** How many sub-pages deep the page on screen is (see above). */
export const pageDepth = (): number => depth;

/** pageDepth for a component: re-renders if it changes under the page. */
export function usePageDepth(): number {
  const [, bump] = useState(0);
  useEffect(() => {
    const listener = (): void => bump((n) => n + 1);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);
  return depth;
}
