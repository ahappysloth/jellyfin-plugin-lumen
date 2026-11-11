import { describe, expect, it } from 'vitest';
import baseCss from './base.css?raw';
import navCss from './nav.css?raw';
import playerCss from './player.css?raw';
import { missingFallbacks } from '../../scripts/css-fallbacks.mjs';

/**
 * jellyfin-web sets viewport-fit=cover, so on a phone in landscape the page runs under the notch: an iPhone's side
 * inset is 47-59px. Whatever hugs the sides has to clear it, as jellyfin-web's own player controls do.
 */
// The declarations of the first `selector {` rule found after `after` (e.g. inside a media query).
function rule(css: string, selector: string, after = ''): string {
  const from = css.indexOf(after);
  expect(from, after).toBeGreaterThanOrEqual(0);
  const start = css.indexOf(`${selector} {`, from);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}
const LEFT = /env\(safe-area-inset-left\)/;
const RIGHT = /env\(safe-area-inset-right\)/;

describe('safe-area insets', () => {
  it('pad the player controls on both sides', () => {
    const controls = rule(playerCss, '.lmn-player__top,\n.lmn-player__bottom');
    expect(controls).toMatch(/padding-left:[^;]*env\(safe-area-inset-left\)/);
    expect(controls).toMatch(/padding-right:[^;]*env\(safe-area-inset-right\)/);
  });

  it('keep the playback info card and the phone panel clear of the notch', () => {
    expect(rule(playerCss, '.lmn-player-info')).toMatch(/left:[^;]*env\(safe-area-inset-left\)/);
    const panel = rule(playerCss, '  .lmn-panel', '@media (max-width: 640px)');
    expect(panel).toMatch(/right:[^;]*env\(safe-area-inset-right\)/);
    expect(panel).toMatch(/left:[^;]*env\(safe-area-inset-left\)/);
  });

  it('widen the page gutter (nav, hero, rows, details) to the larger side inset', () => {
    const gutter = /--lmn-gutter:([^;]*);/.exec(baseCss)?.[1] ?? '';
    expect(gutter).toMatch(LEFT);
    expect(gutter).toMatch(RIGHT);
  });

  it("lift jellyfin-web's footer, not the now-playing bar inside it, onto the phone tab bar and its inset", () => {
    // 12.x positions .appfooter (fixed, padded for the home indicator); .nowPlayingBar inside it isn't positioned.
    const footer = rule(navCss, '  html.lmn-has-tabbar .appfooter', '@media (max-width: 909.98px)');
    expect(footer).toMatch(/bottom: calc\(64px \+ env\(safe-area-inset-bottom\)\) !important/);
    expect(footer).toMatch(/padding-bottom: 0 !important/);
    expect(navCss).not.toContain('.nowPlayingBar');
  });

  it('pad the phone tab bar on both sides', () => {
    const tabbar = rule(navCss, '  .lmn-tabbar', '@media (max-width: 909.98px)');
    expect(tabbar).toMatch(LEFT);
    expect(tabbar).toMatch(RIGHT);
  });
});

describe('fallbacks for Chromium 68', () => {
  // It drops min(), max(), clamp() and env(); see scripts/css-fallbacks.mjs.
  const sheets = import.meta.glob<string>('./*.css', { query: '?raw', import: 'default', eager: true });

  it.each(Object.entries(sheets))(
    '%s gives every min(), max(), clamp() and env() a fallback',
    (_file, css) => {
      expect(missingFallbacks(css)).toEqual([]);
    },
  );
});

describe('missingFallbacks', () => {
  it('wants a plain declaration of the same property before the newer one', () => {
    expect(missingFallbacks('.a { width: 1px; color: red; width: min(1px, 2px); }')).toEqual([]);
    expect(missingFallbacks('.a { width: min(1px, 2px); }')).toHaveLength(1);
    expect(missingFallbacks('.a { height: 1px; width: min(1px, 2px); }')).toHaveLength(1);
  });

  it('rejects a fallback after the newer value, which would override it everywhere', () => {
    expect(missingFallbacks('.a { width: min(1px, 2px); width: 1px; }')).toHaveLength(2);
    expect(missingFallbacks('.a { width: 1px; width: min(1px, 2px); width: 3px; }')).toHaveLength(1);
  });

  it('skips only @supports blocks that Chromium 68 skips', () => {
    expect(missingFallbacks('@supports (width: max(1px, 2px)) { .a { width: min(1px, 2px); } }')).toEqual([]);
    expect(missingFallbacks('@supports (display: grid) { .a { width: min(1px, 2px); } }')).toHaveLength(1);
    expect(
      missingFallbacks('@supports not (width: max(1px, 2px)) { .a { width: min(1px, 2px); } }'),
    ).toHaveLength(1);
  });

  it('wants a custom property set again for the same selector, only where the functions are missing', () => {
    const modern = ':root { --g: max(1px, 2px); }';
    expect(
      missingFallbacks(`${modern} @supports not (width: max(1px, 2px)) { :root { --g: 1px; } }`),
    ).toEqual([]);
    expect(missingFallbacks(modern)).toHaveLength(1);
    expect(
      missingFallbacks(`${modern} @supports not (width: max(1px, 2px)) { .b { --g: 1px; } }`),
    ).toHaveLength(1);
    expect(missingFallbacks(`${modern} @supports (display: grid) { :root { --g: 1px; } }`)).toHaveLength(1);
    expect(missingFallbacks(':root { --g: 1px; --g: max(1px, 2px); }')).toHaveLength(1);
  });
});
