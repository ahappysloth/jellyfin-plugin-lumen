import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import type { BaseItem } from '../../api/types';
import { DetailsView } from './DetailsView';

const movie: BaseItem = {
  Id: 'm1',
  Name: 'Lumen Alpha',
  Type: 'Movie',
  ServerId: 's',
  Overview: 'A test movie.',
  ProductionYear: 2001,
  RunTimeTicks: 1000,
  LocalTrailerCount: 1,
  BackdropImageTags: ['b'],
  UserData: { PlaybackPositionTicks: 400, Played: false, IsFavorite: false },
  MediaStreams: [{ Type: 'Video', Width: 1920 }],
  People: [{ Id: 'p1', Name: 'Jane Doe', Role: 'Hero', Type: 'Actor' }],
};

function client() {
  return createFakeClient(
    routes({
      'Items/m1': movie,
      'Items/m1/LocalTrailers': [{ Id: 't1', Name: 'Trailer', Type: 'Trailer' }],
      'Items/m1/Similar': { Items: [{ Id: 'm2', Name: 'Lumen Beta', Type: 'Movie', ServerId: 's' }] },
      Sessions: [{ Id: 's1', DeviceId: 'dev+ice' }],
      'Sessions/s1/Playing': {},
      'UserPlayedItems/m1': {},
      'UserFavoriteItems/m1': {},
    }),
  );
}

describe('DetailsView', () => {
  it('renders a movie with resume, trailer, badges, cast, and similar titles', async () => {
    render(<DetailsView id="m1" ctx={makeContext(client())} />);

    expect(await screen.findByRole('heading', { name: 'Lumen Alpha' })).toBeInTheDocument();
    expect(screen.getByText('A test movie.')).toBeInTheDocument();
    expect(screen.getByText('HD')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Resume/ })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Trailer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Jane Doe/ })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Lumen Beta' })).toBeInTheDocument();
  });

  it('resumes from the saved position', async () => {
    const c = client();
    render(<DetailsView id="m1" ctx={makeContext(c)} />);

    fireEvent.click(await screen.findByRole('button', { name: /Resume/ }));

    await waitFor(() =>
      expect(c.requests.some((r) => r.url.includes('itemIds=m1&startPositionTicks=400'))).toBe(true),
    );
  });

  it('toggles watched optimistically', async () => {
    const c = client();
    render(<DetailsView id="m1" ctx={makeContext(c)} />);

    const watched = await screen.findByRole('button', { name: 'Mark as watched' });
    fireEvent.click(watched);

    expect(watched).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() =>
      expect(c.requests.some((r) => r.type === 'POST' && r.url.includes('UserPlayedItems/m1'))).toBe(true),
    );
  });

  it('shows an inline error when playback cannot start', async () => {
    const c = client();
    c.respond = routes({
      'Items/m1': movie,
      'Items/m1/LocalTrailers': [],
      'Items/m1/Similar': { Items: [] },
      Sessions: [],
    });
    render(<DetailsView id="m1" ctx={makeContext(c)} />);

    fireEvent.click(await screen.findByRole('button', { name: /Resume/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't start playback");
  });

  it('hands unsupported item types back to the stock page', async () => {
    const ctx = makeContext(
      createFakeClient(routes({ 'Items/x1': { Id: 'x1', Name: 'Song', Type: 'Audio' } })),
    );
    render(<DetailsView id="x1" ctx={ctx} />);

    await waitFor(() => expect(ctx.onFallback).toHaveBeenCalled());
  });

  it('falls back when the item cannot be loaded', async () => {
    const ctx = makeContext(createFakeClient(() => Promise.reject(new Error('404'))));
    render(<DetailsView id="m1" ctx={ctx} />);

    await waitFor(() => expect(ctx.onFallback).toHaveBeenCalled());
  });
});
