import { useEffect, useState } from 'preact/hooks';
import { loadStyles } from '../../util/loadStyles';
import type { ViewContext } from '../context';

type PushModule = typeof import('./PushSettings');

/**
 * Set in this browser's storage (to the user's id) while notifications are on here: the one thing the core reads, so a
 * device that never turned them on downloads nothing more.
 */
export const PUSH_FLAG = 'lumen-push';

let loading: Promise<PushModule> | null = null;
let loaded: PushModule | null = null;

/**
 * The notifications toggle and everything behind it (the service worker's registration, the subscription) are a file
 * of their own with its stylesheet, loaded where the toggle shows (My requests, the profile page) or, on a device with
 * notifications on, once the first page is up. A failed load is asked for again next time.
 */
export function loadPush(): Promise<PushModule> {
  loading ??= Promise.all([import('./PushSettings'), loadStyles('lumen-push.css')]).then(
    ([module]) => (loaded = module),
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** Who turned notifications on in this browser (a Jellyfin user id), or null. Storage may be blocked. */
export function pushFlag(): string | null {
  try {
    return window.localStorage.getItem(PUSH_FLAG);
  } catch {
    return null;
  }
}

/**
 * On a device with notifications on, once the browser is idle: checks the subscription still stands (and renews it
 * if the server's keys changed), and listens for a tapped notification asking for a page. A no-op everywhere else.
 */
export function resumePush(ctx: ViewContext): void {
  if (!pushFlag()) return;
  const resume = (): void =>
    void loadPush()
      .then((m) => m.resumePush(ctx))
      .catch(() => undefined);
  // Not in Safari 13 (vite.target.ts).
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(resume, { timeout: 5000 });
  else window.setTimeout(resume, 2000);
}

/**
 * The toggle once its file is in; nothing until then, or if it can't load (the page works without it). `titled`: under
 * a "Notifications" heading, as a group of the profile page.
 */
export function LazyPushToggle({ ctx, titled }: { ctx: ViewContext; titled?: boolean }) {
  const [module, setModule] = useState<PushModule | null>(loaded);
  useEffect(() => {
    if (module) return;
    let cancelled = false;
    loadPush().then(
      (m) => !cancelled && setModule(m),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return module ? <module.PushToggle ctx={ctx} titled={titled} /> : null;
}
