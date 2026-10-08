import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeClient } from '../../test/fakeClient';
import { detailsHash, getAppBarHeight, getLayout, selfTest } from './jellyfin';

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
});
