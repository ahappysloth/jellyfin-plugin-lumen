import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import type { CatalogTitle } from '../../api/types';
import type { AjaxRequest } from '../../compat/jellyfin';
import { clearRequestStatus } from './catalog';
import { TitleView } from './TitleView';

const movie: CatalogTitle = {
  Key: 'movie-603',
  MediaType: 'movie',
  TmdbId: 603,
  Title: 'The Matrix',
  Year: 1999,
  Overview: 'A hacker learns the truth.',
  Rating: 8.2,
  GenreNames: ['Action'],
  Poster: 'p.jpg',
  Backdrop: 'b.jpg',
  State: 'None',
  Runtime: 136,
  TrailerUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  Cast: [{ TmdbId: 1, Name: 'Keanu Reeves', Character: 'Neo', Photo: 'k.jpg' }],
  Seasons: [],
  Recommendations: [
    {
      Key: 'movie-604',
      MediaType: 'movie',
      TmdbId: 604,
      Title: 'Reloaded',
      GenreNames: [],
      State: 'Requested',
    },
  ],
  CanRequest: true,
};

const show: CatalogTitle = {
  ...movie,
  Key: 'tv-1399',
  MediaType: 'tv',
  TmdbId: 1399,
  Title: 'Lumen Saga',
  State: 'PartlyAvailable',
  Runtime: null,
  Seasons: [
    { Number: 1, Name: 'Season 1', EpisodeCount: 10, State: 'Available' },
    { Number: 2, Name: 'Season 2', EpisodeCount: 10, State: 'Requested' },
    { Number: 3, Name: 'Season 3', EpisodeCount: 8, State: 'None' },
    { Number: 4, Name: 'Season 4', EpisodeCount: 8, State: 'None' },
  ],
};

function setup(title: CatalogTitle, post: (r: AjaxRequest) => unknown) {
  const client = createFakeClient(
    routes({ [`Lumen/Requests/Title/${title.MediaType}/${title.TmdbId}`]: title, 'Lumen/Requests': post }),
  );
  const ctx = makeContext(client);
  render(<TitleView mediaType={title.MediaType} tmdbId={title.TmdbId} ctx={ctx} />);
  return { client, ctx };
}

describe('TitleView', () => {
  afterEach(() => clearRequestStatus());

  it('shows the title with Request, trailer link, cast and recommendations', async () => {
    setup(movie, () => ({}));

    expect(await screen.findByRole('heading', { name: 'The Matrix', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('2h 16m')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Trailer' })).toHaveAttribute('href', movie.TrailerUrl!);
    expect(screen.getByText('Keanu Reeves')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reloaded, Requested' })).toBeInTheDocument();
  });

  it('requests a movie and shows the outcome and the new state', async () => {
    const { client } = setup(movie, () => ({ State: 'Requested', NeedsApproval: true }));

    fireEvent.click(await screen.findByRole('button', { name: 'Request' }));
    const dialog = screen.getByRole('dialog', { name: 'Request The Matrix' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Request' }));

    expect(await within(dialog).findByText('Requested, waiting for approval.')).toBeInTheDocument();
    const post = client.requests.find((r) => r.type === 'POST')!;
    expect(JSON.parse(post.data!)).toEqual({ MediaType: 'movie', TmdbId: 603, Seasons: null });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('status')).toHaveTextContent('Requested');
    expect(screen.queryByRole('button', { name: 'Request' })).toBeNull();
  });

  it('requests only the chosen seasons of a show, with available and requested ones locked', async () => {
    const { client } = setup(show, () => ({ State: 'PartlyAvailable', NeedsApproval: false }));

    fireEvent.click(await screen.findByRole('button', { name: 'Request more seasons' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('checkbox', { name: /Season 1/ })).toBeDisabled();
    expect(within(dialog).getByRole('checkbox', { name: /Season 2/ })).toBeDisabled();
    expect(within(dialog).getByRole('checkbox', { name: /All seasons/ })).toBeChecked();

    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Season 4/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Request' }));

    expect(await within(dialog).findByText(/Requested. It will appear/)).toBeInTheDocument();
    const post = client.requests.find((r) => r.type === 'POST')!;
    expect(JSON.parse(post.data!)).toEqual({ MediaType: 'tv', TmdbId: 1399, Seasons: [3] });
  });

  it("shows Seerr's refusal in the dialog", async () => {
    setup(movie, () =>
      Promise.reject(new Response(JSON.stringify({ Error: 'Quota exceeded' }), { status: 403 })),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Request' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Request' }));

    expect(await within(dialog).findByText('Quota exceeded')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('links an owned title to its library page instead of offering a request', async () => {
    const { ctx } = setup(
      { ...movie, State: 'Available', JellyfinItemId: 'abc', CanRequest: false },
      () => ({}),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Open in library' }));
    expect(ctx.navigate).toHaveBeenCalledWith('#/details?id=abc');
  });

  it('explains when the user may not request', async () => {
    setup({ ...movie, CanRequest: false }, () => ({}));

    expect(await screen.findByText(/can't request this/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Request' })).toBeNull());
  });
});
