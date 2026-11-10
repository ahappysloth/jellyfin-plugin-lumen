import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../test/fakeClient';
import type { BaseItem } from '../api/types';
import { EpisodeList } from '../views/details/EpisodeList';
import { GenreTile } from '../views/home/Row';
import { Card } from './Card';

const movie: BaseItem = { Id: 'm1', Name: 'Lumen Alpha', Type: 'Movie', ImageTags: { Primary: 'tag1' } };

describe('Card', () => {
  it('renders a lazy poster image and selects on click', () => {
    const onSelect = vi.fn();
    render(<Card item={movie} client={createFakeClient()} variant="poster" onSelect={onSelect} />);

    const button = screen.getByRole('button', { name: 'Lumen Alpha' });
    const img = button.querySelector('img')!;
    expect(img.getAttribute('src')).toContain('Items/m1/Images/Primary');
    expect(img.getAttribute('loading')).toBe('lazy');
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith(movie);
  });

  it('shows a badge, the title and a rating · year · type meta line', () => {
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

    const sources = [...screen.getByRole('button').querySelectorAll('img')].map((i) => i.getAttribute('src'));
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

  it('renders a title placeholder when the item has no image', () => {
    render(
      <Card
        item={{ Id: 'x', Name: 'No Art', Type: 'Movie' }}
        client={createFakeClient()}
        variant="poster"
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole('button').querySelector('img')).toBeNull();
    expect(screen.getAllByText('No Art').length).toBeGreaterThan(0);
  });

  it('shows progress for partially watched items and includes the caption in its label', () => {
    const item: BaseItem = { ...movie, RunTimeTicks: 100, UserData: { PlaybackPositionTicks: 40 } };
    render(
      <Card item={item} client={createFakeClient()} variant="landscape" caption="S1:E2" onSelect={vi.fn()} />,
    );

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByRole('button', { name: 'Lumen Alpha, S1:E2' })).toBeInTheDocument();
  });
});
