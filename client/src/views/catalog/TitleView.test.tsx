import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext, testConfig } from '../../../test/viewContext';
import type { CatalogTitle } from '../../api/types';
import type { AjaxRequest } from '../../compat/jellyfin';
import { myRequest } from '../../../test/myRequest';
import type { MyRequest } from '../../api/types';
import { clearRequestStatus } from './catalog';
import { refreshRequestProgress, reset, startRequestProgress } from './requestProgress';
import { ContextMenuHost } from '../../components/ContextMenu';
import { ToastHost } from '../../components/Toast';
import type { TrailerInfoResponse } from '../trailerInfo/TrailerInfo';
import { strings } from '../../strings';
import { TitleView } from './TitleView';

// Trailer info's stylesheet: jsdom never loads one (and the dialog doesn't wait on it in a browser either).
const styles = vi.hoisted(() => ({ fail: false }));
vi.mock('../../util/loadStyles', () => ({
  loadStyles: () => (styles.fail ? Promise.reject(new Error('offline')) : Promise.resolve()),
}));

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

  it("follows the user's own request live, and links to the library once it's ready", async () => {
    let answer: MyRequest = myRequest({ Percent: 40, SecondsLeft: 600 });
    let ready = false;
    const client = createFakeClient(
      routes({
        'Lumen/Requests/Title/movie/603': () =>
          ready
            ? { ...movie, State: 'Available', JellyfinItemId: 'abc' }
            : { ...movie, State: 'Downloading' },
        'Lumen/Requests/Mine': () => ({ Requests: [answer] }),
        'Lumen/Requests/Status': {
          Enabled: true,
          CanRequestMovies: true,
          CanRequestTv: true,
          ImageToken: 't',
        },
      }),
    );
    const ctx = makeContext(client, { config: { ...testConfig, Requests: true } });
    startRequestProgress(ctx);
    await act(() => refreshRequestProgress());
    render(<TitleView mediaType="movie" tmdbId={603} ctx={ctx} />);

    try {
      // The word, bar and detail its row in My requests shows, on a link to that row.
      const status = await screen.findByRole('link', { name: 'Downloading, My requests' });
      expect(status).toHaveAttribute('href', '#/home?lumen=requests&request=movie-603');
      expect(status).toHaveAccessibleDescription('40% · 10 min left');
      expect(status.querySelector<HTMLElement>('.lmn-progress__fill')!.style.width).toBe('40%');
      // Its progress replaces the plain state.
      expect(screen.queryByRole('status')).toBeNull();

      answer = myRequest({ Percent: 75, SecondsLeft: 120 });
      await act(() => refreshRequestProgress());
      expect(status).toHaveAccessibleDescription('75% · 2 min left');
      expect(status.querySelector<HTMLElement>('.lmn-progress__fill')!.style.width).toBe('75%');

      // Imported: still Downloading, as in My requests, with what's happening under it.
      answer = myRequest({ Status: 'Processing', Percent: 100, SecondsLeft: null });
      await act(() => refreshRequestProgress());
      expect(status).toHaveAccessibleName('Downloading, My requests');
      expect(status).toHaveAccessibleDescription('Adding to your library');

      ready = true;
      answer = myRequest({ Status: 'Ready', Percent: null, SecondsLeft: null });
      await act(() => refreshRequestProgress());
      expect(await screen.findByRole('button', { name: 'Open in library' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /My requests/ })).toBeNull();
    } finally {
      reset();
    }
  });

  it.each([
    ['Requested', 'Pending', 'Waiting for approval.'],
    ['Queued', 'Queued', 'Waiting to download'],
    ['Declined', 'Declined', 'Your request was declined.'],
    ['Failed', 'Failed', 'The request failed. Ask the server owner to look at it.'],
  ] as const)('a request %s says %s, as its row does, and links to it', async (Status, word, detail) => {
    const client = createFakeClient(
      routes({
        'Lumen/Requests/Title/movie/603': { ...movie, State: 'Requested', CanRequest: false },
        'Lumen/Requests/Mine': { Requests: [myRequest({ Status, Percent: null, SecondsLeft: null })] },
        'Lumen/Requests/Status': {
          Enabled: true,
          CanRequestMovies: true,
          CanRequestTv: true,
          ImageToken: 't',
        },
      }),
    );
    const ctx = makeContext(client, { config: { ...testConfig, Requests: true } });
    startRequestProgress(ctx);
    await act(() => refreshRequestProgress());
    try {
      render(<TitleView mediaType="movie" tmdbId={603} ctx={ctx} />);
      const status = await screen.findByRole('link', { name: `${word}, My requests` });
      expect(status).toHaveAttribute('href', '#/home?lumen=requests&request=movie-603');
      expect(status).toHaveAccessibleDescription(detail);
      expect(status.querySelector('.lmn-progress')).toBeNull();
    } finally {
      reset();
    }
  });

  it('shows the title with Request, trailer link, cast and recommendations', async () => {
    setup(movie, () => ({}));

    expect(await screen.findByRole('heading', { name: 'The Matrix', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('2h 16m')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Trailer' })).toHaveAttribute('href', movie.TrailerUrl!);
    expect(screen.getByText('Keanu Reeves')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reloaded, Requested' })).toBeInTheDocument();
  });

  it("loads art with the user's image token, never the access token", async () => {
    const client = createFakeClient(
      routes({
        [`Lumen/Requests/Title/movie/603`]: movie,
        'Lumen/Requests/Status': {
          Enabled: true,
          CanRequestMovies: true,
          CanRequestTv: true,
          ImageToken: 'img1',
        },
      }),
    );
    const { container } = render(<TitleView mediaType="movie" tmdbId={603} ctx={makeContext(client)} />);

    await waitFor(() => expect(container.querySelector('.lmn-details__backdrop')).not.toBeNull());
    const sources = [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(sources).toContain('http://jf/Lumen/Requests/Image/w1280/b.jpg?t=img1');
    expect(sources).toContain('http://jf/Lumen/Requests/Image/w185/k.jpg?t=img1');
    expect(sources.join(' ')).not.toContain('token1');
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

  it("can't be closed while the request is sending", async () => {
    let finish: (value: unknown) => void = () => {};
    setup(movie, () => new Promise((resolve) => (finish = resolve)));

    fireEvent.click(await screen.findByRole('button', { name: 'Request' }));
    const dialog = screen.getByRole('dialog', { name: 'Request The Matrix' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Request' }));

    expect(await within(dialog).findByRole('button', { name: 'Requesting…' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();

    finish({ State: 'Requested', NeedsApproval: false });
    expect(await within(dialog).findByRole('button', { name: 'Close' })).toBeEnabled();
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

  it('offers Try again and Back when the title fails to load', async () => {
    let fail = true;
    const client = createFakeClient(
      routes({
        [`Lumen/Requests/Title/movie/603`]: () => (fail ? Promise.reject(new Error('offline')) : movie),
      }),
    );
    render(<TitleView mediaType="movie" tmdbId={603} ctx={makeContext(client)} />);

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load this title from Seerr.");
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'The Matrix' })).toBeInTheDocument();
  });

  describe('a trailer online ("Use online trailers")', () => {
    const online = { ...testConfig, TrailerPreview: true, YouTubeTrailers: true };
    const URL_720 = 'https://imdb-video.media-imdb.com/vi1/a.mp4?Expires=1&Signature=s';
    const open = (trailer: () => unknown, overrides: Parameters<typeof makeContext>[1] = {}) => {
      const client = createFakeClient(
        routes({
          'Lumen/Requests/Title/movie/603': movie,
          'Lumen/Requests/Title/movie/603/Trailer': trailer,
        }),
      );
      return render(
        <TitleView
          mediaType="movie"
          tmdbId={603}
          ctx={makeContext(client, { config: online, ...overrides })}
        />,
      );
    };

    it("plays IMDb's behind the header, with Pause and Mute once it shows", async () => {
      const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined); // jsdom has no media playback
      const time = vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'get').mockReturnValue(0);
      try {
        const asked = vi.fn(() => ({ ImdbUrl: URL_720, YouTubeId: null }));
        const { container } = open(asked);
        await screen.findByRole('heading', { name: 'The Matrix' });
        const header = container.querySelector('.lmn-details__header')!;

        const video = await waitFor(
          () => {
            const found = header.querySelector<HTMLVideoElement>('.lmn-details__trailer video');
            expect(found).not.toBeNull();
            return found!;
          },
          { timeout: 4000 },
        );
        expect(video.getAttribute('src')).toBe(URL_720);
        expect(video.muted).toBe(true);
        expect(asked).toHaveBeenCalledTimes(1);
        // No controls while it loads: nothing shows yet.
        expect(screen.queryByRole('button', { name: 'Pause trailer' })).toBeNull();
        // In place to load during the delay, then played.
        await waitFor(() => expect(play).toHaveBeenCalled(), { timeout: 4000 });

        time.mockReturnValue(0.5);
        act(() => {
          video.dispatchEvent(new Event('timeupdate'));
        });
        expect(header).toHaveClass('is-playing');
        const pause = screen.getByRole('button', { name: 'Pause trailer' });
        const pauseVideo = vi.spyOn(HTMLMediaElement.prototype, 'pause');
        fireEvent.click(pause);
        expect(pauseVideo).toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Play trailer' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Unmute trailer' }));
        expect(video.muted).toBe(false);
        expect(screen.getByRole('button', { name: 'Mute trailer' })).toBeInTheDocument();
        // The YouTube link stays: it opens the trailer with sound, on YouTube.
        expect(screen.getByRole('link', { name: 'Trailer' })).toBeInTheDocument();
      } finally {
        vi.restoreAllMocks();
      }
    });

    it("plays YouTube's when IMDb has none, but not on a TV", async () => {
      const youTube = () => ({ ImdbUrl: null, YouTubeId: 'dQw4w9WgXcQ' });
      const { container, unmount } = open(youTube);
      await waitFor(() => expect(container.querySelector('.lmn-details__trailer iframe')).not.toBeNull(), {
        timeout: 4000,
      });
      unmount();

      // The TV layout as jellyfin-web marks it, which the preview reads (as the hero does).
      document.documentElement.classList.add('layout-tv');
      try {
        const asked = vi.fn(youTube);
        const tv = open(asked, { layout: 'tv' });
        await screen.findByRole('heading', { name: 'The Matrix' });
        await waitFor(() => expect(asked).toHaveBeenCalled());
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
        });
        expect(tv.container.querySelector('.lmn-details__trailer')).toBeNull();
      } finally {
        document.documentElement.classList.remove('layout-tv');
      }
    });

    it('asks for nothing with the setting or previews off', async () => {
      for (const config of [
        { ...online, YouTubeTrailers: false },
        { ...online, TrailerPreview: false },
      ]) {
        const asked = vi.fn(() => ({ ImdbUrl: URL_720 }));
        const view = open(asked, { config });
        await screen.findByRole('heading', { name: 'The Matrix' });
        expect(view.container.querySelector('.lmn-details__trailer')).toBeNull();
        expect(asked).not.toHaveBeenCalled();
        view.unmount();
      }
    });
  });

  describe('More', () => {
    const info: TrailerInfoResponse = {
      Previews: true,
      OnlineTrailers: true,
      LocalTrailer: null,
      Skipped: null,
      Imdb: { Id: 'tt0133093', Status: 'found', Qualities: ['1080p'], Cached: true },
      YouTube: { Status: 'found', VideoId: 'dQw4w9WgXcQ', Source: 'seerr', Cached: true },
      CanRefresh: true,
    };
    const open = (config: Partial<typeof testConfig>, answer: TrailerInfoResponse = info) => {
      const client = createFakeClient(
        routes({
          'Lumen/Requests/Title/movie/603': movie,
          'Lumen/Requests/Title/movie/603/TrailerInfo': answer,
          'Lumen/Requests/Title/movie/603/TrailerInfo/Refresh': { ...answer, CanRefresh: true },
          'Lumen/Requests/Title/movie/603/Trailer': { ImdbUrl: null, YouTubeId: null },
        }),
      );
      const ctx = makeContext(client, { config: { ...testConfig, ...config } });
      render(
        <>
          <TitleView mediaType="movie" tmdbId={603} ctx={ctx} />
          <ContextMenuHost />
          <ToastHost />
        </>,
      );
      return { client };
    };
    const more = () => screen.findByRole('button', { name: 'More actions for The Matrix' });

    afterEach(() => {
      styles.fail = false;
      sessionStorage.clear();
      document.body.innerHTML = '';
    });

    it('is offered with trailer previews on, as on a library title’s page, and not without', async () => {
      open({ TrailerPreview: false });
      await screen.findByRole('heading', { name: 'The Matrix' });
      expect(screen.queryByRole('button', { name: 'More actions for The Matrix' })).toBeNull();
      document.body.innerHTML = '';

      open({ TrailerPreview: true });
      const button = await more();
      expect(button.getAttribute('aria-haspopup')).toBe('menu');
      // Last of the header's buttons, after Trailer.
      const actions = [...button.parentElement!.children];
      expect(actions[actions.length - 1]).toBe(button);
    });

    it('has Trailer info, which opens the title’s trailer status in a dialog, and gives focus back to More', async () => {
      const { client } = open({ TrailerPreview: true, YouTubeTrailers: true });
      const button = await more();
      button.focus();
      fireEvent.click(button);
      expect(button.getAttribute('aria-expanded')).toBe('true');
      fireEvent.click(screen.getByRole('menuitem', { name: 'Trailer info' }));

      const dialog = await screen.findByRole('dialog', { name: 'Trailer info: The Matrix' });
      await within(dialog).findByText('Found: 1080p available');
      expect(dialog.textContent).toContain('tt0133093');
      expect(dialog.textContent).toContain('from Seerr (TMDB)');
      // This page's own attempt (its trailer looked up as it opened: here, the server had none), under the title's key.
      expect(dialog.textContent).toContain('The server had no trailer to play');
      expect(client.requests.map((r) => r.url)).toContain(
        client.getUrl('Lumen/Requests/Title/movie/603/TrailerInfo'),
      );
      expect(button.getAttribute('aria-expanded')).toBe('false');

      // An administrator's Check again asks the catalog title's Refresh.
      fireEvent.click(within(dialog).getByRole('button', { name: 'Check again' }));
      await within(dialog).findByText('Checked again');
      expect(client.requests.some((r) => r.type === 'POST' && r.url.endsWith('/TrailerInfo/Refresh'))).toBe(
        true,
      );

      fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Check again' }), { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(button);
    });

    it('says so when online trailers are off, as the library’s does', async () => {
      open(
        { TrailerPreview: true, YouTubeTrailers: false },
        {
          ...info,
          OnlineTrailers: false,
          Imdb: { Id: 'tt0133093', Status: 'skipped', Qualities: [], Cached: false },
          YouTube: { Status: 'skipped', Cached: false },
          CanRefresh: false,
        },
      );
      fireEvent.click(await more());
      fireEvent.click(screen.getByRole('menuitem', { name: 'Trailer info' }));
      const dialog = await screen.findByRole('dialog', { name: 'Trailer info: The Matrix' });
      await within(dialog).findByText('Off (“Use online trailers” is off)');
      expect(within(dialog).queryByRole('button', { name: 'Check again' })).toBeNull();
    });

    it('says the dialog couldn’t open when its file can’t load', async () => {
      styles.fail = true;
      open({ TrailerPreview: true });
      fireEvent.click(await more());
      fireEvent.click(screen.getByRole('menuitem', { name: 'Trailer info' }));
      await screen.findByText(strings.itemMenuFailed);
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});
