import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeClient } from '../../test/fakeClient';
import {
  detailsHash,
  genreHash,
  getAppBarHeight,
  getLayout,
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
