import { describe, expect, it } from 'vitest';
import baseCss from './base.css?raw';
import detailsCss from './details.css?raw';

/** A `--name: #rrggbb` token from base.css's :root. */
function token(name: string): string {
  const match = new RegExp(`${name}:\\s*(#[0-9a-f]{6});`, 'i').exec(baseCss);
  expect(match, name).not.toBeNull();
  return match![1]!;
}

/** WCAG 2 contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string): number => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('text contrast', () => {
  it("draws a cast member's initials (no photo) at 4.5:1 or more on their tile", () => {
    const start = detailsCss.indexOf('.lmn-person__photo--empty {');
    const rule = detailsCss.slice(start, detailsCss.indexOf('}', start));
    const color = /color:\s*var\((--[\w-]+)\)/.exec(rule)![1]!;

    expect(contrast(token(color), token('--lmn-surface-2'))).toBeGreaterThanOrEqual(4.5);
  });
});
