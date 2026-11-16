import { useEffect, useState } from 'preact/hooks';
import { installHooks, NAVIGATE_EVENT, type NavigateDetail } from './navigation';
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

/** In-app entries behind the one on screen (see pagesBehind). */
const BACK_KEY = 'lmnBack';
let behind = 0;
/** The hash of the entry on screen; null until the first is seen. */
let shown: string | null = null;

/** `replaced`: the entry on screen was replaced (history.replaceState), not a new one added after it. */
function evaluate(win: Window, replaced: boolean): void {
  const hash = win.location.hash;
  const key = subPage(hash);
  const state = win.history.state as Record<string, unknown> | null;
  const stamps: Record<string, number> = {};
  /** The entry's stamp `name` if it has one (Back, Forward, a reload; or a replace that kept it), else `fresh()`. */
  const read = (name: string, fresh: () => number): number => {
    const stamp = state?.[name];
    return typeof stamp === 'number' ? stamp : (stamps[name] = fresh());
  };
  // The first entry seen has nothing of the app's behind it. A new one has one more than the entry it follows, unless
  // it replaced it, or shows the same URL (jellyfin-web pushes the page again for a dialog, and on a cold load).
  behind = read(BACK_KEY, () => (shown === null ? 0 : replaced || hash === shown ? behind : behind + 1));
  shown = hash;
  let next = 0;
  // A new sub-page is one deeper than the page before it, unless it replaced it (react-router's replace writes a fresh
  // state, without the stamp) or is the same page again: those take the depth of the entry before.
  if (key) next = read(STATE_KEY, () => (replaced || key === page ? Math.max(depth, 1) : depth + 1));
  else if (key === '') next = depth;
  if (Object.keys(stamps).length && (state === null || typeof state === 'object')) {
    // An entry with no state reads to react-router as `idx: null` (push then counts null + 1 = 1); a stamp alone
    // would make that undefined + 1, NaN. So a null state keeps reading as idx null.
    try {
      History.prototype.replaceState.call(win.history, { idx: null, ...state, ...stamps }, '');
    } catch {
      // Safari refuses more than 100 history changes in 30 s: the counts still hold until this entry is left.
    }
  }
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
  depth = behind = 0;
  page = '';
  shown = null;
  installHooks(win);
  const handler = (e?: Event): void =>
    evaluate(
      win,
      e?.type === NAVIGATE_EVENT && !!(e as CustomEvent<NavigateDetail | undefined>).detail?.replace,
    );
  const events = [NAVIGATE_EVENT, 'popstate', 'hashchange'];
  events.forEach((e) => win.addEventListener(e, handler));
  handler();
  return () => events.forEach((e) => win.removeEventListener(e, handler));
}

/**
 * How many of the app's pages are behind the one on screen in this tab's history: 0 when it was opened from a link, in
 * a new tab, or after a reload with nothing of the app's before it. Kept in `history.state` beside the depth, so Back,
 * Forward and a reload find it again. Not history.length, which counts the tab's other sites, and the blank page a new
 * tab starts on (where Back would leave the app, or do nothing).
 */
export const pagesBehind = (): number => behind;

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
