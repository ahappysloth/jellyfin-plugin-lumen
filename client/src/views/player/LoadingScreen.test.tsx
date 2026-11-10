import { render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import { startingFor } from '../../playback/starting';
import { LoadingScreen } from './LoadingScreen';
import type { PlayerSnapshot } from './playerState';

describe('LoadingScreen', () => {
  it("shows the backdrop at the Play click's URL when it takes over from it", () => {
    const client = createFakeClient();
    const item = {
      Id: 'e1',
      Name: 'Pilot',
      Type: 'Episode',
      SeriesName: 'Lumen Show',
      ParentBackdropItemId: 's1',
      ParentBackdropImageTags: ['bd'],
    };
    const { container } = render(
      <LoadingScreen ctx={{ client }} snap={{ item } as PlayerSnapshot} starting={null} />,
    );

    const src = container.querySelector('img')?.getAttribute('src');
    expect(src).toContain('Items/s1/Images/Backdrop');
    expect(src).toBe(startingFor(client, item).backdrop);
  });
});
