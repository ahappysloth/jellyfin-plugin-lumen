import { fireEvent, render } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import type { HomeRow } from '../../api/types';
import { Row } from './Row';

const row: HomeRow = {
  Id: 'r1',
  Type: 'Latest',
  Title: 'Recently Added',
  Items: [{ Id: 'm1', Name: 'Alpha', Type: 'Movie' }],
};

describe('Row', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollBy'); // jsdom has none
  });

  it.each([
    [false, 'smooth'],
    [true, 'auto'],
  ])(
    'scrolls by a page on the arrows, smoothly unless motion is reduced (reduced: %s)',
    (reduced, behavior) => {
      window.matchMedia = vi.fn().mockReturnValue({ matches: reduced });
      const scrollBy = vi.fn();
      HTMLElement.prototype.scrollBy = scrollBy;
      const { container } = render(<Row row={row} client={createFakeClient()} onSelect={vi.fn()} />);

      // Hidden while there's nothing to scroll to: jsdom lays nothing out.
      fireEvent.click(container.querySelector('[aria-label="Scroll right"]')!);

      expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ behavior }));
    },
  );
});
