import type { ClientConfig } from '../api/types';
import { type CompatReport, getAppBarHeight } from '../compat/jellyfin';
import type { Route, TakeoverRoute } from './routes';

export interface TakeoverOptions {
  config: ClientConfig;
  win: Window;
  doc: Document;
  mount: (route: TakeoverRoute, root: HTMLElement, fallback: () => void) => void;
  unmount: (root: HTMLElement) => void;
  selfTest: () => CompatReport;
  report: (report: CompatReport) => void;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const ROUTE_CLASSES = ['lmn-active', 'lmn-home', 'lmn-details'];

/** Owns #lmn-root and the <html> classes that hide the stock page. Never touches jellyfin-web's own DOM. */
export class Takeover {
  private root: HTMLElement | null = null;
  private mountedKey: string | null = null;
  private compatible = false;
  private reported = false;
  private suppressedHref: string | null = null;
  private generation = 0;

  constructor(private readonly options: TakeoverOptions) {}

  handle(route: Route): void {
    const { win, doc } = this.options;
    const href = win.location.href;
    if (this.suppressedHref !== null && this.suppressedHref !== href) this.suppressedHref = null;

    if (
      route.kind === 'other' ||
      !this.isEnabled(route) ||
      this.suppressedHref === href ||
      !this.isCompatible()
    ) {
      this.release();
      return;
    }

    const root = this.ensureRoot();
    doc.documentElement.classList.remove(...ROUTE_CLASSES);
    doc.documentElement.classList.add('lmn-active', route.kind === 'home' ? 'lmn-home' : 'lmn-details');
    const { AccentColor } = this.options.config;
    if (HEX_COLOR.test(AccentColor)) root.style.setProperty('--lmn-accent', AccentColor);
    root.style.setProperty('--lmn-top-offset', `${getAppBarHeight(doc)}px`);

    const key = route.kind === 'home' ? 'home' : `details:${route.id}`;
    if (this.mountedKey !== key) {
      this.mountedKey = key;
      const generation = ++this.generation;
      doc.documentElement.scrollTop = 0;
      doc.body.scrollTop = 0;
      this.options.mount(route, root, () => this.fallback(href, generation));
    }
  }

  release(): void {
    this.options.doc.documentElement.classList.remove(...ROUTE_CLASSES);
    if (this.root && this.mountedKey !== null) this.options.unmount(this.root);
    this.mountedKey = null;
  }

  private fallback(href: string, generation: number): void {
    if (generation !== this.generation || this.mountedKey === null) return;
    this.suppressedHref = href;
    this.release();
  }

  private isEnabled(route: TakeoverRoute): boolean {
    return route.kind === 'home' ? this.options.config.HomeTakeover : this.options.config.DetailsTakeover;
  }

  /** Only a passing self-test is remembered; a failing one is re-run later (jellyfin-web may not have rendered yet). */
  private isCompatible(): boolean {
    if (this.compatible) return true;
    const compat = this.options.selfTest();
    if (compat.ok) {
      this.compatible = true;
      return true;
    }
    if (!this.reported) {
      this.reported = true;
      console.warn('[Lumen] jellyfin-web compatibility check failed; using the stock UI.', compat.failed);
      this.options.report(compat);
    }
    return false;
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
