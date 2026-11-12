import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import type { MyRequest, RequestProgressStatus } from '../../api/types';
import { showToast } from '../../components/Toast';
import { MY_REQUESTS_HASH } from '../../compat/jellyfin';
import { strings } from '../../strings';
import { registerSessionCache } from '../../util/sessionCaches';
import type { ViewContext } from '../context';
import { catalogHash } from './catalog';

/**
 * The signed-in user's requests and how each is going (GET /Lumen/Requests/Mine), for the posters, the title page, My
 * requests and the "ready to watch" pop-up (request progress design note, 2026-11-12). Seerr can't push, so this
 * polls, gently:
 * - once per page load, after the first page is up (only where Seerr is set up: ClientConfig.Requests);
 * - then only while the page is visible and something is in flight: every NORMAL_MS, or FAST_MS while a title page or
 *   My requests shows a download in progress (usePollFast);
 * - with nothing in flight, never again, until the user files a request (refreshRequestProgress) or opens My requests.
 * A 404 means the user has no request features: nothing more this session.
 */
export const NORMAL_MS = 45_000;
export const FAST_MS = 10_000;

const IN_FLIGHT: RequestProgressStatus[] = ['Requested', 'Queued', 'Downloading', 'Processing'];
export const isInFlight = (status: RequestProgressStatus): boolean => IN_FLIGHT.indexOf(status) >= 0;
/** Something is moving: worth the faster checks while a page shows it. */
export const isMoving = (status: RequestProgressStatus): boolean =>
  status === 'Downloading' || status === 'Processing';

type Ctx = Pick<ViewContext, 'api' | 'userId' | 'navigate'>;

/** The latest view context (each page brings a new one; the user is the same until reset). */
let ctx: Ctx | null = null;
/** Bumped by reset(): an answer or idle callback from before a reset (another user) is dropped. */
let session = 0;
let requests: MyRequest[] | null = null;
let byKey = new Map<string, MyRequest>();
/** When the last answer arrived (Date.now()), for counting time left down and spacing checks. */
let receivedAt = 0;
/** null: not asked yet; false: no request features for this user (404). */
let available: boolean | null = null;
let failed = false;
/** Checks in a row that failed before any answer: a few retries, then none until the page reloads. */
let failures = 0;
let timer: number | undefined;
let checking: Promise<void> | null = null;
let fastDemand = 0;
/** Requests whose pop-up this page has shown (in case telling the server failed). */
const announced = new Set<number>();
const listeners = new Set<() => void>();

const notify = (): void => listeners.forEach((l) => l());

function clear(): void {
  window.clearTimeout(timer);
  timer = undefined;
}

/** Sets the next check, or none: hidden page, no request features, or nothing in flight. */
function schedule(): void {
  clear();
  if (!ctx || available === false || document.hidden) return;
  const list = requests ?? [];
  const fast = fastDemand > 0 && list.some((r) => isMoving(r.Status));
  // A failed check is tried again at the normal pace, as long as there was something to follow.
  const follow = requests === null ? failures > 0 && failures < 3 : list.some((r) => isInFlight(r.Status));
  if (!fast && !follow) return;
  const wait = (fast ? FAST_MS : NORMAL_MS) - (Date.now() - receivedAt);
  timer = window.setTimeout(() => void check(), Math.max(0, wait));
}

function announce(list: MyRequest[], current: Ctx): void {
  const ready = list.filter((r) => r.Announce && !r.RequestIds.some((id) => announced.has(id)));
  if (ready.length === 0) return;
  const ids = ([] as number[]).concat(...ready.map((r) => r.RequestIds));
  ids.forEach((id) => announced.add(id));
  // Told first, so the user's other devices don't show it too; shown whether or not that worked.
  current.api.markRequestsAnnounced(ids).catch(() => undefined);
  const one = ready.length === 1 ? ready[0]!.Item : null;
  showToast(one ? strings.readyToWatch(one.Title) : strings.severalReady(ready.length), {
    label: one ? strings.open : strings.myRequests,
    onSelect: () => current.navigate(one ? catalogHash(one) : MY_REQUESTS_HASH),
  });
}

/** Asks the server now (one call at a time). */
function check(): Promise<void> {
  if (!ctx) return Promise.resolve();
  const asked = session;
  clear();
  checking ??= ctx.api
    .getMyRequests()
    .then(
      (mine) => {
        if (session !== asked || !ctx) return;
        available = true;
        failed = false;
        failures = 0;
        requests = mine.Requests;
        receivedAt = Date.now();
        const next = new Map<string, MyRequest>();
        mine.Requests.forEach((r) => next.set(r.Item.Key, r));
        byKey = next;
        if (!document.hidden) announce(mine.Requests, ctx);
      },
      (error: unknown) => {
        if (session !== asked) return;
        if ((error as Response | undefined)?.status === 404) available = false;
        else {
          failed = true;
          failures++;
        }
      },
    )
    .then(() => {
      if (session !== asked) return;
      checking = null;
      notify();
      schedule();
    });
  return checking;
}

