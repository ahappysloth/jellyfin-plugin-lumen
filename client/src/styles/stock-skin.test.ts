import { describe, expect, it } from 'vitest';
import css from './stock-skin.css?raw';

describe('stock skin', () => {
  it("drops jellyfin-web's toasts below Lumen's nav, except on the player, which has none", () => {
    const start = css.indexOf(':is(html.lmn-active, html.lmn-skin-settings) .toastContainer {');
    expect(start).toBeGreaterThan(
      css.indexOf(':is(html.lmn-active, html.lmn-skin-player, html.lmn-skin-settings) .toastContainer {'),
    );
    const rule = css.slice(start, css.indexOf('}', start));
    expect(rule).toMatch(/top: calc\(var\(--lmn-nav-h\) \+ 8px \+ env\(safe-area-inset-top\)\);/);
  });
});
