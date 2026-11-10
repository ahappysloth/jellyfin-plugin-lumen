import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeClient } from '../../test/fakeClient';
import {
  detailsHash,
  genreHash,
  getAppBarHeight,
  getLayout,
  isBackKey,
  isRemoteBack,
  isModernLayout,
  libraryHash,
  selfTest,
  setFavicon,
} from './jellyfin';

function stockDom(): void {
  document.body.innerHTML =
    '<div id="reactRoot"><header class="MuiAppBar-root"></header><div class="skinBody"></div></div>';
  document.documentElement.className = 'layout-desktop';
  window.location.hash = '#/home';
  Object.assign(window, { ApiClient: createFakeClient(), __LUMEN_FORCE_COMPAT_FAIL__: false });
}

describe('compat', () => {
  beforeEach(stockDom);
  afterEach(() => {
    document.body.innerHTML = '';
    document.documentElement.className = '';
    localStorage.clear();
  });

  it('passes against a stock jellyfin-web page', () => {
    expect(selfTest()).toEqual({ ok: true, failed: [] });
  });

  it('accepts #!/ hash routing', () => {
    window.location.hash = '#!/home';

    expect(selfTest()).toEqual({ ok: true, failed: [] });
  });

  it('names every failed check', () => {
    document.body.innerHTML = '';
    document.documentElement.className = '';
    Object.assign(window, { ApiClient: undefined });

    expect(selfTest().failed).toEqual(['apiClient', 'reactRoot', 'stockPage', 'layoutClass']);
  });

  it('supports a forced failure hook for end-to-end tests', () => {
    Object.assign(window, { __LUMEN_FORCE_COMPAT_FAIL__: true });

    expect(selfTest()).toEqual({ ok: false, failed: ['forced'] });
  });

  it('detects the layout from html classes', () => {
    document.documentElement.className = 'layout-tv';
    expect(getLayout()).toBe('tv');
    document.documentElement.className = 'layout-mobile';
    expect(getLayout()).toBe('mobile');
  });

  it("reads Escape and TV remotes' and gamepads' Back as Back, like jellyfin-web", () => {
    const back = (init: KeyboardEventInit) => isBackKey(new KeyboardEvent('keydown', init));
    expect(back({ key: 'Escape' })).toBe(true);
    for (const keyCode of [27, 196, 461, 10009]) expect(back({ key: 'Unidentified', keyCode })).toBe(true);
    expect(back({ key: 'Backspace', keyCode: 8 })).toBe(false);
    expect(back({ key: 'Enter', keyCode: 13 })).toBe(false);
  });

  it("tells a TV remote's Back, which goes back in every layout, from Escape and a gamepad's B", () => {
    const remote = (init: KeyboardEventInit) => isRemoteBack(new KeyboardEvent('keydown', init));
    for (const keyCode of [461, 10009]) expect(remote({ key: 'Unidentified', keyCode })).toBe(true);
    expect(remote({ key: 'Escape', keyCode: 27 })).toBe(false);
    expect(remote({ key: 'Unidentified', keyCode: 196 })).toBe(false);
    const vidaa =
      'Mozilla/5.0 (Linux; VIDAA 7.0; Hisense SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0';
    const backspace = new KeyboardEvent('keydown', { key: 'Backspace', keyCode: 8 });
    expect(isRemoteBack(backspace, vidaa)).toBe(true);
    expect(isRemoteBack(backspace, navigator.userAgent)).toBe(false);
  });

  it('reads Backspace as Back on a Hisense VIDAA TV, as jellyfin-web does, but not while typing', () => {
    const vidaa =
      'Mozilla/5.0 (Linux; VIDAA 7.0; Hisense SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0';
    const backspace = (target: Element) => {
      const e = new KeyboardEvent('keydown', { key: 'Backspace', keyCode: 8 });
      Object.defineProperty(e, 'target', { value: target });
      return e;
    };
    const button = document.createElement('button');
    const text = document.createElement('input');
    const checkbox = Object.assign(document.createElement('input'), { type: 'checkbox' });

    expect(isBackKey(backspace(button), vidaa)).toBe(true);
    expect(isBackKey(backspace(checkbox), vidaa)).toBe(true);
    expect(isBackKey(backspace(text), vidaa)).toBe(false);
    expect(isBackKey(backspace(document.createElement('textarea')), vidaa)).toBe(false);
    // Not a TV by jellyfin-web's reckoning, or not VIDAA: Backspace is just Backspace.
    expect(isBackKey(backspace(button), 'Mozilla/5.0 (Linux; VIDAA 7.0; Hisense) Chrome/96.0')).toBe(false);
    expect(isBackKey(backspace(button), 'Mozilla/5.0 (Linux; Hisense SmartTV) Chrome/96.0')).toBe(false);
    expect(isBackKey(backspace(button), navigator.userAgent)).toBe(false);
  });

  it('measures the first visible app bar', () => {
    const bar = document.querySelector('.MuiAppBar-root') as HTMLElement;
    bar.getBoundingClientRect = () => ({ height: 55.6 }) as DOMRect;

    expect(getAppBarHeight()).toBe(56);
  });

  it('builds details hashes', () => {
    expect(detailsHash('abc', 's1')).toBe('#/details?id=abc&serverId=s1');
    expect(detailsHash('abc')).toBe('#/details?id=abc');
  });

  it('builds jellyfin-web library and genre routes', () => {
    expect(libraryHash({ Id: 'a', CollectionType: 'movies' })).toBe(
      '#/movies?topParentId=a&collectionType=movies',
    );
    expect(libraryHash({ Id: 'b', CollectionType: 'tvshows' })).toBe(
      '#/tv?topParentId=b&collectionType=tvshows',
    );
    expect(libraryHash({ Id: 'c', CollectionType: 'homevideos', ServerId: 's' })).toBe(
      '#/list?parentId=c&serverId=s',
    );
    expect(genreHash('g', 's')).toBe('#/list?genreId=g&serverId=s');
  });

  it('tells the Modern layout from the Legacy and TV ones', () => {
    expect(isModernLayout()).toBe(true); // nothing saved: a browser's default
    for (const saved of ['auto', 'modern', 'desktop', 'mobile']) {
      localStorage.setItem('layout', saved);
      expect(isModernLayout()).toBe(true);
    }
    for (const saved of ['desktop-legacy', 'mobile-legacy', 'tv']) {
      localStorage.setItem('layout', saved);
      expect(isModernLayout()).toBe(false);
    }
    localStorage.clear();
    document.documentElement.className = 'layout-tv'; // a TV picked by the browser, with nothing saved
    expect(isModernLayout()).toBe(false);
  });

  // appRouter.getRouteUrl: books, music videos and playlists have pages only in the Modern layout; Live TV in every one.
  it.each([
    ['Modern', 'layout-desktop', null],
    ['Legacy desktop', 'layout-desktop', 'desktop-legacy'],
    ['Legacy mobile', 'layout-mobile', 'mobile-legacy'],
    ['TV', 'layout-tv', 'tv'],
  ])('links each library type to a page the %s layout has', (layout, layoutClass, saved) => {
    document.documentElement.className = layoutClass;
    if (saved) localStorage.setItem('layout', saved);
    const modern = layout === 'Modern';
    const hash = (CollectionType: string) => libraryHash({ Id: 'l', CollectionType, ServerId: 's' });

    expect(hash('movies')).toBe('#/movies?topParentId=l&collectionType=movies');
    expect(hash('tvshows')).toBe('#/tv?topParentId=l&collectionType=tvshows');
    expect(hash('music')).toBe('#/music?topParentId=l&collectionType=music');
    for (const [type, route] of [
      ['books', '/books'],
      ['musicvideos', '/musicvideos'],
      ['playlists', '/playlists'],
    ]) {
      expect(hash(type!)).toBe(
        modern ? `#${route}?topParentId=l&collectionType=${type}` : '#/list?parentId=l&serverId=s',
      );
    }
    expect(hash('livetv')).toBe('#/livetv?collectionType=livetv');
    expect(hash('boxsets')).toBe('#/list?parentId=l&collectionType=boxsets&serverId=s');
    expect(hash('homevideos')).toBe('#/list?parentId=l&serverId=s');
  });

  it('takes the layout as an argument where there is no document (the e2e suite)', () => {
    document.documentElement.className = 'layout-tv';
    expect(libraryHash({ Id: 'l', CollectionType: 'books' }, true)).toBe(
      '#/books?topParentId=l&collectionType=books',
    );
  });
});

describe('setFavicon', () => {
  it("replaces jellyfin-web's icon with the SVG mark, adding a link when none exists", () => {
    document.head.innerHTML = '<link rel="shortcut icon" href="favicon.ico">';
    setFavicon('<svg/>');
    const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')!;
    expect(link.href).toBe('data:image/svg+xml,%3Csvg%2F%3E');
    expect(link.type).toBe('image/svg+xml');

    document.head.innerHTML = '';
    setFavicon('<svg/>');
    expect(document.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
  });
});
