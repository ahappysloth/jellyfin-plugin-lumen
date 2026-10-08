import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import type { HomeResponse } from '../../api/types';
import { HomeView } from './HomeView';
import { getCachedHome, getSelection, setCachedHome } from './homeStore';

const home: HomeResponse = {
  ConfigVersion: 1,
  Hero: [],
  Rows: [
    {
      Id: 'r1',
      Type: 'ContinueWatching',
      Title: 'Continue Watching',
      Items: [
        {
          Id: 'e1',
          Name: 'Pilot',
          Type: 'Episode',
          SeriesName: 'Show',
          ParentIndexNumber: 1,
          IndexNumber: 1,
          UserData: { PlaybackPositionTicks: 77 },
        },
      ],
    },
    {
      Id: 'r2',
      Type: 'RecentlyAdded',
      Title: 'Recently Added',
      Items: [{ Id: 'm1', Name: 'Alpha', Type: 'Movie', ServerId: 's' }],
    },
  ],
};

describe('HomeView', () => {
  beforeEach(() => setCachedHome('nobody', { ConfigVersion: 0, Hero: [], Rows: [] }));

  it('renders rows and opens details for movies', async () => {
    const ctx = makeContext(createFakeClient(routes({ 'Lumen/Home': home })));
    render(<HomeView ctx={ctx} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Alpha' }));

    expect(screen.getByRole('region', { name: 'Recently Added' })).toBeInTheDocument();
    expect(ctx.navigate).toHaveBeenCalledWith('#/details?id=m1&serverId=s');
  });

  it('resumes continue-watching items in place', async () => {
    const client = createFakeClient(
      routes({
        'Lumen/Home': home,
        Sessions: [{ Id: 's1', DeviceId: 'dev+ice' }],
        'Sessions/s1/Playing': {},
      }),
    );
    render(<HomeView ctx={makeContext(client)} />);

    fireEvent.click(await screen.findByRole('button', { name: /Pilot/ }));

    await waitFor(() =>
      expect(client.requests.at(-1)?.url).toContain(
        'Sessions/s1/Playing?playCommand=PlayNow&itemIds=e1&startPositionTicks=77',
      ),
    );
  });

  it('falls back to stock when home is empty', async () => {
    const ctx = makeContext(
      createFakeClient(routes({ 'Lumen/Home': { ConfigVersion: 1, Hero: [], Rows: [] } })),
    );
    render(<HomeView ctx={ctx} />);

    await waitFor(() => expect(ctx.onFallback).toHaveBeenCalled());
  });

  it('drops a stale cached home when the fresh home is empty', async () => {
    setCachedHome('user1', home);
    const ctx = makeContext(
      createFakeClient(routes({ 'Lumen/Home': { ConfigVersion: 2, Hero: [], Rows: [] } })),
    );
    render(<HomeView ctx={ctx} />);

    await waitFor(() => expect(ctx.onFallback).toHaveBeenCalled());
    expect(getCachedHome('user1')).toBeUndefined();
  });

  describe('with a request that never answers', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('falls back to stock after 10 seconds when nothing is cached', async () => {
      setCachedHome('user1', { ConfigVersion: 0, Hero: [], Rows: [] });
      const ctx = makeContext(createFakeClient(() => new Promise(() => undefined)));
      render(<HomeView ctx={ctx} />);

      await vi.advanceTimersByTimeAsync(9_999);
      expect(ctx.onFallback).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(ctx.onFallback).toHaveBeenCalledTimes(1);
    });

    it('keeps showing a usable cached home instead of falling back', async () => {
      setCachedHome('user1', home);
      const ctx = makeContext(createFakeClient(() => new Promise(() => undefined)));
      render(<HomeView ctx={ctx} />);

      await vi.advanceTimersByTimeAsync(11_000);

      expect(ctx.onFallback).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument();
    });
  });

  it('falls back to stock when the request fails and nothing is cached', async () => {
    const ctx = makeContext(createFakeClient(() => Promise.reject(new Error('down'))));
    render(<HomeView ctx={ctx} />);

    await waitFor(() => expect(ctx.onFallback).toHaveBeenCalled(), { timeout: 2000 });
  });

  it('shows the cached home instantly and keeps it when the refresh fails', async () => {
    setCachedHome('user1', home);
    const ctx = makeContext(createFakeClient(() => Promise.reject(new Error('down'))));
    render(<HomeView ctx={ctx} />);

    expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 700));
    expect(ctx.onFallback).not.toHaveBeenCalled();
  });

  it('falls back to stock when the cached home is empty and the refresh fails', async () => {
    setCachedHome('user1', { ConfigVersion: 1, Hero: [], Rows: [] });
    const ctx = makeContext(createFakeClient(() => Promise.reject(new Error('down'))));
    const { container } = render(<HomeView ctx={ctx} />);

    expect(container.querySelector('.lmn-home--loading')).not.toBeNull();
    await waitFor(() => expect(ctx.onFallback).toHaveBeenCalled(), { timeout: 2000 });
    expect(container.querySelector('.lmn-row')).toBeNull();
  });

  it("does not show another user's cached home", () => {
    setCachedHome('someone-else', home);
    render(<HomeView ctx={makeContext(createFakeClient(() => new Promise(() => undefined)))} />);

    expect(screen.queryByRole('button', { name: 'Alpha' })).toBeNull();
  });

  it('remembers the selected card so returning home can restore it', async () => {
    const ctx = makeContext(createFakeClient(routes({ 'Lumen/Home': home })));
    render(<HomeView ctx={ctx} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Alpha' }));

    expect(getSelection('user1')?.itemId).toBe('m1');
  });

  describe('hero Play on a series', () => {
    const seriesHome: HomeResponse = {
      ConfigVersion: 1,
      Rows: [],
      Hero: [{ Item: { Id: 'ser1', Name: 'The Show', Type: 'Series', ServerId: 's' }, TrailerItemId: null }],
    };

    it('plays the resumable episode with its ticks, not the series id', async () => {
      const client = createFakeClient(
        routes({
          'Lumen/Home': seriesHome,
          'UserItems/Resume': {
            Items: [{ Id: 'ep9', Name: 'Nine', Type: 'Episode', UserData: { PlaybackPositionTicks: 555 } }],
          },
          'Shows/NextUp': { Items: [] },
          Sessions: [{ Id: 's1', DeviceId: 'dev+ice' }],
          'Sessions/s1/Playing': {},
        }),
      );
      render(<HomeView ctx={makeContext(client)} />);

      fireEvent.click(await screen.findByRole('button', { name: 'Play' }));

      await waitFor(() =>
        expect(client.requests.at(-1)?.url).toContain(
          'Sessions/s1/Playing?playCommand=PlayNow&itemIds=ep9&startPositionTicks=555',
        ),
      );
    });

    it('opens the details page when nothing is playable', async () => {
      const client = createFakeClient(
        routes({
          'Lumen/Home': seriesHome,
          'UserItems/Resume': { Items: [] },
          'Shows/NextUp': { Items: [] },
          'Shows/ser1/Seasons': { Items: [] },
        }),
      );
      const ctx = makeContext(client);
      render(<HomeView ctx={ctx} />);

      fireEvent.click(await screen.findByRole('button', { name: 'Play' }));

      await waitFor(() => expect(ctx.navigate).toHaveBeenCalledWith('#/details?id=ser1&serverId=s'));
      expect(client.requests.some((r) => r.url.includes('Sessions'))).toBe(false);
    });
  });
});
