import { getApiClient, type JellyfinApiClient } from '../compat/jellyfin';
import { RESTART_MESSAGES } from '../compat/registry';
import { isAdminRoute } from '../veil/skin';
import { withTimeout } from '../util/withTimeout';

type BannerModule = typeof import('./RestartBanner');

/** A check that hasn't answered after this long says nothing: no banner. */
const CHECK_TIMEOUT_MS = 10_000;

const getJson = <T>(client: JellyfinApiClient, path: string): Promise<T> =>
  withTimeout(
    client.ajax({ type: 'GET', url: client.getUrl(path), dataType: 'json' }) as Promise<T>,
    CHECK_TIMEOUT_MS,
  );

/**
 * Notices when Jellyfin needs a restart while an admin is on jellyfin-web's admin pages with Lumen's look on, and shows
 * the restart banner (RestartBanner.tsx) then. jellyfin-web itself only says so in passing (an alert on the plugin's
 * page just after installing it; nothing after an uninstall or an update of Lumen).
 *
 * The server's System/Info says whether a restart is pending (HasPendingRestart). It's asked on each admin page Lumen
 * sees open, when the tab comes back into view, and on the websocket messages a plugin install or uninstall sends
 * (compat/registry.ts RESTART_MESSAGES): no polling. Only this check lives in Lumen's startup code; the banner's own
 * code loads the first time there's a restart to show. Anything that fails along the way (no admin, an error, a
 * timeout, the chunk not loading) means no banner, and jellyfin-web's pages are as they'd be without Lumen.
 *
 * Dismissing the banner hides it while the admin stays on the admin pages. It comes back on a reload, on returning to
 * them from elsewhere, or with a new plugin change, so a pending restart is never forgotten for long, but deciding to
 * restart later (someone is watching) isn't nagged at on every page of the Dashboard either.
 */
export function createRestartWatch(
  doc: Document,
  win: Window,
  load: () => Promise<BannerModule> = () => import('./RestartBanner'),
): { sync: (hash: string) => void; stop: () => void } {
  let client: JellyfinApiClient | null = null;
  let userId: string | null = null;
  let admin: Promise<boolean> | null = null;
  let active = false;
  let dismissed = false;
  let unsubscribe: (() => void) | null = null;
  /** Bumped whenever the banner must not show any more, so a check that answers late doesn't show it. */
  let generation = 0;
  let checking = false;
  let again = false;
  let banner: BannerModule | null = null;
  /** Plugins uninstalled while the page has been open: they're gone from /Plugins at once, so only this names them. */
  const removed: string[] = [];

  const isAdmin = (c: JellyfinApiClient): Promise<boolean> =>
    (admin ??= getJson<{ Policy?: { IsAdministrator?: boolean } }>(c, 'Users/Me').then(
      (user) => user?.Policy?.IsAdministrator === true,
      () => {
        admin = null; // ask again next time
        return false;
      },
    ));
  const pending = (c: JellyfinApiClient): Promise<boolean> =>
    getJson<{ HasPendingRestart?: unknown }>(c, 'System/Info').then(
      (info) => info?.HasPendingRestart === true,
      () => false,
    );

  const check = async (): Promise<void> => {
    if (checking) {
      again = true;
      return;
    }
    checking = true;
    try {
      do {
        again = false;
        const c = client;
        const gen = generation;
        if (!active || !c) break;
        const show = (await isAdmin(c)) && (await pending(c));
        if (gen !== generation) continue;
        if (!show) {
          removed.length = 0;
          banner?.hideRestartBanner(doc);
          continue;
        }
        if (dismissed) continue;
        banner ??= await load();
        if (gen !== generation) continue;
        void banner.showRestartBanner({
          doc,
          win,
          client: c,
          removed: removed.slice(),
          onDismiss: () => {
            dismissed = true;
          },
        });
      } while (again);
    } catch {
      // The banner's code didn't load: no banner.
    } finally {
      checking = false;
    }
  };

  const onMessage = (message: { MessageType?: string; Data?: unknown }): void => {
    if (!active) return;
    const type = message?.MessageType;
    if (type === RESTART_MESSAGES.restarting || type === RESTART_MESSAGES.shuttingDown) {
      // Restarted from elsewhere: nothing left to ask for.
      banner?.hideRestartBanner(doc);
      return;
    }
    if (type === RESTART_MESSAGES.uninstalled) {
      const name = (message.Data as { Name?: unknown } | undefined)?.Name;
      if (typeof name === 'string' && name && !removed.includes(name)) removed.push(name);
    }
    dismissed = false; // a new change brings a dismissed banner back
    void check();
  };
  const onVisible = (): void => {
    if (doc.visibilityState === 'visible') void check();
  };

  const subscribe = (c: JellyfinApiClient): void => {
    if (typeof c.subscribe !== 'function') return;
    try {
      const off = c.subscribe(Object.values(RESTART_MESSAGES), onMessage);
      unsubscribe = typeof off === 'function' ? () => void (off as () => void)() : null;
    } catch {
      // No websocket: the banner still checks on each admin page.
    }
  };

  const leave = (): void => {
    generation++;
    if (!active) return;
    active = false;
    dismissed = false;
    try {
      unsubscribe?.();
    } catch {
      // jellyfin-web's websocket already went away.
    }
    unsubscribe = null;
    doc.removeEventListener('visibilitychange', onVisible);
    banner?.hideRestartBanner(doc, true);
  };

  return {
    sync(hash) {
      const c = getApiClient(win) ?? null;
      const uid = c?.getCurrentUserId() ?? null;
      if (c !== client || uid !== userId) {
        leave();
        client = c;
        userId = uid;
        admin = null;
        removed.length = 0;
      }
      if (!c || !uid || !doc.documentElement.hasAttribute('data-lmn-skin') || !isAdminRoute(hash)) {
        leave();
        return;
      }
      if (!active) {
        active = true;
        subscribe(c);
        doc.addEventListener('visibilitychange', onVisible);
      }
      void check();
    },
    stop: leave,
  };
}
