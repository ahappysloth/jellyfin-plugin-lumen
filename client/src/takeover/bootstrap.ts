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

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function applyAccent(doc: Document, color: string): void {
  if (HEX_COLOR.test(color)) doc.documentElement.style.setProperty('--lmn-accent', color);
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
  /** null = Lumen is disabled or unavailable for this user; the stock UI is used everywhere. */
  takeover: Takeover | null;
}

/** Starts Lumen: one session per signed-in user, re-evaluated on every navigation. Returns a stop function. */
export function startLumen(options: BootstrapOptions): () => void {
  const win = options.win ?? window;
  const doc = options.doc ?? document;
  let session: Session | null = null;
  let starting: Promise<void> | null = null;
  let stopped = false;

  const createSession = async (client: JellyfinApiClient, userId: string): Promise<Session> => {
    const api = new LumenApi(client);
    let config: ClientConfig;
    try {
      config = await api.getClientConfig();
    } catch {
      return { userId, takeover: null };
    }
    if (!config.Enabled) return { userId, takeover: null };

    applyAccent(doc, config.AccentColor);
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
    return { userId, takeover };
  };

  const sync = async (): Promise<void> => {
    if (stopped) return;
    const client = getApiClient(win);
    const userId = client?.getCurrentUserId() ?? null;

    if (session && session.userId !== userId) {
      session.takeover?.release();
      session = null;
    }
    if (!session && client && userId) {
      starting ??= createSession(client, userId)
        .then((created) => {
          session = created;
        })
        .finally(() => {
          starting = null;
        });
      await starting;
    }
    if (!stopped) session?.takeover?.handle(parseRoute(win.location.hash));
  };

  const stopNavigation = onNavigate(() => void sync(), win);
  void waitForUser(win, options.pollMs ?? 100, options.timeoutMs ?? 60_000).then(sync);

  return () => {
    stopped = true;
    stopNavigation();
    session?.takeover?.release();
  };
}
