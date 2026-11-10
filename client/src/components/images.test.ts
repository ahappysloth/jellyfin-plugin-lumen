import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../test/fakeClient';
import type { BaseItem } from '../api/types';
import { backdropUrl, cardArt, imageUrl, resolveImage } from './images';

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

  it('caps a wide sharp screen at 1920 CSS px, 2×', () => {
    vi.stubGlobal('innerWidth', 2560);
    vi.stubGlobal('devicePixelRatio', 2);
    expect(width(backdropUrl(createFakeClient(), ref))).toBe(3840);
  });
});
