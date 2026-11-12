import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applySkinCss,
  DASHBOARD_CSS,
  ensureStockCss,
  linkSkinCss,
  SKIN_WAIT_CLASS,
  SKIN_WAIT_MS,
  STOCK_CSS,
} from './skinCss';
import { whenStockCss } from './stockCss';

const root = document.documentElement;
const linkFor = (name: string) => document.querySelector<HTMLLinkElement>(`link[data-lmn-css="${name}"]`);
/** As the inline guard sees the page: still being parsed, from its own script. */
const parsing = () => {
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
  vi.spyOn(document, 'currentScript', 'get').mockReturnValue(document.createElement('script'));
};
const hidden = () => root.classList.contains(SKIN_WAIT_CLASS);
const arrive = (name: string) => linkFor(name)!.dispatchEvent(new Event('load'));

describe('the stock pages’ stylesheets', () => {
  beforeEach(() => {
    const meta = document.createElement('meta');
    meta.name = 'lumen-version';
    meta.content = 'a%2Bb';
    const core = document.createElement('link');
    core.rel = 'stylesheet';
    core.href = '../Lumen/Assets/lumen.css?v=a%2Bb';
    document.head.append(meta, core);
    root.setAttribute('data-lmn-skin', '');
    localStorage.setItem('jellyfin_credentials', '{"Servers":[{"AccessToken":"abc","UserId":"u"}]}');
  });
  afterEach(() => {
    // Ends any wait still running (its deadline too), as leaving for Lumen's own page does.
    applySkinCss(document, '#/home');
    vi.restoreAllMocks();
    vi.useRealTimers();
    localStorage.clear();
    document.head.replaceChildren();
    root.removeAttribute('data-lmn-skin');
    root.classList.remove(SKIN_WAIT_CLASS);
  });

  it('holds the first paint of a page it restyles: written into the page as it is parsed', () => {
    parsing();
    const write = vi.spyOn(document, 'write').mockImplementation(() => undefined);
    applySkinCss(document, '#/dashboard/users', true);
    expect(write.mock.calls).toEqual([
      [
        '<link rel="stylesheet" data-lmn-css="lumen-stock.css" href="../Lumen/Assets/lumen-stock.css?v=a%2Bb">',
      ],
      [
        '<link rel="stylesheet" data-lmn-css="lumen-dashboard.css" href="../Lumen/Assets/lumen-dashboard.css?v=a%2Bb">',
      ],
    ]);
  });

  it.each(['#/login', '#/mypreferencesdisplay', '#/metadata'])('treats %s as a page it restyles', (hash) => {
    parsing();
    const write = vi.spyOn(document, 'write').mockImplementation(() => undefined);
    applySkinCss(document, hash, true);
    expect(write.mock.calls[0]?.[0]).toContain(STOCK_CSS);
  });

  it("loads the stock one alongside Lumen's own pages without holding them up, and not the admin pages' one", () => {
    parsing();
    const write = vi.spyOn(document, 'write');
    applySkinCss(document, '#/home', true);
    expect(write).not.toHaveBeenCalled();
    const link = linkFor(STOCK_CSS)!;
    // A print stylesheet never holds up the screen; it applies once it's in (jellyfin-web's dialogs open anywhere).
    expect(link.media).toBe('print');
    // But it's fetched as a stylesheet is, not last of all as a print one is (behind every image).
    expect(link.getAttribute('fetchpriority')).toBe('high');
    expect(link.getAttribute('href')).toBe('../Lumen/Assets/lumen-stock.css?v=a%2Bb');
    // Before lumen.css, so lumen.css wins ties.
    expect(link.nextElementSibling?.getAttribute('href')).toContain('lumen.css');
    link.dispatchEvent(new Event('load'));
    expect(link.media).toBe('all');
    expect(linkFor(DASHBOARD_CSS)).toBeNull();
    expect(root).not.toHaveClass(SKIN_WAIT_CLASS);
  });

  it('hides an admin page reached later until its stylesheet is in, then shows it', () => {
    applySkinCss(document, '#/home');
    arrive(STOCK_CSS);
    applySkinCss(document, '#/dashboard');
    const link = linkFor(DASHBOARD_CSS)!;
    expect(link.media).toBe('all');
    expect(link.previousElementSibling).toBe(linkFor(STOCK_CSS));
    expect(root).toHaveClass(SKIN_WAIT_CLASS);
    link.dispatchEvent(new Event('load'));
    expect(root).not.toHaveClass(SKIN_WAIT_CLASS);
    // Linked once.
    applySkinCss(document, '#/dashboard/users');
    expect(document.querySelectorAll(`link[data-lmn-css="${DASHBOARD_CSS}"]`)).toHaveLength(1);
  });

  it("shows the page anyway if the stylesheet can't load, or takes too long", () => {
    vi.useFakeTimers();
    applySkinCss(document, '#/dashboard');
    arrive(STOCK_CSS);
    linkFor(DASHBOARD_CSS)!.dispatchEvent(new Event('error'));
    expect(root).not.toHaveClass(SKIN_WAIT_CLASS);

    linkSkinCss(document, 'lumen-other.css', true);
    expect(root).toHaveClass(SKIN_WAIT_CLASS);
    vi.advanceTimersByTime(SKIN_WAIT_MS);
    expect(root).not.toHaveClass(SKIN_WAIT_CLASS);
  });

  it("doesn't keep Lumen's page hidden for a stock page left before its stylesheet came", () => {
    applySkinCss(document, '#/dashboard');
    expect(root).toHaveClass(SKIN_WAIT_CLASS);
    applySkinCss(document, '#/home');
    expect(root).not.toHaveClass(SKIN_WAIT_CLASS);
  });

  it('gives a page left and come back to a wait of its own, not what was left of the old one', () => {
    vi.useFakeTimers();
    applySkinCss(document, '#/home');
    arrive(STOCK_CSS);
    applySkinCss(document, '#/dashboard');
    vi.advanceTimersByTime(1000);
    applySkinCss(document, '#/home');
    expect(hidden()).toBe(false);
    vi.advanceTimersByTime(1500);
    applySkinCss(document, '#/dashboard');
    expect(hidden()).toBe(true);
    // Past the first visit's deadline: still waiting.
    vi.advanceTimersByTime(SKIN_WAIT_MS - 1000);
    expect(hidden()).toBe(true);
    arrive(DASHBOARD_CSS);
    expect(hidden()).toBe(false);
  });

  it("doesn't put off the deadline as the admin pages are clicked through, nor wait again once it has passed", () => {
    vi.useFakeTimers();
    applySkinCss(document, '#/home');
    arrive(STOCK_CSS);
    applySkinCss(document, '#/dashboard');
    vi.advanceTimersByTime(2000);
    applySkinCss(document, '#/dashboard/users');
    expect(hidden()).toBe(true);
    vi.advanceTimersByTime(SKIN_WAIT_MS - 2000);
    expect(hidden()).toBe(false);
    // The stylesheet is still on its way: the next admin page shows at once, as this one did.
    applySkinCss(document, '#/dashboard/devices');
    expect(hidden()).toBe(false);
    vi.advanceTimersByTime(SKIN_WAIT_MS);
    applySkinCss(document, '#/home');
    applySkinCss(document, '#/dashboard');
    expect(hidden()).toBe(false);
  });

  it("never waits again for a stylesheet that couldn't load", () => {
    applySkinCss(document, '#/home');
    arrive(STOCK_CSS);
    applySkinCss(document, '#/dashboard');
    linkFor(DASHBOARD_CSS)!.dispatchEvent(new Event('error'));
    expect(hidden()).toBe(false);
    applySkinCss(document, '#/home');
    applySkinCss(document, '#/dashboard/users');
    expect(hidden()).toBe(false);
  });

  it('waits for both of an admin page’s stylesheets', () => {
    applySkinCss(document, '#/home');
    applySkinCss(document, '#/dashboard');
    arrive(DASHBOARD_CSS);
    expect(hidden()).toBe(true);
    arrive(STOCK_CSS);
    expect(hidden()).toBe(false);
  });

  it("writes into the page only from the guard's own run as the page is parsed", () => {
    const write = vi.spyOn(document, 'write').mockImplementation(() => undefined);
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    // A navigation event during the parse: writing would replace the whole page.
    applySkinCss(document, '#/login');
    expect(write).not.toHaveBeenCalled();
    expect(linkFor(STOCK_CSS)).not.toBeNull();
    document.head.replaceChildren();
    // The guard's first run, but not from a script the parser is running.
    applySkinCss(document, '#/login', true);
    expect(write).not.toHaveBeenCalled();
  });

  it('treats a cold load with no one signed in as the sign-in page jellyfin-web is about to show', () => {
    localStorage.setItem('jellyfin_credentials', '{"Servers":[{"AccessToken":null,"UserId":null}]}');
    parsing();
    const write = vi.spyOn(document, 'write').mockImplementation(() => undefined);
    applySkinCss(document, '#/home', true);
    expect(write.mock.calls[0]?.[0]).toContain(STOCK_CSS);

    // Signed in: Lumen's home, which doesn't wait for it.
    write.mockClear();
    localStorage.setItem('jellyfin_credentials', '{"Servers":[{"AccessToken":"abc","UserId":"u"}]}');
    applySkinCss(document, '#/home', true);
    expect(write).not.toHaveBeenCalled();
  });

  it("leaves a stylesheet the guard linked to the guard's wait (the settings pages' frame)", () => {
    applySkinCss(document, '#/home');
    ensureStockCss(document);
    expect(hidden()).toBe(false);
    document.head.replaceChildren();
    // The guard didn't run (a Content-Security-Policy): the frame links it, and waits for it.
    ensureStockCss(document);
    expect(linkFor(STOCK_CSS)!.media).toBe('all');
    expect(hidden()).toBe(true);
  });

  it('links nothing while the server has the stock pages stock', () => {
    root.removeAttribute('data-lmn-skin');
    applySkinCss(document, '#/dashboard');
    applySkinCss(document, '#/home');
    expect(document.querySelector('link[data-lmn-css]')).toBeNull();
  });
});

