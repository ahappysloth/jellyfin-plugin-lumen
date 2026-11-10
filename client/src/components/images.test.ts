import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../test/fakeClient';
import type { BaseItem } from '../api/types';
import { backdropUrl, CARD_SIZES, cardArt, IMAGE_WIDTHS, imageUrl, resolveImage, TITLE_LOGO } from './images';

const episode: BaseItem = {
  Id: 'ep',
  Name: 'Pilot',
  Type: 'Episode',
  ImageTags: { Primary: 'p1' },
  ParentBackdropItemId: 'series',
  ParentBackdropImageTags: ['b1'],
  ParentLogoItemId: 'series',
  ParentLogoImageTag: 'l1',
};

describe('images', () => {
  it('prefers own images and falls back to parent images', () => {
    expect(resolveImage(episode, ['Backdrop'])).toEqual({ itemId: 'series', type: 'Backdrop', tag: 'b1' });
    expect(resolveImage(episode, ['Logo'])).toEqual({ itemId: 'series', type: 'Logo', tag: 'l1' });
    expect(resolveImage(episode, ['Primary'])).toEqual({ itemId: 'ep', type: 'Primary', tag: 'p1' });
    expect(resolveImage({ Id: 'x', Name: 'x', Type: 'Movie' }, ['Primary', 'Backdrop'])).toBeNull();
  });

  it('requests images at rendered size times device pixel ratio, rounded up', () => {
    const url = imageUrl(
      createFakeClient(),
      { itemId: 'i', type: 'Primary', tag: 't' },
      { width: 180, height: 270 },
      1.5,
    );

    expect(url).toBe('http://jf/Items/i/Images/Primary?fillWidth=270&fillHeight=405&quality=90&tag=t');
  });

  const art = { itemId: 'm', type: 'Backdrop' as const, tag: 'b' };
  const fill = (url: string): [number, number] => {
    const params = new URL(url).searchParams;
    return [Number(params.get('fillWidth')), Number(params.get('fillHeight'))];
  };

  it('rounds widths up to the ladder, never below the box and at most 1.5× over it', () => {
    const client = createFakeClient();
    expect(fill(imageUrl(client, art, { width: 100 }, 1))[0]).toBe(120);
    expect(fill(imageUrl(client, art, { width: 181 }, 1))[0]).toBe(240);
    expect(fill(imageUrl(client, art, { width: 268, height: 151 }, 1))).toEqual([320, 180]);
    expect(fill(imageUrl(client, art, { width: 321, height: 180 }, 2))).toEqual([960, 538]);
    expect(fill(imageUrl(client, art, { width: 3000 }, 1))[0]).toBe(1920);
    for (const dpr of [1, 1.25, 1.5, 2, 3]) {
      for (let width = 100; width <= 1920; width += 7) {
        const [w, h] = fill(imageUrl(client, art, { width, height: Math.round((width * 9) / 16) }, dpr));
        expect(w).toBeGreaterThanOrEqual(width * dpr);
        expect(w).toBeLessThanOrEqual(Math.ceil(width * 1.5 * dpr));
        expect(h).toBeGreaterThanOrEqual(Math.floor((width * 9 * dpr) / 16));
      }
    }
    expect(IMAGE_WIDTHS.every((w, i) => i === 0 || w / IMAGE_WIDTHS[i - 1]! <= 1.5)).toBe(true);
  });

  it('asks for one URL for the same art in a card, a genre tile and an episode row, at any pixel ratio', () => {
    const client = createFakeClient();
    for (const dpr of [1, 1.25, 1.5, 2, 2.625, 3]) {
      const card = imageUrl(client, art, CARD_SIZES.landscape, dpr);
      expect(imageUrl(client, art, { width: 268, height: 151 }, dpr)).toBe(card); // home genre tile
      expect(imageUrl(client, art, { width: 260, height: 146 }, dpr)).toBe(card); // episode row still
    }
  });

  it("asks for one URL for a person's photo and the blurred copy behind it", () => {
    const client = createFakeClient();
    const photo = { itemId: 'p', type: 'Primary' as const, tag: 't' };
    for (const dpr of [1, 2]) {
      expect(imageUrl(client, photo, { width: 440 }, dpr)).toBe(imageUrl(client, photo, { width: 480 }, dpr));
    }
  });

  it('asks for a title logo at its rendered width, sharp at 2×', () => {
    const logo = { itemId: 'm', type: 'Logo' as const, tag: 'l' };
    expect(fill(imageUrl(createFakeClient(), logo, TITLE_LOGO, 2))[0]).toBe(960);
  });

  it('picks landscape art: episode stills, then thumbs, then backdrop + logo, then the poster', () => {
    expect(cardArt(episode, 'landscape')).toEqual({
      image: { itemId: 'ep', type: 'Primary', tag: 'p1' },
      logo: null,
    });
    const movie: BaseItem = {
      Id: 'm',
      Name: 'm',
      Type: 'Movie',
      BackdropImageTags: ['b'],
      ImageTags: { Logo: 'l' },
    };
    expect(cardArt(movie, 'landscape')).toEqual({
      image: { itemId: 'm', type: 'Backdrop', tag: 'b' },
      logo: { itemId: 'm', type: 'Logo', tag: 'l' },
    });
    expect(cardArt({ ...movie, ImageTags: { Thumb: 't', Logo: 'l' } }, 'landscape')).toEqual({
      image: { itemId: 'm', type: 'Thumb', tag: 't' },
      logo: null,
    });
    expect(
      cardArt({ Id: 'p', Name: 'p', Type: 'Movie', ImageTags: { Primary: 'p' } }, 'landscape').image?.type,
    ).toBe('Primary');
    expect(cardArt(movie, 'poster').image).toBeNull();
  });
});

describe('backdropUrl', () => {
  afterEach(() => vi.unstubAllGlobals());
  const ref = { itemId: 'i', type: 'Backdrop' as const, tag: 't' };
  const width = (url: string): number => Number(new URL(url, 'http://x').searchParams.get('fillWidth'));

  it("doesn't ask a 3× phone for a desktop-sized image", () => {
    vi.stubGlobal('innerWidth', 390);
    vi.stubGlobal('devicePixelRatio', 3);
    expect(width(backdropUrl(createFakeClient(), ref))).toBe(1280);
  });

  it('asks every window between two ladder steps for the same backdrop', () => {
    vi.stubGlobal('devicePixelRatio', 1);
    const urls = new Set(
      [1281, 1366, 1440, 1536, 1600].map((w) => {
        vi.stubGlobal('innerWidth', w);
        return backdropUrl(createFakeClient(), ref);
      }),
    );
    expect([...urls].map(width)).toEqual([1600]);
  });

  it('caps a wide sharp screen at 1920 CSS px, 2×', () => {
    vi.stubGlobal('innerWidth', 2560);
    vi.stubGlobal('devicePixelRatio', 2);
    expect(width(backdropUrl(createFakeClient(), ref))).toBe(3840);
  });
});
