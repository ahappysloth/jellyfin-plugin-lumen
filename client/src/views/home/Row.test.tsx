import { fireEvent, render } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import type { HomeRow } from '../../api/types';
import type { BaseItem } from '../../api/types';
import { Row, showArt } from './Row';

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

  const episode: BaseItem = {
    Id: 'e2',
    Name: 'The Second',
    Type: 'Episode',
    SeriesName: 'Show',
    SeriesId: 's1',
    ParentIndexNumber: 1,
    IndexNumber: 2,
    ImageTags: { Primary: 'still' },
    ParentBackdropItemId: 's1',
    ParentBackdropImageTags: ['bd'],
    ParentLogoItemId: 's1',
    ParentLogoImageTag: 'logo',
  };
  const images = (container: Element): string[] =>
    [...container.querySelectorAll('.lmn-card__art img')].map((img) => img.getAttribute('src') ?? '');

  describe('Next Up', () => {
    it("shows the show's backdrop with its logo, not the episode's still, and keeps the episode's caption", () => {
      const { container } = render(
        <Row
          row={{ Id: 'n', Type: 'NextUp', Title: 'Next Up', Items: [episode] }}
          client={createFakeClient()}
          onSelect={vi.fn()}
        />,
      );

      const [art, logo] = images(container);
      expect(art).toContain('Items/s1/Images/Backdrop');
      expect(art).toContain('tag=bd');
      expect(logo).toContain('Items/s1/Images/Logo');
      expect(container.innerHTML).not.toContain('tag=still');
      expect(container.querySelector('.lmn-card__title')).toHaveTextContent('Show');
      expect(container.querySelector('.lmn-card__meta')).toHaveTextContent('S1:E2 · The Second');
    });

    it("prefers the show's Thumb, which carries its title", () => {
      const art = showArt({ ...episode, ParentThumbItemId: 's1', ParentThumbImageTag: 'th' });
      const { container } = render(
        <Row
          row={{
            Id: 'n',
            Type: 'NextUp',
            Title: 'Next Up',
            Items: [{ ...episode, ParentThumbItemId: 's1', ParentThumbImageTag: 'th' }],
          }}
          client={createFakeClient()}
          onSelect={vi.fn()}
        />,
      );

      expect(art?.Type).toBe('Series');
      expect(images(container)).toEqual([expect.stringContaining('Items/s1/Images/Thumb')]);
    });

    it("keeps the episode's still when the show has no landscape art", () => {
      const bare: BaseItem = { ...episode, ParentBackdropItemId: undefined, ParentBackdropImageTags: [] };
      expect(showArt(bare)).toBeUndefined();
      const { container } = render(
        <Row
          row={{ Id: 'n', Type: 'NextUp', Title: 'Next Up', Items: [bare] }}
          client={createFakeClient()}
          onSelect={vi.fn()}
        />,
      );

      expect(images(container)).toEqual([expect.stringContaining('Items/e2/Images/Primary')]);
    });

    it("leaves Continue Watching's episodes on their stills", () => {
      const { container } = render(
        <Row
          row={{ Id: 'c', Type: 'ContinueWatching', Title: 'Continue Watching', Items: [episode] }}
          client={createFakeClient()}
          onSelect={vi.fn()}
        />,
      );

      expect(images(container)).toEqual([expect.stringContaining('tag=still')]);
    });
  });

  describe('See all at the end of a poster row', () => {
    const top10: HomeRow = {
      Id: 't',
      Type: 'Top10Movies',
      Title: 'Top 10 movies',
      Items: [],
      Entries: [{ Item: { Id: 'm1', Name: 'Alpha', Type: 'Movie' } }],
    };

    it("ends a Top 10 row with a poster-sized link to the title's See all, named for the row", () => {
      const { container, getAllByRole } = render(
        <Row row={top10} client={createFakeClient()} onSelect={vi.fn()} seeAll="#/charts" />,
      );

      const tile = container.querySelector('.lmn-row__scroller')!.lastElementChild!.querySelector('a')!;
      expect(tile).toHaveClass('lmn-card', 'lmn-card--poster', 'lmn-see-all');
      expect(tile).toHaveAttribute('href', '#/charts');
      expect(tile).toHaveTextContent('See all');
      expect(tile).toHaveAccessibleName('Top 10 movies, see all in Top charts');
      // The title's link and the tile go to the same place.
      expect(getAllByRole('link', { name: 'Top 10 movies, see all in Top charts' })).toHaveLength(2);
    });

    it('is left out without a See all, and on rows other than poster rows', () => {
      const { container, rerender } = render(
        <Row row={top10} client={createFakeClient()} onSelect={vi.fn()} />,
      );
      expect(container.querySelector('.lmn-see-all')).toBeNull();

      rerender(<Row row={row} client={createFakeClient()} onSelect={vi.fn()} seeAll="#/charts" />);
      expect(container.querySelector('.lmn-see-all')).toBeNull();
    });
  });
});
