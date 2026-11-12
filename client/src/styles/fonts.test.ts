import { describe, expect, it } from 'vitest';
import subsetScript from '../../scripts/subset-inter.sh?raw';
import adminCss from '../admin/admin.css?raw';
import baseCss from './base.css?raw';
import fontsCss from './fonts.css?raw';

/** Every stylesheet of Lumen's, by name, as written. */
const stylesheets = {
  ...import.meta.glob<string>('./*.css', { query: '?raw', import: 'default', eager: true }),
  '../admin/admin.css': adminCss,
};
const faces = [...fontsCss.matchAll(/@font-face\s*{([^}]*)}/g)].map(([, body]) => body!);
const descriptor = (face: string, name: string) =>
  new RegExp(`(?:^|;)\\s*${name}:\\s*([^;]+);`).exec(face)?.[1]?.replace(/\s+/g, ' ').trim();
const ranges = (list: string) => list.split(',').map((r) => r.trim());

describe("Lumen's fonts", () => {
  it('has Inter at 400, 500 and 600, from its own files, swapped in when they arrive', () => {
    const inter = faces.filter((f) => descriptor(f, 'font-family') === "'Lumen Inter'");
    expect(inter.map((f) => descriptor(f, 'font-weight'))).toEqual(['400', '500', '600']);
    for (const face of inter) {
      expect(descriptor(face, 'src')).toBe(
        `url('../assets/fonts/inter-${descriptor(face, 'font-weight')}.woff2?no-inline') format('woff2')`,
      );
      expect(descriptor(face, 'font-display')).toBe('swap');
    }
  });

  it("claims only what the subset holds (scripts/subset-inter.sh), so other text doesn't fetch Inter", () => {
    const subset = /unicodes='([^']+)'/.exec(subsetScript)![1]!;
    expect(faces).toHaveLength(5);
    for (const face of faces) expect(ranges(descriptor(face, 'unicode-range')!)).toEqual(ranges(subset));
  });

  it("keeps Apple's San Francisco first (Safari's name, then Chrome's), then Inter, its stand-in and the system fonts", () => {
    const stack = /--lmn-font:\s*([^;]+);/.exec(baseCss)![1]!.replace(/\s+/g, ' ');
    expect(stack).toBe(
      "-apple-system, BlinkMacSystemFont, 'Lumen Inter', 'Lumen Inter Fallback', system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
    );
  });

  it('is the only type Lumen sets: every font it names is --lmn-font (or inherits it)', () => {
    expect(Object.keys(stylesheets)).toEqual(
      expect.arrayContaining([
        './stock-skin.css',
        './stock-components.css',
        './dashboard.css',
        './player.css',
      ]),
    );
    let checked = 0;
    for (const [name, css] of Object.entries(stylesheets)) {
      const rules = name === './fonts.css' ? '' : css;
      for (const [, value] of rules.matchAll(/(?:^|[;{\s])font-family:\s*([^;]+);/g)) {
        expect(value, name).toMatch(/^(var\(--lmn-font(, inherit)?\)|inherit)$/);
        checked++;
      }
      for (const [, value] of rules.matchAll(/(?:^|[;{\s])font:\s*([^;]+);/g)) {
        expect(value, name).toMatch(/(var\(--lmn-font(, inherit)?\)|^inherit)$/);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(60);
  });
});
