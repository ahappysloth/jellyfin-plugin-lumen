import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../test/fakeClient';
import type { BaseItem } from '../api/types';
import { cardMenuHandler } from '../views/cardMenu';
import { makeContext } from '../../test/viewContext';
import { ContextMenuHost } from './ContextMenu';
import { EpisodeList } from '../views/details/EpisodeList';
import { GenreTile } from '../views/home/Row';
import { Card } from './Card';

const movie: BaseItem = { Id: 'm1', Name: 'Lumen Alpha', Type: 'Movie', ImageTags: { Primary: 'tag1' } };

describe('Card', () => {
  it("links to the item's page, renders a lazy poster image and selects on click", () => {
    const onSelect = vi.fn();
    render(<Card item={movie} client={createFakeClient()} variant="poster" onSelect={onSelect} />);

    const link = screen.getByRole('link', { name: 'Lumen Alpha' });
    expect(link).toHaveAttribute('href', '#/details?id=m1');
    const img = link.querySelector('img')!;
    expect(img.getAttribute('src')).toContain('Items/m1/Images/Primary');
    expect(img.getAttribute('loading')).toBe('lazy');
    // A plain click goes through onSelect (which remembers the grid or row first), not the browser.
    expect(fireEvent.click(link)).toBe(false);
    expect(onSelect).toHaveBeenCalledWith(movie);
  });

  it('leaves a Ctrl/Cmd/Shift-click or middle-click to the browser (a new tab or window)', () => {
    const onSelect = vi.fn();
    render(<Card item={movie} client={createFakeClient()} variant="poster" onSelect={onSelect} />);
    const link = screen.getByRole('link', { name: 'Lumen Alpha' });

    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
      expect(fireEvent.click(link, init)).toBe(true);
    }
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('treats an Alt-click like a plain click (the browser would download the link)', () => {
    const onSelect = vi.fn();
    render(<Card item={movie} client={createFakeClient()} variant="poster" onSelect={onSelect} />);

    expect(fireEvent.click(screen.getByRole('link', { name: 'Lumen Alpha' }), { altKey: true })).toBe(false);
    expect(onSelect).toHaveBeenCalledWith(movie);
  });

  it("names an episode's More button after the whole card, not just the episode", () => {
    const episode: BaseItem = { Id: 'e1', Name: 'Pilot', Type: 'Episode', SeriesName: 'Lumen Show' };
    render(
      <Card
        item={episode}
        client={createFakeClient()}
        variant="landscape"
        caption="S1:E2 · Pilot"
        onSelect={vi.fn()}
        onMenu={vi.fn()}
      />,
    );

    expect(screen.getByRole('button')).toHaveAccessibleName('More options for Lumen Show S1:E2 · Pilot');
  });

  it('swallows the click that ends a touch long-press, which opened the menu', () => {
    vi.useFakeTimers();
    try {
      const onSelect = vi.fn();
      const onMenu = vi.fn();
      render(
        <Card
          item={movie}
          client={createFakeClient()}
          variant="poster"
          onSelect={onSelect}
          onMenu={onMenu}
        />,
      );
      const link = screen.getByRole('link', { name: 'Lumen Alpha' });

      fireEvent.pointerDown(link, { pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 20 });
      vi.advanceTimersByTime(600);
      fireEvent.pointerUp(link, { pointerId: 1, pointerType: 'touch' });

      expect(onMenu).toHaveBeenCalledWith(movie, { x: 20, y: 20 }, link);
      expect(fireEvent.click(link)).toBe(false); // the link doesn't navigate either
      expect(onSelect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a badge, the title and a rating · year · type meta line; only the title names the link', () => {
    const item: BaseItem = { ...movie, CommunityRating: 7.36, ProductionYear: 2021 };
    render(
      <Card
        item={item}
        client={createFakeClient()}
        variant="landscape"
        badge="NewEpisode"
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText('New episode')).toBeInTheDocument();
    expect(screen.getByText('7.4')).toBeInTheDocument();
    expect(screen.getByText('2021')).toBeInTheDocument();
    expect(screen.getByText('Movie')).toBeInTheDocument();
    // Named by its visible title (no aria-label hiding the rest: axe label-content-name-mismatch); the rest describes it.
    const link = screen.getByRole('link', { name: 'Lumen Alpha' });
    expect(link).not.toHaveAttribute('aria-label');
    expect(link).toHaveAccessibleDescription('New episode, Rated 7.4, 2021, Movie');
  });

  it('lays the title logo over a backdrop', () => {
    const item: BaseItem = {
      Id: 'b',
      Name: 'B',
      Type: 'Movie',
      BackdropImageTags: ['bd'],
      ImageTags: { Logo: 'lg' },
    };
    render(<Card item={item} client={createFakeClient()} variant="landscape" onSelect={vi.fn()} />);

    const sources = [...screen.getByRole('link').querySelectorAll('img')].map((i) => i.getAttribute('src'));
    expect(sources[0]).toContain('Images/Backdrop');
    expect(sources[1]).toContain('Images/Logo');
  });

  it("asks for the same image URL as a genre tile showing the card's backdrop", () => {
    const client = createFakeClient();
    const item: BaseItem = { Id: 'm1', Name: 'Lumen Alpha', Type: 'Movie', BackdropImageTags: ['bd'] };
    const genre: BaseItem = {
      Id: 'g1',
      Name: 'Drama',
      Type: 'Genre',
      ParentBackdropItemId: 'm1',
      ParentBackdropImageTags: ['bd'],
    };
    const { container } = render(
      <>
        <Card item={item} client={client} variant="landscape" onSelect={vi.fn()} />
        <GenreTile item={genre} client={client} onSelect={vi.fn()} />
      </>,
    );

    const [card, tile] = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src'));
    expect(card).toContain('Items/m1/Images/Backdrop');
    expect(tile).toBe(card);
  });

  it("asks for the same image URL as the season's episode list for an episode's still", () => {
    const client = createFakeClient();
    const episode: BaseItem = { Id: 'e1', Name: 'Pilot', Type: 'Episode', ImageTags: { Primary: 'st' } };
    const { container } = render(
      <>
        <Card item={episode} client={client} variant="landscape" onSelect={vi.fn()} />
        <EpisodeList episodes={[episode]} client={client} onPlay={vi.fn()} />
      </>,
    );

    const [card, row] = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src'));
    expect(card).toContain('Items/e1/Images/Primary');
    expect(row).toBe(card);
  });

  it('renders a title placeholder when the item has no image, without reading the title twice', () => {
    render(
      <Card
        item={{ Id: 'x', Name: 'No Art', Type: 'Movie' }}
        client={createFakeClient()}
        variant="poster"
        onSelect={vi.fn()}
      />,
    );

    const link = screen.getByRole('link', { name: 'No Art' });
    expect(link.querySelector('img')).toBeNull();
    expect(screen.getAllByText('No Art')).toHaveLength(2);
  });

  it('says how much has been watched instead of an unlabeled progress bar, and names an episode with its caption', () => {
    const item: BaseItem = { ...movie, RunTimeTicks: 100, UserData: { PlaybackPositionTicks: 40 } };
    const { container } = render(
      <Card item={item} client={createFakeClient()} variant="landscape" caption="S1:E2" onSelect={vi.fn()} />,
    );

    expect(container.querySelector('.lmn-progress__fill')).toHaveStyle({ width: '40%' });
    expect(screen.queryByRole('progressbar')).toBeNull();
    const link = screen.getByRole('link', { name: /^Lumen Alpha ?S1:E2$/ });
    expect(link).toHaveAccessibleDescription('40% watched');
  });

  it("has no More button without a menu, and isn't described when there's nothing to add", () => {
    const video: BaseItem = { Id: 'v1', Name: 'Lumen Alpha', Type: 'Video' };
    render(<Card item={video} client={createFakeClient()} variant="poster" onSelect={vi.fn()} />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('link', { name: 'Lumen Alpha' })).not.toHaveAttribute('aria-describedby');
  });

  it("opens the card's menu from its More button, for keyboard and voice control users", async () => {
    const onSelect = vi.fn();
    const ctx = makeContext(createFakeClient());
    render(
      <>
        <Card
          item={movie}
          client={ctx.client}
          variant="poster"
          onSelect={onSelect}
          onMenu={cardMenuHandler(ctx)}
        />
        <ContextMenuHost />
      </>,
    );

    const more = screen.getByRole('button', { name: 'More options for Lumen Alpha' });
    expect(more).toHaveAttribute('aria-haspopup', 'menu');
    expect(more.closest('a')).toBeNull(); // not inside the link: no nested interactive content
    fireEvent.click(more);

    const menu = await screen.findByRole('menu', { name: 'Actions for Lumen Alpha' });
    expect(menu).toContainElement(screen.getByRole('menuitem', { name: 'More info' }));
    expect(onSelect).not.toHaveBeenCalled();
    // Closing it returns focus to the button.
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(more).toHaveFocus();
  });
});
