import { LumenApi } from '../api/lumenApi';
import type { ClientConfig } from '../api/types';
import {
  getApiClient,
  getLayout,
  getServerVersion,
  navigateTo,
  selfTest,
  type JellyfinApiClient,
} from '../compat/jellyfin';
import type { ViewContext } from '../views/context';
import { onNavigate } from './navigation';
import { parseRoute, type TakeoverRoute } from './routes';
import { Takeover } from './takeover';

export interface BootstrapOptions {
  mount: (route: TakeoverRoute, root: HTMLElement, ctx: ViewContext) => void;
  unmount: (root: HTMLElement) => void;
  win?: Window;
  doc?: Document;
  pollMs?: number;
  timeoutMs?: number;
}

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

  const createSession = async (client: JellyfinApiClient, userId: string): Promise<Session> => {
    const api = new LumenApi(client);
    let config: ClientConfig;
    try {
      config = await api.getClientConfig();
    } catch {
      return { userId, client, takeover: null };
    }
    if (!config.Enabled) return { userId, client, takeover: null };

    const takeover = new Takeover({
      config,
      win,
      doc,
      selfTest: () => selfTest(win, doc),
      report: (report) => {
        void getServerVersion(client)
          .then((ServerVersion) =>
            api.postDiagnostics({
              Client: `${getLayout(doc)} ${win.navigator.userAgent}`.slice(0, 100),
              ServerVersion,
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

  const sync = async (): Promise<void> => {
    // Loops because the user or client can change while a session is being created.
    for (;;) {
      if (stopped) return;
      const client = getApiClient(win);
      const userId = client?.getCurrentUserId() ?? null;

      if (session && (session.client !== client || session.userId !== userId)) {
        session.takeover?.release();
        session = null;
      }
      if (session || !client || !userId) break;

      if (pending?.client !== client || pending.userId !== userId) {
        pending = { userId, client, promise: createSession(client, userId) };
      }
      const entry = pending;
      const created = await entry.promise;
      if (pending === entry) pending = null;
      if (stopped) return;
      if (
        !session &&
        getApiClient(win) === entry.client &&
        entry.client.getCurrentUserId() === entry.userId
      ) {
        session = created;
      }
    }
    session?.takeover?.handle(parseRoute(win.location.hash));
  };

  const stopNavigation = onNavigate(() => void sync(), win);
  void waitForUser(win, options.pollMs ?? 100, options.timeoutMs ?? 60_000).then(sync);

  return () => {
    stopped = true;
    stopNavigation();
    session?.takeover?.release();
  };
}