function onVisibility(): void {
  if (document.hidden) clear();
  else schedule();
}

/**
 * Starts following the user's requests (App calls it as the first page mounts, where Seerr is set up). The first check
 * waits until the browser is idle, so it never competes with the page's own requests.
 */
export function startRequestProgress(next: Ctx): void {
  if (ctx?.userId === next.userId) {
    ctx = next;
    return;
  }
  reset();
  ctx = next;
  const started = session;
  document.addEventListener('visibilitychange', onVisibility);
  const first = (): void => {
    // Signed out meanwhile, or already asked (My requests, or a request filed meanwhile).
    if (session !== started || requests !== null || checking) return;
    if (document.hidden) {
      // Asked as soon as the page shows (onVisibility schedules nothing until there's an answer).
      const shown = (): void => {
        document.removeEventListener('visibilitychange', shown);
        if (session === started && requests === null) void check();
      };
      document.addEventListener('visibilitychange', shown);
    } else void check();
  };
  // Not in Safari 13 (vite.target.ts).
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(first, { timeout: 3000 });
  else window.setTimeout(first, 1000);
}

/** The user filed a request, or a page needs fresh progress: check now (no-op without request features). */
export function refreshRequestProgress(): Promise<void> {
  if (!ctx || available === false) return Promise.resolve();
  return check();
}

/** Checks now unless the last answer is younger than `maxAgeMs`. */
export function refreshIfOlder(maxAgeMs: number): void {
  if (Date.now() - receivedAt >= maxAgeMs) void refreshRequestProgress();
}

export function reset(): void {
  session++;
  clear();
  document.removeEventListener('visibilitychange', onVisibility);
  ctx = null;
  requests = null;
  byKey = new Map();
  receivedAt = 0;
  available = null;
  failed = false;
  failures = 0;
  checking = null;
  fastDemand = 0;
  announced.clear();
  notify();
}
registerSessionCache(reset);

/** Re-renders on every answer (only components that read the store use it). */
function useStore(): void {
  const [, bump] = useState(0);
  useLayoutEffect(() => {
    const listener = (): void => bump((n) => n + 1);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);
}

/**
 * The user's own request for this title (catalog key, "movie-603"), or undefined: they haven't requested it (another
 * user's request shows only as the card's state), or the first check hasn't answered yet.
 */
export function useRequestProgress(key: string): MyRequest | undefined {
  const [, bump] = useState(0);
  useLayoutEffect(() => {
    // Only cards whose own request changed re-render: a TV's rows hold dozens of cards.
    let last = byKey.get(key);
    const listener = (): void => {
      const now = byKey.get(key);
      if (now !== last) {
        last = now;
        bump((n) => n + 1);
      }
    };
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, [key]);
  return byKey.get(key);
}

/** All of the user's requests, for My requests: null until the first answer; `available` false without access. */
export function useMyRequests(): {
  requests: MyRequest[] | null;
  available: boolean | null;
  failed: boolean;
} {
  useStore();
  return { requests, available, failed };
}

/** While mounted and `fast`, checks every FAST_MS instead of NORMAL_MS (a page showing a download in progress). */
export function usePollFast(fast: boolean): void {
  useEffect(() => {
    if (!fast) return undefined;
    fastDemand++;
    schedule();
    return () => {
      fastDemand--;
      schedule();
    };
  }, [fast]);
}

/** Seconds left now, counted down from the last answer; null when unknown. */
export function secondsLeft(request: MyRequest, now: number = Date.now()): number | null {
  if (request.SecondsLeft == null) return null;
  return Math.max(0, request.SecondsLeft - Math.floor((now - receivedAt) / 1000));
}

/** "Downloading", "Ready"…: the label for a request's status. */
export function progressLabel(status: RequestProgressStatus): string {
  return strings.progress[status];
}

/**
 * The words under a label: "45% · 12 min left", "3 of 8 episodes · 12 min left", "Adding to your library". Empty when
 * there's nothing to add.
 */
export function progressDetail(request: MyRequest, now?: number): string {
  if (request.Status === 'Processing') return strings.processingDetail;
  if (request.Status !== 'Downloading') return '';
  const left = secondsLeft(request, now);
  return [
    request.EpisodesTotal
      ? strings.episodesOf(request.EpisodesDone ?? 0, request.EpisodesTotal)
      : request.Percent != null
        ? `${Math.floor(request.Percent)}%`
        : '',
    left != null ? strings.timeLeft(left) : '',
  ]
    .filter((p) => p)
    .join(' · ');
}
