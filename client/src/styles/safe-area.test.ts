import { describe, expect, it } from 'vitest';
import baseCss from './base.css?raw';
import navCss from './nav.css?raw';
import playerCss from './player.css?raw';

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

  it('pad the phone tab bar on both sides', () => {
    const tabbar = rule(navCss, '  .lmn-tabbar', '@media (max-width: 909.98px)');
    expect(tabbar).toMatch(LEFT);
    expect(tabbar).toMatch(RIGHT);
  });
});
