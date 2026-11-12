import { LumenApi } from '../api/lumenApi';
import { MARK_SVG } from '../brand/mark';
import type { ClientConfig } from '../api/types';
import {
  getApiClient,
  getLayout,
  getServerName,
  getServerVersion,
  isStockNotFound,
  navigateTo,
  SELECTORS,
  selfTest,
  setFavicon,
  type JellyfinApiClient,
} from '../compat/jellyfin';
import { findPlaybackManager } from '../compat/playbackManager';
import { keepViewportCover } from '../compat/viewportFit';
import { describeServerVersion } from '../compat/testedVersions';
import type { ViewContext } from '../views/context';
import { VIEW_TIMEOUT_MS, withTimeout } from '../util/withTimeout';
import { onNavigate } from './navigation';
import { parseRoute, type Route, type TakeoverRoute } from './routes';
import { applyDashboardSkin, applySignInSkin, isSignInRoute } from '../veil/skin';
import { liftVeil, PENDING_CLASS, rememberVeilName, SAFETY_TIMER_KEY } from '../veil/veil';
import { resetSessionCaches } from '../util/sessionCaches';
import { createPluginsButton } from './pluginsButton';
import { createRestartWatch } from './restartWatch';
import { Takeover } from './takeover';

export interface BootstrapOptions {
  mount: (route: TakeoverRoute, root: HTMLElement, ctx: ViewContext) => void;
  unmount: (root: HTMLElement) => void;
  win?: Window;
  doc?: Document;
  pollMs?: number;
  timeoutMs?: number;
  /** How long a failing compatibility check is retried (Takeover's COMPAT_RETRY_MS by default). */
  compatRetryMs?: number;
  /** How long to wait for jellyfin-web to set the user after navigating to a takeover route while signed out. */
  signInWaitMs?: number;
}

/**
 * A details link for another connected server stays stock: Lumen only talks to the current server's ApiClient, and
 * looking the id up there would show the wrong item (or fail).
 */
function forThisServer(route: Route, client: JellyfinApiClient | null): Route {
  if (route.kind !== 'details' || !route.serverId) return route;
  const current = client?.serverId?.();
  return current && current.toLowerCase() !== route.serverId.toLowerCase() ? { kind: 'other' } : route;
}

/** How long a taken-over page may keep the veil down while it loads. */
const VEIL_FALLBACK_MS = 4000;
/**
 * Replaces the inline guard's 8 s safety net once lumen.js runs, so a slow server doesn't lift the veil onto the stock
 * page just before Lumen's arrives. Covers the client config (VIEW_TIMEOUT_MS) plus the compatibility retry.
 */
const LUMEN_SAFETY_MS = 15_000;
/**
 * After Lumen's settings fail to load, navigations within this long stay stock without asking again, so a server
 * that's down doesn't hold every page behind the veil for the whole request timeout.
 */
const CONFIG_RETRY_MS = 5000;
/** Just after sign-in jellyfin-web can navigate to home before it sets the user; wait this long for it. */
const SIGN_IN_WAIT_MS = 3000;

/** window.ApiClient exists before sign-in but has no user; wait until it does (or give up). */
function waitForUser(win: Window, pollMs: number, timeoutMs: number): Promise<void> {
  const started = Date.now();
  return new Promise((resolve) => {
    const check = (): void => {
      if (getApiClient(win)?.getCurrentUserId() || Date.now() - started >= timeoutMs) resolve();
      else win.setTimeout(check, pollMs);
    };
    check();
  });
}

interface Session {
  userId: string;
  client: JellyfinApiClient;
  /** null = Lumen is disabled or unavailable for this user; the stock UI is used everywhere. */
  takeover: Takeover | null;
  /** Lumen's settings couldn't be loaded: try again on a navigation from this time on (Date.now()). */
  retryAt?: number;
}

interface PendingSession {
  userId: string;
  client: JellyfinApiClient;
  promise: Promise<Session>;
}

