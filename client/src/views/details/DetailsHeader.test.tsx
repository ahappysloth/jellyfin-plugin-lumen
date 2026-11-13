import { act, fireEvent, render, screen } from '@testing-library/preact';
import { useEffect, useState } from 'preact/hooks';
import { describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import { testConfig } from '../../../test/viewContext';
import type { BaseItem, OnlineTrailer } from '../../api/types';
import { DetailsHeader } from './DetailsHeader';

interface MockProps {
  src?: string | null;
  paused?: boolean;
  muted?: boolean;
  onPlayingChange?: (on: boolean) => void;
}
const LocalMock = (props: MockProps) => {
  useEffect(() => props.onPlayingChange?.(true), []);
  return (
    <div
      data-testid="trailer"
      data-src={String(props.src)}
      data-paused={String(!!props.paused)}
      data-muted={String(!!props.muted)}
    />
  );
};

// The trailer itself is TrailerPreview's (and its tests'): here it plays at once and shows what it was asked. The
// Pause and Mute buttons are the real ones.
vi.mock('../home/TrailerPreview', async () => ({
  TrailerControls: (
    await vi.importActual<typeof import('../home/TrailerControls')>('../home/TrailerControls')
  ).TrailerControls,
  TrailerPreview: LocalMock,
  // As OnlineTrailerPreview: IMDb's in the local trailer's <video>, else YouTube's.
  OnlineTrailerPreview: (
    props: MockProps & { lookup: () => Promise<OnlineTrailer>; embedBase?: string | null; class?: string },
  ) => {
    const [found, setFound] = useState<OnlineTrailer | null>(null);
    useEffect(() => void props.lookup().then(setFound), []);
    if (!found) return null;
    if (found.ImdbUrl) return <LocalMock {...props} src={found.ImdbUrl} />;
    return found.YouTubeId ? <YouTubeMock {...props} youTubeId={found.YouTubeId} /> : null;
  },
}));
const YouTubeMock = (props: {
  youTubeId: string;
  embedBase?: string | null;
  class?: string;
  paused?: boolean;
  muted?: boolean;
  onPlayingChange?: (on: boolean) => void;
}) => {
  useEffect(() => props.onPlayingChange?.(true), []);
  return (
    <div
      data-testid="youtube-trailer"
      data-id={props.youTubeId}
      data-base={String(props.embedBase)}
      data-paused={String(!!props.paused)}
      data-muted={String(!!props.muted)}
      class={props.class}
    />
  );
};

const movie: BaseItem = { Id: 'm1', Name: 'Lumen Alpha', Type: 'Movie', ImageTags: { Logo: 'l' } };

function renderHeader(overrides: Partial<Parameters<typeof DetailsHeader>[0]> = {}) {
  return render(
    <DetailsHeader
      item={movie}
      client={createFakeClient()}
      config={testConfig}
      primary={null}
      trailerId={null}
      onBack={vi.fn()}
      badges={[]}
      played={false}
      favorite={false}
      error={null}
      toggleWatched={vi.fn()}
      toggleFavorite={vi.fn()}
      {...overrides}
    />,
  );
}

describe('DetailsHeader', () => {
  it('makes the title logo the page heading, named after the title', () => {
    renderHeader();

    const heading = screen.getByRole('heading', { level: 1, name: 'Lumen Alpha' });
    expect(heading).toContainElement(screen.getByRole('img', { name: 'Lumen Alpha' }));
  });

  it('offers Pause beside Mute while the trailer plays, and pauses it (WCAG 2.2.2)', async () => {
    renderHeader({ trailerId: 't1', config: { ...testConfig, TrailerPreview: true } });

    fireEvent.click(await screen.findByRole('button', { name: 'Pause trailer' }));
    expect(screen.getByTestId('trailer')).toHaveAttribute('data-paused', 'true');
    expect(screen.getByRole('button', { name: 'Unmute trailer' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Play trailer' }));
    expect(screen.getByTestId('trailer')).toHaveAttribute('data-paused', 'false');
  });

  it("plays the title's trailer from IMDb behind the header when it has no local one, with the same controls", async () => {
    const lookup = vi.fn(() =>
      Promise.resolve({ ImdbUrl: 'https://imdb-video.media-imdb.com/a.mp4', YouTubeId: null }),
    );
    renderHeader({
      onlineTrailer: lookup,
      config: { ...testConfig, TrailerPreview: true, YouTubeTrailers: true },
    });

    const trailer = await screen.findByTestId('trailer');
    expect(trailer).toHaveAttribute('data-src', 'https://imdb-video.media-imdb.com/a.mp4');
    expect(lookup).toHaveBeenCalledTimes(1);
    fireEvent.click(await screen.findByRole('button', { name: 'Pause trailer' }));
    expect(trailer).toHaveAttribute('data-paused', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Unmute trailer' }));
    expect(trailer).toHaveAttribute('data-muted', 'false');
  });

  it("plays the title's trailer from YouTube behind the header when it has no local one, with the same controls", async () => {
    renderHeader({
      onlineTrailer: () => Promise.resolve({ YouTubeId: 'dQw4w9WgXcQ' }),
      config: {
        ...testConfig,
        TrailerPreview: true,
        YouTubeTrailers: true,
        YouTubeEmbedBase: 'http://localhost:5055',
      },
    });

    const trailer = await screen.findByTestId('youtube-trailer');
    expect(trailer).toHaveAttribute('data-id', 'dQw4w9WgXcQ');
    expect(trailer).toHaveAttribute('data-base', 'http://localhost:5055');
    expect(trailer).toHaveClass('lmn-details__trailer');
    expect(trailer).toHaveAttribute('data-muted', 'true');
    // The preview only: the Trailer button plays a local trailer in the player, and there is none.
    expect(screen.queryByRole('button', { name: 'Trailer' })).toBeNull();

    fireEvent.click(await screen.findByRole('button', { name: 'Pause trailer' }));
    expect(trailer).toHaveAttribute('data-paused', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Unmute trailer' }));
    expect(trailer).toHaveAttribute('data-muted', 'false');
  });

  it('prefers the local trailer to one online, which it never asks for', async () => {
    const lookup = vi.fn(() => Promise.resolve({ YouTubeId: 'dQw4w9WgXcQ' }));
    renderHeader({
      item: { ...movie, LocalTrailerCount: 1 },
      trailerId: 't1',
      onlineTrailer: lookup,
      config: { ...testConfig, TrailerPreview: true, YouTubeTrailers: true },
    });

    expect(await screen.findByTestId('trailer')).toHaveAttribute('data-src', 'undefined');
    expect(screen.queryByTestId('youtube-trailer')).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('asks for no trailer online with previews or online trailers off', async () => {
    const lookup = vi.fn(() => Promise.resolve({ YouTubeId: 'dQw4w9WgXcQ' }));
    renderHeader({
      onlineTrailer: lookup,
      config: { ...testConfig, TrailerPreview: false, YouTubeTrailers: true },
    });
    renderHeader({
      onlineTrailer: lookup,
      config: { ...testConfig, TrailerPreview: true, YouTubeTrailers: false },
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.queryByTestId('youtube-trailer')).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('offers the file as a Download link beside Play, named as it reads, its tooltip saying the size', () => {
    renderHeader({
      download: { url: 'http://jf/Items/m1/Download?ApiKey=token1', title: 'Download (4.2 GB)' },
    });

    const link = screen.getByRole('link', { name: 'Download' });
    expect(link).toHaveAttribute('href', 'http://jf/Items/m1/Download?ApiKey=token1');
    expect(link).toHaveAttribute('download');
    expect(link).toHaveAttribute('title', 'Download (4.2 GB)');
    expect(link).toHaveTextContent('Download');
  });

  it('offers no Download where the page has none to give (a series, a TV, a user who may not download)', () => {
    renderHeader();
    expect(screen.queryByRole('link', { name: 'Download' })).toBeNull();
  });

  it("lets the official apps' shell save the file instead of following the link", () => {
    const downloadFiles = vi.fn();
    Object.assign(window, { NativeShell: { downloadFiles } });
    try {
      renderHeader({ download: { url: 'http://jf/dl', title: 'Download' } });

      const followed = fireEvent.click(screen.getByRole('link', { name: 'Download' }));

      expect(followed).toBe(false); // default prevented
      expect(downloadFiles).toHaveBeenCalledWith([
        expect.objectContaining({ url: 'http://jf/dl', itemId: 'm1' }),
      ]);
    } finally {
      delete (window as Window & { NativeShell?: unknown }).NativeShell;
    }
  });

  it('names Favorite and Watched as they read, their label saying the state (WCAG 2.5.3)', () => {
    const { rerender } = renderHeader();
    expect(screen.getByRole('button', { name: 'Favorite' })).toHaveTextContent('Favorite');
    expect(screen.getByRole('button', { name: 'Mark watched' })).toHaveTextContent('Mark watched');

    rerender(
      <DetailsHeader
        item={movie}
        client={createFakeClient()}
        config={testConfig}
        primary={null}
        trailerId={null}
        onBack={vi.fn()}
        badges={[]}
        played
        favorite
        error={null}
        toggleWatched={vi.fn()}
        toggleFavorite={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Favorited' })).toHaveTextContent('Favorited');
    expect(screen.getByRole('button', { name: 'Watched' })).toHaveTextContent('Watched');
    // Not toggle buttons as well: their name would then change with their state.
    for (const name of ['Favorited', 'Watched'])
      expect(screen.getByRole('button', { name })).not.toHaveAttribute('aria-pressed');
  });

  it('shows More only with actions to offer, and opens them under it', () => {
    const { rerender } = renderHeader();
    expect(screen.queryByRole('button', { name: /^More/ })).toBeNull();

    const open = vi.fn();
    const more = { item: movie, commands: ['edit' as const], dialogs: true, open };
    rerender(
      <DetailsHeader
        item={movie}
        client={createFakeClient()}
        config={testConfig}
        primary={null}
        trailerId={null}
        onBack={vi.fn()}
        badges={[]}
        played={false}
        favorite={false}
        error={null}
        toggleWatched={vi.fn()}
        toggleFavorite={vi.fn()}
        more={more}
      />,
    );
    // Named for its title, and expanded while its menu is open, as the Dropdown is.
    const button = screen.getByRole('button', { name: `More actions for ${movie.Name}` });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ returnFocus: button, anchor: button }));
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const { onClose } = (open.mock.calls[0] as unknown as [{ onClose: () => void }])[0];
    act(() => onClose());
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });
});
