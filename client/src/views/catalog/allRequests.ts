import { useEffect, useState } from 'preact/hooks';
import type { AllRequests, MyRequest } from '../../api/types';
import { registerSessionCache } from '../../util/sessionCaches';
import type { ViewContext } from '../context';
import { filterOf } from './requestFilters';
import { FAST_MS, isMoving } from './requestProgress';

/**
 * As the user's own list's NORMAL_MS (requestProgress.ts). Not imported from there, nor its isInFlight: each name this
 * file imports from the startup file is one more that file has to export, and its budget has no bytes to spare.
 */
const NORMAL_MS = 45_000;

/**
 * Every user's requests, for an administrator's My requests with "Everyone's requests" on (GET /Lumen/Requests/All).
 * Kept apart from the user's own (requestProgress.ts), which the posters, the "ready" pop-up and notifications follow:
 * nothing here is announced or shown anywhere else. Asked for while the page shows them, then, while the page is
 * visible, again after FAST_MS while something is downloading or the answer was partial (titles Seerr hadn't described
 * yet), or NORMAL_MS while something waits; never with nothing in flight.
 */
export interface AllRequestsState {
  requests: MyRequest[] | null;
  failed: boolean;
  /** When the answer arrived (Date.now()): its time left counts down from then. */
  receivedAt: number;
}

const EMPTY: AllRequestsState = { requests: null, failed: false, receivedAt: 0 };

/** The last answer, per user, so turning the switch off and on again shows it at once while a fresh one comes. */
let last: { userId: string; state: AllRequestsState } | null = null;
registerSessionCache(() => (last = null));

/** Where the switch is kept on this device, per user (as jellyfin-web keeps its per-user settings). */
export const everyoneKey = (userId: string): string => `${userId}-lumen-everyone-requests`;

export function readEveryone(userId: string): boolean {
  try {
    return window.localStorage.getItem(everyoneKey(userId)) === '1';
  } catch {
    return false; // storage blocked
  }
}

export function saveEveryone(userId: string, on: boolean): void {
  try {
    if (on) window.localStorage.setItem(everyoneKey(userId), '1');
    else window.localStorage.removeItem(everyoneKey(userId));
  } catch {
    // Storage blocked: the switch still works for this visit.
  }
}

/** How long until the next check of this answer, or null for none. */
export function nextCheck(answer: AllRequests): number | null {
  if (answer.Partial || answer.Requests.some((r) => isMoving(r.Status))) return FAST_MS;
  // In flight: waiting for approval, or on its way (requestProgress.ts IN_FLIGHT).
  return answer.Requests.some((r) => /^(pending|downloading)$/.test(filterOf(r.Status))) ? NORMAL_MS : null;
}

/** Everyone's requests while `on`; `retry` asks again (Try again). */
export function useAllRequests(ctx: ViewContext, on: boolean): AllRequestsState & { retry: () => void } {
  const [state, setState] = useState<AllRequestsState>(last?.userId === ctx.userId ? last.state : EMPTY);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!on) return undefined;
    let cancelled = false;
    let timer: number | undefined;
    let wait: number | null = 0;
    const check = (): void => {
      window.clearTimeout(timer);
      (
        ctx.client.ajax({
          type: 'GET',
          url: ctx.client.getUrl('Lumen/Requests/All'),
          dataType: 'json',
        }) as Promise<AllRequests>
      ).then(
        (answer) => {
          if (cancelled) return;
          const next = { requests: answer.Requests, failed: false, receivedAt: Date.now() };
          last = { userId: ctx.userId, state: next };
          setState(next);
          wait = nextCheck(answer);
          schedule();
        },
        () => {
          if (cancelled) return;
          // What's shown stays; with nothing shown, the page says so with Try again. No retry on its own: an
          // administrator looking at this page can press it.
          setState((s) => ({ ...s, failed: true }));
          wait = null;
        },
      );
    };
    const schedule = (): void => {
      window.clearTimeout(timer);
      if (wait !== null && !document.hidden) timer = window.setTimeout(check, wait);
    };
    // Hidden, nothing is asked; shown again, it's asked at once if a check was due meanwhile.
    const onVisibility = (): void => {
      if (document.hidden) window.clearTimeout(timer);
      else if (wait !== null) check();
    };
    document.addEventListener('visibilitychange', onVisibility);
    setState((s) => (s.failed ? { ...s, failed: false } : s));
    check();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [on, attempt, ctx.userId]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}
