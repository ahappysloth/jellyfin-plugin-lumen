import { describe, expect, it } from 'vitest';
import { createFakeClient } from '../../test/fakeClient';
import type { BaseItem } from '../api/types';
import { cardImage, imageUrl, resolveImage } from './images';

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

  it('uses episode stills for thumb cards and posters for poster cards', () => {
    expect(cardImage(episode, 'thumb')?.type).toBe('Primary');
    expect(cardImage({ Id: 'm', Name: 'm', Type: 'Movie', BackdropImageTags: ['b'] }, 'thumb')?.type).toBe(
      'Backdrop',
    );
    expect(cardImage({ Id: 'm', Name: 'm', Type: 'Movie', BackdropImageTags: ['b'] }, 'poster')).toBeNull();
  });
});
