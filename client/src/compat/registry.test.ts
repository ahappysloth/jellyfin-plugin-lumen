import { describe, expect, it } from 'vitest';
import baseCss from '../styles/base.css?raw';
import dashboardCss from '../styles/dashboard.css?raw';
import navCss from '../styles/nav.css?raw';
import playerCss from '../styles/player.css?raw';
import stockComponentsCss from '../styles/stock-components.css?raw';
import stockSkinCss from '../styles/stock-skin.css?raw';
import { PLAYBACK_MANAGER_METHODS, STOCK_SELECTORS } from './registry';
import { STOCK_SELECTOR_META } from './registry.meta';

const stylesheets: Record<string, string> = {
  'base.css': baseCss,
  'player.css': playerCss,
  'stock-skin.css': stockSkinCss,
  'dashboard.css': dashboardCss,
  'nav.css': navCss,
  'stock-components.css': stockComponentsCss,
};

describe('registry', () => {
  // The stylesheets can't import the registry; this keeps the two from drifting apart.
  it.each(Object.entries(STOCK_SELECTOR_META).filter(([, m]) => 'css' in m))(
    '%s is used where the registry says',
    (name, meta) => {
      const css = 'css' in meta ? stylesheets[meta.css] : undefined;
      expect(css).toBeDefined();
      expect(css).toContain(STOCK_SELECTORS[name as keyof typeof STOCK_SELECTORS].selector);
    },
  );

  // The side table's type already demands this; the check stays should it ever be loosened.
  it('has probe and stylesheet details for every selector, and no others', () => {
    expect(Object.keys(STOCK_SELECTOR_META).sort()).toEqual(Object.keys(STOCK_SELECTORS).sort());
  });

  it('lists each PlaybackManager method once', () => {
    const all = [...PLAYBACK_MANAGER_METHODS.required, ...PLAYBACK_MANAGER_METHODS.optional];
    expect(new Set(all).size).toBe(all.length);
  });
});