describe("jellyfin-web's dialogs' stylesheet (the item menu waits for it)", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.head.replaceChildren();
  });

  const link = () => {
    const l = document.createElement('link');
    l.setAttribute('data-lmn-css', STOCK_CSS);
    document.head.append(l);
    return l;
  };

  it('resolves at once when the guard linked none (the stock pages aren’t restyled)', async () => {
    await expect(whenStockCss()).resolves.toBeUndefined();
  });

  it('waits for it once a page load, for SKIN_WAIT_MS at most', async () => {
    vi.resetModules();
    const { whenStockCss: fresh } = await import('./stockCss');
    vi.useFakeTimers();
    const l = link();
    let ready = false;
    void fresh().then(() => (ready = true));
    await vi.advanceTimersByTimeAsync(SKIN_WAIT_MS - 1);
    expect(ready).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(ready).toBe(true);
    // Past the deadline, the next dialog doesn't wait again.
    expect(fresh()).toBe(fresh());
    l.dispatchEvent(new Event('load'));
  });

  it('resolves as it arrives, or fails', async () => {
    for (const event of ['load', 'error']) {
      vi.resetModules();
      const { whenStockCss: fresh } = await import('./stockCss');
      document.head.replaceChildren();
      const l = link();
      const ready = fresh();
      l.dispatchEvent(new Event(event));
      await expect(ready).resolves.toBeUndefined();
    }
  });
});
