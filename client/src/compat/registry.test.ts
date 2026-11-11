import { describe, expect, it } from 'vitest';
import baseCss from '../styles/base.css?raw';
import dashboardCss from '../styles/dashboard.css?raw';
import navCss from '../styles/nav.css?raw';
import playerCss from '../styles/player.css?raw';
import stockSkinCss from '../styles/stock-skin.css?raw';
import { PLAYBACK_MANAGER_METHODS, STOCK_SELECTORS } from './registry';

const stylesheets: Record<string, string> = {
  'base.css': baseCss,
  'player.css': playerCss,
  'stock-skin.css': stockSkinCss,
  'dashboard.css': dashboardCss,
  'nav.css': navCss,
};

describe('registry', () => {
  // The stylesheets can't import the registry; this keeps the two from drifting apart.
  it.each(Object.entries(STOCK_SELECTORS).filter(([, s]) => 'css' in s))(
    '%s is used where the registry says',
    (_name, entry) => {
      const css = 'css' in entry ? stylesheets[entry.css] : undefined;
      expect(css).toBeDefined();
      expect(css).toContain(entry.selector);
    },
  );

  it('lists each PlaybackManager method once', () => {
    const all = [...PLAYBACK_MANAGER_METHODS.required, ...PLAYBACK_MANAGER_METHODS.optional];
    expect(new Set(all).size).toBe(all.length);
  });
});
