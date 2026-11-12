import type { ClientConfig } from '../api/types';
import { type CompatReport, getAppBarHeight, SELECTORS } from '../compat/jellyfin';
import { STOCK_SELECTORS } from '../compat/registry';
import { liftVeil } from '../veil/veil';
import { type Route, routeKey, type TakeoverRoute } from './routes';

export interface TakeoverOptions {
  config: ClientConfig;
  win: Window;
  doc: Document;
  mount: (route: TakeoverRoute, root: HTMLElement, fallback: () => void) => void;
  unmount: (root: HTMLElement) => void;
  selfTest: () => CompatReport;
  report: (report: CompatReport) => void;
  /** What the player route needs (jellyfin-web's PlaybackManager). Not ok: the stock player, and a report. */
  playerCheck?: () => CompatReport;
  /** Called once a compatibility retry decides (passed, or the window ran out); the bootstrap handles the route again. */
  retry?: () => void;
  /** How long a failing compatibility check is retried before Lumen gives the page back and reports it. */
  retryMs?: number;
  /** How long after a mount Lumen checks that the stock elements it hides are there (and reports any that aren't). */
  probeMs?: number;
}

/**
 * - active: Lumen owns (or frames) the page.
 * - released: the stock UI has it.
 * - waiting: the compatibility check failed but is being retried (jellyfin-web may not have rendered yet); the stock
 *   page stays hidden under the veil until `retry` is called.
 */
export type HandleResult = 'active' | 'released' | 'waiting';

/** jellyfin-web renders #reactRoot's content after it loads its plugins, which can be after lumen.js starts. */
export const COMPAT_RETRY_MS = 3000;
const PROBE_MS = 5000;

