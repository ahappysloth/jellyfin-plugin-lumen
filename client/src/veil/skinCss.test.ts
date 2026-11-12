import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applySkinCss,
  DASHBOARD_CSS,
  linkSkinCss,
  SKIN_WAIT_CLASS,
  SKIN_WAIT_MS,
  STOCK_CSS,
} from './skinCss';

const root = document.documentElement;
const linkFor = (name: string) => document.querySelector<HTMLLinkElement>(`link[data-lmn-css="${name}"]`);
/** As the inline guard sees the page: still being parsed. */
const parsing = () => vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');

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
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.head.replaceChildren();
    root.removeAttribute('data-lmn-skin');
    root.classList.remove(SKIN_WAIT_CLASS);
  });

  it('holds the first paint of a page it restyles: written into the page as it is parsed', () => {
    parsing();
    const write = vi.spyOn(document, 'write').mockImplementation(() => undefined);
    applySkinCss(document, '#/dashboard/users');
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
    applySkinCss(document, hash);
    expect(write.mock.calls[0]?.[0]).toContain(STOCK_CSS);
  });

  it("loads the stock one alongside Lumen's own pages without holding them up, and not the admin pages' one", () => {
    parsing();
    const write = vi.spyOn(document, 'write');
    applySkinCss(document, '#/home');
    expect(write).not.toHaveBeenCalled();
    const link = linkFor(STOCK_CSS)!;
    // A print stylesheet never holds up the screen; it applies once it's in (jellyfin-web's dialogs open anywhere).
    expect(link.media).toBe('print');
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

  it('links nothing while the server has the stock pages stock', () => {
    root.removeAttribute('data-lmn-skin');
    applySkinCss(document, '#/dashboard');
    applySkinCss(document, '#/home');
    expect(document.querySelector('link[data-lmn-css]')).toBeNull();
  });
});
