import { fireEvent, render, screen } from '@testing-library/preact';
import { useEffect } from 'preact/hooks';
import { describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import { testConfig } from '../../../test/viewContext';
import type { BaseItem } from '../../api/types';
import { DetailsHeader } from './DetailsHeader';

// The trailer itself is TrailerPreview's (and its tests'): here it plays at once and shows what it was asked.
vi.mock('../home/TrailerPreview', () => ({
  TrailerPreview: (props: { paused?: boolean; muted?: boolean; onPlayingChange?: (on: boolean) => void }) => {
    useEffect(() => props.onPlayingChange?.(true), []);
    return (
      <div data-testid="trailer" data-paused={String(!!props.paused)} data-muted={String(!!props.muted)} />
    );
  },
}));

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

  it('names Favorite and Watched as they read, pressed or not (WCAG 2.5.3)', () => {
    const { rerender } = renderHeader();
    expect(screen.getByRole('button', { name: 'Favorite', pressed: false })).toHaveTextContent('Favorite');
    expect(screen.getByRole('button', { name: 'Mark watched', pressed: false })).toHaveTextContent(
      'Mark watched',
    );

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
    expect(screen.getByRole('button', { name: 'Favorited', pressed: true })).toHaveTextContent('Favorited');
    expect(screen.getByRole('button', { name: 'Watched', pressed: true })).toHaveTextContent('Watched');
  });
});
