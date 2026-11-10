import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { setJellyfinLocale } from '../../../test/locale';
import { makeContext, testConfig } from '../../../test/viewContext';
import type { BaseItem } from '../../api/types';
import * as compat from '../../compat/playbackManager';
import { PAGE_SIZE } from '../browse/useBrowseItems';
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
  it('lets its trailer preview be transcoded when the browser cannot play the file (HEVC in Matroska, Safari)', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
    );
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockImplementation((type) =>
      /^video\/mp4; codecs="avc1\.64|^application\/vnd\.apple\.mpegurl$/.test(type) ? 'maybe' : '',
    );
    const c = createFakeClient(
      routes({
        'Items/m1': movie,
        'Items/m1/LocalTrailers': [{ Id: 't1', Name: 'Trailer', Type: 'Trailer' }],
        'Items/t1': {
          Id: 't1',
          Name: 'Trailer',
          Type: 'Trailer',
          MediaSources: [
            {
              Id: 't1',
              Container: 'mkv',
              MediaStreams: [
                { Type: 'Video', Codec: 'hevc', Profile: 'Main 10', Level: 150, BitDepth: 10 },
                { Type: 'Audio', Codec: 'aac', Profile: 'LC' },
              ],
            },
          ],
        },
        'Items/m1/Similar': { Items: [] },
        'Videos/ActiveEncodings': undefined,
      }),
    );
    const { container, unmount } = render(
      <DetailsView id="m1" ctx={makeContext(c, { config: { ...testConfig, TrailerPreview: true } })} />,
    );

    await waitFor(() => expect(container.querySelector('video')).not.toBeNull(), { timeout: 4000 });
    expect(container.querySelector('video')!.getAttribute('src')).toContain('/Videos/t1/master.m3u8?');
    unmount();
    vi.restoreAllMocks();
  });

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

  it('shows Starting… on the Resume button until the player has started', async () => {
    let started: (value: unknown) => void = () => {};
    const c = createFakeClient(
      routes({
        'Items/m1': movie,
        'Items/m1/LocalTrailers': [],
        'Items/m1/Similar': { Items: [] },
        Sessions: [{ Id: 's1', DeviceId: 'dev+ice' }],
        'Sessions/s1/Playing': () => new Promise((resolve) => (started = resolve)),
      }),
    );
    render(<DetailsView id="m1" ctx={makeContext(c)} />);

    fireEvent.click(await screen.findByRole('button', { name: /Resume/ }));

    const busy = await screen.findByRole('button', { name: /Starting/ });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    started({});
    expect(await screen.findByRole('button', { name: /Resume/ })).toBeEnabled();
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

    const watched = await screen.findByRole('button', { name: 'Mark watched' });
    fireEvent.click(watched);

    expect(watched).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() =>
      expect(c.requests.some((r) => r.type === 'POST' && r.url.includes('UserPlayedItems/m1'))).toBe(true),
    );
  });

  it('offers Start over beside Resume, playing from the beginning', async () => {
    const play = vi.fn(async () => undefined);
    vi.spyOn(compat, 'getPlaybackManager').mockReturnValue({ play } as unknown as compat.PlaybackManager);
    const c = client();
    Object.assign(c, { serverId: () => 's1' });
    c.respond = routes({
      'Items/m1': movie,
      'Items/m1/LocalTrailers': [],
      'Items/m1/Similar': { Items: [] },
    });
    render(<DetailsView id="m1" ctx={makeContext(c)} />);

    fireEvent.click(await screen.findByRole('button', { name: /Resume/ }));
    await waitFor(() =>
      expect(play).toHaveBeenCalledWith(expect.objectContaining({ ids: ['m1'], startPositionTicks: 400 })),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start over' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    await waitFor(() =>
      expect(play).toHaveBeenLastCalledWith(
        expect.objectContaining({ ids: ['m1'], startPositionTicks: undefined }),
      ),
    );
  });

  it("hands the page's fully loaded movie to the player and plays its trailer by id", async () => {
    const play = vi.fn<(options: unknown) => Promise<void>>(async () => undefined);
    vi.spyOn(compat, 'getPlaybackManager').mockReturnValue({ play } as unknown as compat.PlaybackManager);
    const full: BaseItem = {
      ...movie,
      ServerId: 's1',
      MediaType: 'Video',
      IsFolder: false,
      Chapters: [],
      MediaSources: [{ Id: 'm1' }],
      Trickplay: {},
    };
    const c = Object.assign(
      createFakeClient(
        routes({
          'Items/m1': full,
          'Items/m1/LocalTrailers': [{ Id: 't1', Name: 'Trailer', Type: 'Trailer' }],
          'Items/m1/Similar': { Items: [] },
        }),
      ),
      { serverId: () => 's1' },
    );
    render(<DetailsView id="m1" ctx={makeContext(c)} />);

    fireEvent.click(await screen.findByRole('button', { name: /Resume/ }));
    await waitFor(() =>
      expect(play).toHaveBeenCalledWith({
        items: [expect.objectContaining({ Id: 'm1', Chapters: [] })],
        startPositionTicks: 400,
        serverId: 's1',
      }),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Trailer' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Trailer' }));
    await waitFor(() =>
      expect(play).toHaveBeenLastCalledWith({ ids: ['t1'], startPositionTicks: undefined, serverId: 's1' }),
    );
    expect(c.requests.filter((r) => r.url.includes('Items/m1?'))).toHaveLength(1);
  });

  it("hands the page's fully loaded episode to the player", async () => {
    const play = vi.fn(async () => undefined);
    vi.spyOn(compat, 'getPlaybackManager').mockReturnValue({ play } as unknown as compat.PlaybackManager);
    const full: BaseItem = {
      Id: 'e1',
      Name: 'Pilot',
      Type: 'Episode',
      MediaType: 'Video',
      IsFolder: false,
      ServerId: 's1',
      SeriesId: 'sr',
      SeriesName: 'Lumen Show',
      SeasonId: 'sn1',
      ParentIndexNumber: 1,
      IndexNumber: 1,
      UserData: { PlaybackPositionTicks: 0, Played: false },
      Chapters: [],
      MediaSources: [{ Id: 'e1' }],
      Trickplay: {},
    };
    const c = Object.assign(
      createFakeClient(
        routes({
          'Items/e1': full,
          'Items/sr': { Id: 'sr', Name: 'Lumen Show', Type: 'Series', ServerId: 's1' },
          'Shows/sr/Seasons': { Items: [{ Id: 'sn1', Name: 'Season 1', Type: 'Season', IndexNumber: 1 }] },
          'Shows/sr/Episodes': { Items: [{ ...full, Chapters: undefined, MediaSources: undefined }] },
        }),
      ),
      { serverId: () => 's1' },
    );
    render(<DetailsView id="e1" ctx={makeContext(c)} />);

    fireEvent.click(await screen.findByRole('button', { name: /^Play/ }));
    await waitFor(() =>
      expect(play).toHaveBeenCalledWith({
        items: [expect.objectContaining({ Id: 'e1', Type: 'Episode' })],
        startPositionTicks: undefined,
        serverId: 's1',
      }),
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

  it('shows a person with their filmography', async () => {
    let query: URLSearchParams | null = null;
    const ctx = makeContext(
      createFakeClient(
        routes({
          'Items/p1': {
            Id: 'p1',
            Name: 'Jane Doe',
            Type: 'Person',
            Overview: 'An actor.',
            PremiereDate: '1970-03-04T00:00:00.0000000Z',
            ProductionLocations: ['Leeds, England'],
          },
          Items: (r: { url: string }) => {
            query = new URL(r.url).searchParams;
            return { Items: [{ Id: 'm1', Name: 'Lumen Alpha', Type: 'Movie' }], TotalRecordCount: 1 };
          },
        }),
      ),
    );
    render(<DetailsView id="p1" ctx={ctx} />);

    expect(await screen.findByRole('heading', { name: 'Jane Doe' })).toBeInTheDocument();
    expect(screen.getByText(/Born March 4, 1970 in Leeds, England/)).toBeInTheDocument();
    expect((await screen.findAllByText('Lumen Alpha')).length).toBeGreaterThan(0);
    expect(query!.get('personIds')).toBe('p1');
    expect(ctx.onFallback).not.toHaveBeenCalled();
  });

  it("shows a person's dates and title count in the user's Jellyfin locale", async () => {
    const restore = setJellyfinLocale('de-de');
    try {
      const ctx = makeContext(
        createFakeClient(
          routes({
            'Items/p1': {
              Id: 'p1',
              Name: 'Jane Doe',
              Type: 'Person',
              PremiereDate: '1970-03-04T00:00:00.0000000Z',
            },
            // A full first page, so the grid shows the server's count rather than the items it has.
            Items: {
              Items: Array.from({ length: PAGE_SIZE }, (_, i) => ({
                Id: `m${i}`,
                Name: `Title ${i}`,
                Type: 'Movie',
              })),
              TotalRecordCount: 1234,
            },
          }),
        ),
      );
      render(<DetailsView id="p1" ctx={ctx} />);

      expect(await screen.findByText(/Born 4\. März 1970/)).toBeInTheDocument();
      expect(await screen.findByText('1.234')).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it('shows a collection with its titles, oldest first', async () => {
    let query: URLSearchParams | null = null;
    const ctx = makeContext(
      createFakeClient(
        routes({
          'Items/c1': {
            Id: 'c1',
            Name: 'Lumen Saga',
            Type: 'BoxSet',
            UserData: { Played: false, IsFavorite: false },
          },
          Items: (r: { url: string }) => {
            query = new URL(r.url).searchParams;
            return { Items: [{ Id: 'm1', Name: 'Lumen Alpha', Type: 'Movie' }], TotalRecordCount: 1 };
          },
        }),
      ),
    );
    render(<DetailsView id="c1" ctx={ctx} />);

    expect(await screen.findByRole('heading', { name: 'Lumen Saga' })).toBeInTheDocument();
    expect((await screen.findAllByText('Lumen Alpha')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Play/ })).toBeInTheDocument();
    expect(query!.get('parentId')).toBe('c1');
    expect(query!.get('sortOrder')).toBe('Ascending');
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

  describe('with a request that never answers', () => {
    afterEach(() => vi.useRealTimers());

    it('falls back to stock after 10 seconds', async () => {
      vi.useFakeTimers();
      const ctx = makeContext(createFakeClient(() => new Promise(() => undefined)));
      render(<DetailsView id="m1" ctx={ctx} />);

      await vi.advanceTimersByTimeAsync(9_999);
      expect(ctx.onFallback).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(ctx.onFallback).toHaveBeenCalledTimes(1);
    });
  });
});
