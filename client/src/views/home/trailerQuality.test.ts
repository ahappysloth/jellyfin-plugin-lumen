import { afterEach, describe, expect, it, vi } from 'vitest';
import { HD_ABOVE_PX, needsHd, trailerFiles } from './trailerQuality';

describe('needsHd', () => {
  it('is 1080p on a phone, a desktop and a TV, 720p only for a small box', () => {
    // iPhone 15 in portrait: the banner's box at 3x shows a third of the picture's width over 660 px.
    expect(needsHd({ width: 390, height: 660 }, 3)).toBe(true);
    // The same phone in landscape, and an older one at 2x.
    expect(needsHd({ width: 844, height: 390 }, 3)).toBe(true);
    expect(needsHd({ width: 375, height: 560 }, 2)).toBe(true);
    // A desktop's hero, a 4K screen at 2x, a TV's full-screen banner.
    expect(needsHd({ width: 1440, height: 890 }, 1)).toBe(true);
    expect(needsHd({ width: 1920, height: 1000 }, 2)).toBe(true);
    expect(needsHd({ width: 1920, height: 1080 }, 1)).toBe(true);
    // A laptop's banner that 720p about fills, and a small window.
    expect(needsHd({ width: 1280, height: 640 }, 1)).toBe(false);
    expect(needsHd({ width: 800, height: 450 }, 1)).toBe(false);
  });

  it('covers the box at 16:9: a wide box needs the height the picture is drawn at, not the box', () => {
    // 1366 wide is drawn 768 tall, though the box is only 400.
    expect(needsHd({ width: 1366, height: 400 }, 1)).toBe(true);
    expect(needsHd({ width: (HD_ABOVE_PX * 16) / 9, height: 100 }, 1)).toBe(false);
    expect(needsHd({ width: 100, height: HD_ABOVE_PX + 1 }, 1)).toBe(true);
  });

  it('is 720p for a browser asking to save data', () => {
    expect(needsHd({ width: 390, height: 660 }, 3, true)).toBe(false);
  });

  it('takes a missing pixel ratio for 1', () => {
    expect(needsHd({ width: 1280, height: 700 }, 0)).toBe(false);
  });
});

describe('trailerFiles', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const box = (width: number, height: number) =>
    ({ clientWidth: width, clientHeight: height }) as unknown as Element;

  it('tries the 1080p file first where it is needed, then the 720p one; the one there is without it', () => {
    vi.stubGlobal('devicePixelRatio', 3);
    expect(trailerFiles('sd.mp4', 'hd.mp4', box(390, 660))).toEqual(['hd.mp4', 'sd.mp4']);
    expect(trailerFiles('sd.mp4', null, box(390, 660))).toEqual(['sd.mp4']);
    vi.stubGlobal('devicePixelRatio', 1);
    expect(trailerFiles('sd.mp4', 'hd.mp4', box(800, 450))).toEqual(['sd.mp4']);
  });

  it("follows the browser's Save-Data", () => {
    vi.stubGlobal('devicePixelRatio', 3);
    Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } });
    try {
      expect(trailerFiles('sd.mp4', 'hd.mp4', box(390, 660))).toEqual(['sd.mp4']);
    } finally {
      delete (navigator as { connection?: unknown }).connection;
    }
  });
});