/** Routes where jellyfin-web's page stays and Lumen draws over it (instead of replacing it: lmn-active). */
const OVERLAY_CLASS: Partial<Record<TakeoverRoute['kind'], string>> = {
  settings: 'lmn-skin-settings',
  player: 'lmn-skin-player',
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
/** Kinds whose `lmn-route-<kind>` class may be on <html>. Prefixed so component classes (.lmn-profile, …) never match <html>. */
const ROUTE_KINDS: TakeoverRoute['kind'][] = [
  'home',
  'details',
  'library',
  'favorites',
  'genre',
  'search',
  'profile',
  'history',
  'requests',
  'title',
  'settings',
  'player',
  'notFound',
];
const ROUTE_CLASSES = [
  'lmn-active',
  'lmn-skin-settings',
  'lmn-skin-player',
  ...ROUTE_KINDS.map((kind) => `lmn-route-${kind}`),
];

/** Which of the admin's switches lets Lumen have a kind of page. Off, jellyfin-web keeps it. */
export function routeEnabled(kind: TakeoverRoute['kind'], config: ClientConfig): boolean {
  switch (kind) {
    case 'home':
      return config.HomeTakeover;
    case 'details':
    case 'title':
      return config.DetailsTakeover;
    case 'settings':
      return config.StyleStockPages;
    case 'player':
      return config.StyleVideoPlayer;
    // Its way out is Lumen's home.
    case 'notFound':
      return config.HomeTakeover;
    default:
      return config.LibraryTakeover;
  }
}

/** Owns #lmn-root and the <html> classes that hide the stock page. Never touches jellyfin-web's own DOM. */
export class Takeover {
  private root: HTMLElement | null = null;
  private mountedKey: string | null = null;
  private compatible = false;
  /** When a failing compatibility check stops being retried (set on the first failure). */
  private retryUntil: number | null = null;
  private stopWatching: (() => void) | null = null;
  private readonly reported = new Set<string>();
  private probeTimer: number | undefined;
  private suppressedHref: string | null = null;
  private generation = 0;

  constructor(private readonly options: TakeoverOptions) {}

  handle(route: Route): HandleResult {
    const { win, doc } = this.options;
    const href = win.location.href;
    if (this.suppressedHref !== null && this.suppressedHref !== href) this.suppressedHref = null;

    if (route.kind === 'other' || !this.isEnabled(route) || this.suppressedHref === href) {
      this.release();
      return 'released';
    }
    const compat = this.checkCompat();
    if (compat !== 'ok') {
      this.release();
      return compat === 'waiting' ? 'waiting' : 'released';
    }
    // Without jellyfin-web's PlaybackManager Lumen's controls can't work: leave the stock player alone from the start.
    if (route.kind === 'player') {
      const player = this.options.playerCheck?.();
      if (player && !player.ok) {
        this.reportOnce(player);
        this.release();
        return 'released';
      }
    }

    const root = this.ensureRoot();
    doc.documentElement.classList.remove(...ROUTE_CLASSES);
    // Settings pages and the player stay jellyfin-web's (Lumen draws over them); every other route replaces the page.
    doc.documentElement.classList.add(OVERLAY_CLASS[route.kind] ?? 'lmn-active', `lmn-route-${route.kind}`);
    const { AccentColor } = this.options.config;
    if (HEX_COLOR.test(AccentColor)) root.style.setProperty('--lmn-accent', AccentColor);
    root.style.setProperty('--lmn-top-offset', `${getAppBarHeight(doc)}px`);

    const key = routeKey(route);
    if (this.mountedKey !== key) {
      this.mountedKey = key;
      const generation = ++this.generation;
      doc.documentElement.scrollTop = 0;
      doc.body.scrollTop = 0;
      this.options.mount(route, root, () => this.fallback(href, generation));
      this.scheduleProbe(route.kind, generation);
    }
    return 'active';
  }

  release(): void {
    this.options.doc.documentElement.classList.remove(...ROUTE_CLASSES);
    if (this.root && this.mountedKey !== null) this.options.unmount(this.root);
    this.mountedKey = null;
  }

  /** Stops any compatibility retry (the session ended). */
  dispose(): void {
    this.stopWatching?.();
    this.stopWatching = null;
    this.options.win.clearTimeout(this.probeTimer);
    this.release();
  }

  private fallback(href: string, generation: number): void {
    if (generation !== this.generation || this.mountedKey === null) return;
    this.suppressedHref = href;
    this.release();
    liftVeil(this.options.doc);
  }

  private isEnabled(route: TakeoverRoute): boolean {
    return routeEnabled(route.kind, this.options.config);
  }

  /**
   * Only a passing self-test is remembered. The first failure opens a retry window: Lumen watches #reactRoot (and
   * <html>'s layout class) and checks again as jellyfin-web renders, and reports only if the window runs out. After
   * that a failing check is still re-run on each navigation, but returns at once.
   */
  private checkCompat(): 'ok' | 'waiting' | 'failed' {
    if (this.compatible) return 'ok';
    const compat = this.options.selfTest();
    if (compat.ok) {
      this.compatible = true;
      this.stopWatching?.();
      this.stopWatching = null;
      return 'ok';
    }
    const now = Date.now();
    this.retryUntil ??= now + (this.options.retryMs ?? COMPAT_RETRY_MS);
    if (now < this.retryUntil) {
      this.watchForCompat(this.retryUntil - now);
      return 'waiting';
    }
    if (!this.reported.has('compat'))
      console.warn('[Lumen] jellyfin-web compatibility check failed; using the stock UI.', compat.failed);
    this.reportOnce(compat, 'compat');
    return 'failed';
  }

  /** Re-runs the self-test as the DOM changes (and on a short poll, for globals), until it passes or time runs out. */
  private watchForCompat(remainingMs: number): void {
    if (this.stopWatching) return;
    const { win, doc, selfTest } = this.options;
    let pending: number | undefined;
    const finish = (): void => {
      this.stopWatching?.();
      this.stopWatching = null;
      this.options.retry?.();
    };
    const check = (): void => {
      pending = undefined;
      if (selfTest().ok) finish();
    };
    const schedule = (): void => {
      pending ??= win.setTimeout(check, 50);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(doc.querySelector(SELECTORS.reactRoot) ?? doc.body ?? doc.documentElement, {
      childList: true,
      subtree: true,
    });
    observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['class'] });
    const poll = win.setInterval(schedule, 250);
    const deadline = win.setTimeout(finish, remainingMs);
    this.stopWatching = () => {
      observer.disconnect();
      win.clearInterval(poll);
      win.clearTimeout(deadline);
      win.clearTimeout(pending);
    };
  }

  /** Each distinct failure is reported once per session (the server keeps the latest of each). */
  private reportOnce(report: CompatReport, key = report.failed.join(',')): void {
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.options.report(report);
  }

  /**
   * A while after a mount, checks that the stock elements Lumen's CSS hides for this route exist. A renamed one means
   * jellyfin-web's own controls or header show through Lumen's: worth a diagnostic, though nothing is undone.
   */
  private scheduleProbe(kind: TakeoverRoute['kind'], generation: number): void {
    const { win, doc } = this.options;
    const expected: { name: string; selectors: string[] }[] =
      kind === 'player'
        ? [{ name: 'videoOsd', selectors: [STOCK_SELECTORS.videoOsd.selector] }]
        : OVERLAY_CLASS[kind]
          ? []
          : [{ name: 'appBar', selectors: [SELECTORS.modernAppBar, SELECTORS.legacyHeader] }];
    if (expected.length === 0) return;
    win.clearTimeout(this.probeTimer);
    this.probeTimer = win.setTimeout(() => {
      if (generation !== this.generation || this.mountedKey === null) return;
      const missing = expected.filter(({ selectors }) =>
        selectors.every((s) => doc.querySelector(s) === null),
      );
      if (missing.length > 0)
        this.reportOnce({ ok: false, failed: missing.map(({ name }) => `selector.${name}`) });
    }, this.options.probeMs ?? PROBE_MS);
  }

  private ensureRoot(): HTMLElement {
    if (!this.root || !this.root.isConnected) {
      const existing = this.options.doc.getElementById('lmn-root');
      this.root = existing ?? this.options.doc.createElement('div');
      this.root.id = 'lmn-root';
      if (!existing) this.options.doc.body.appendChild(this.root);
    }
    return this.root;
  }
}