/** Starts Lumen: one session per signed-in user, re-evaluated on every navigation. Returns a stop function. */
export function startLumen(options: BootstrapOptions): () => void {
  const win = options.win ?? window;
  const doc = options.doc ?? document;
  let session: Session | null = null;
  let pending: PendingSession | null = null;
  let stopped = false;
  /** True while something is already waiting for a signed-in user (startup, or just after sign-in). */
  let waitingForUser = true;
  /** The URL a post-sign-in wait last ran for: one wait per navigation, so a signed-out page doesn't loop. */
  let signInWaitHref: string | null = null;
  const pollMs = options.pollMs ?? 100;

  // lumen.js is running: it decides when the veil lifts. Its own safety net only lifts a veil nothing has claimed.
  win.clearTimeout((win as unknown as Record<string, number | undefined>)[SAFETY_TIMER_KEY]);
  const safety = win.setTimeout(() => {
    if (!doc.documentElement.classList.contains('lmn-active')) liftVeil(doc);
  }, LUMEN_SAFETY_MS);

  const createSession = async (client: JellyfinApiClient, userId: string): Promise<Session> => {
    const api = new LumenApi(client);
    let config: ClientConfig;
    try {
      config = await withTimeout(api.getClientConfig(), VIEW_TIMEOUT_MS);
    } catch {
      return { userId, client, takeover: null, retryAt: Date.now() + CONFIG_RETRY_MS };
    }
    if (!config.Enabled) return { userId, client, takeover: null };
    setFavicon(MARK_SVG, doc);

    const takeover = new Takeover({
      config,
      win,
      doc,
      selfTest: () => selfTest(win, doc),
      playerCheck: () => {
        const { failed } = findPlaybackManager(win);
        return { ok: failed.length === 0, failed };
      },
      retry: () => void sync(),
      retryMs: options.compatRetryMs,
      // Shown on Lumen's Diagnostics page; the version says whether Lumen was tested on it (compat/testedVersions.ts).
      report: (report) => {
        void getServerVersion(client)
          .then((version) =>
            api.postDiagnostics({
              Client: `${getLayout(doc)} ${win.navigator.userAgent}`.slice(0, 100),
              ServerVersion: describeServerVersion(version),
              FailedChecks: report.failed,
            }),
          )
          .catch(() => undefined);
      },
      mount: (route, root, fallback) =>
        options.mount(route, root, {
          api,
          client,
          config,
          userId,
          layout: getLayout(doc),
          onFallback: fallback,
          navigate: (hash) => navigateTo(hash, win),
        }),
      unmount: options.unmount,
    });
    return { userId, client, takeover };
  };

  /**
   * Sign-in and admin pages need no session: style them from the route alone, and learn the server's name for sign-in.
   */
  const pluginsButton = createPluginsButton(doc);
  const restartWatch = createRestartWatch(doc, win);
  const skinStockPages = (): void => {
    applyDashboardSkin(doc, win.location.hash);
    pluginsButton.sync(win.location.hash);
    restartWatch.sync(win.location.hash);
    applySignInSkin(doc, win.location.hash);
    const client = getApiClient(win);
    if (!client || !isSignInRoute(win.location.hash) || !doc.documentElement.hasAttribute('data-lmn-skin'))
      return;
    void getServerName(client).then((name) => {
      if (!name) return;
      rememberVeilName(name);
      applySignInSkin(doc, win.location.hash, name);
    });
  };

  const sync = async (): Promise<void> => {
    skinStockPages();
    // A blip when the page loaded shouldn't leave Lumen off until a reload: ask again on a later navigation.
    if (session?.retryAt !== undefined && Date.now() >= session.retryAt) session = null;
    // Loops because the user or client can change while a session is being created.
    for (;;) {
      if (stopped) return;
      const client = getApiClient(win);
      const userId = client?.getCurrentUserId() ?? null;

      if (session && (session.client !== client || session.userId !== userId)) {
        session.takeover?.dispose();
        session = null;
        // Per-user caches (request permissions, optimistic states, saved grids) must not outlive the session.
        resetSessionCaches();
      }
      if (session || !client || !userId) break;

      if (pending?.client !== client || pending.userId !== userId) {
        pending = { userId, client, promise: createSession(client, userId) };
      }
      const entry = pending;
      const created = await entry.promise;
      // Only the newest creation counts: after A → B → A, the first A's result is stale (older config).
      const current = pending === entry;
      if (current) pending = null;
      if (stopped) return;
      if (
        current &&
        !session &&
        getApiClient(win) === entry.client &&
        entry.client.getCurrentUserId() === entry.userId
      ) {
        session = created;
      }
    }
    const route = notFound(forThisServer(parseRoute(win.location.hash), session?.client ?? null));
    if (!session && route.kind !== 'other') {
      // No user yet on a page Lumen could own: at startup waitForUser is on it; just after sign-in jellyfin-web may
      // navigate here before it sets the user, so wait for one briefly (with the stock page hidden) and sync again.
      if (getApiClient(win) && !waitingForUser && signInWaitHref !== win.location.href) awaitSignIn();
      return;
    }
    // The compatibility check is being retried: the veil and lmn-pending stay up until the takeover calls back.
    if (session?.takeover?.handle(route) === 'waiting') return;
    // The inline guard hid the stock chrome and showed the veil while this was undecided. If Lumen now owns the page,
    // its view lifts the veil once its content is ready (with a fallback here); otherwise lift it right away.
    if (doc.documentElement.classList.contains('lmn-active')) {
      doc.documentElement.classList.remove(PENDING_CLASS);
      win.setTimeout(() => liftVeil(doc), VEIL_FALLBACK_MS);
    } else {
      liftVeil(doc);
    }
  };

  const awaitSignIn = (): void => {
    waitingForUser = true;
    signInWaitHref = win.location.href;
    doc.documentElement.classList.add(PENDING_CLASS);
    void waitForUser(win, pollMs, options.signInWaitMs ?? SIGN_IN_WAIT_MS)
      .then(() => {
        waitingForUser = false;
        return sync();
      })
      .finally(() => {
        if (!session && !stopped) liftVeil(doc);
      });
  };

  /**
   * jellyfin-web's own 404 page is up: Lumen shows its "Page not found" in its place. Lumen never decides itself that a
   * URL is unknown, because only jellyfin-web knows all its routes (plugins add more). And only while that page holds
   * just jellyfin-web's own content: a plugin may draw its page into it for a route of its own, and Lumen's would hide
   * it. A 404 page left from the URL before is gone as soon as jellyfin-web renders the new one; the watcher below
   * syncs again then, and when anything is drawn into the page.
   */
  const notFound = (route: Route): Route =>
    route.kind === 'other' && isStockNotFound(doc) ? { kind: 'notFound' } : route;
  let stockNotFound = false;
  const notFoundWatcher = new MutationObserver(() => {
    const shown = isStockNotFound(doc);
    if (shown === stockNotFound) return;
    stockNotFound = shown;
    void sync();
  });
  notFoundWatcher.observe(doc.querySelector(SELECTORS.reactRoot) ?? doc.body ?? doc.documentElement, {
    childList: true,
    subtree: true,
  });

  const stopNavigation = onNavigate(() => void sync(), win);
  const stopViewportCover = keepViewportCover(doc);
  void waitForUser(win, pollMs, options.timeoutMs ?? 60_000)
    .then(() => {
      waitingForUser = false;
      return sync();
    })
    .finally(() => {
      if (!session) liftVeil(doc);
    });

  return () => {
    stopped = true;
    win.clearTimeout(safety);
    notFoundWatcher.disconnect();
    stopNavigation();
    stopViewportCover();
    pluginsButton.stop();
    restartWatch.stop();
    session?.takeover?.dispose();
  };
}
