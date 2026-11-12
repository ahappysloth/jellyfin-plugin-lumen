import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import type { AdminApi, StorageBreakdown, StorageBucket, StorageReport, StorageStatus } from './adminApi';
import { StorageSettings } from './StorageSettings';
import { codecMix, fileCodecLabel, formatBitrate, formatBytes, formatFiles, shares } from './storageFormat';

const GB = 1_000_000_000;

const bucket = (Key: string, Size = 0, Files = 0, UnknownSizeFiles = 0): StorageBucket => ({
  Key,
  Size,
  Files,
  UnknownSizeFiles,
});

function breakdown(overrides: Partial<StorageBreakdown> = {}): StorageBreakdown {
  return {
    Size: 330 * GB,
    Files: 40,
    UnknownSizeFiles: 0,
    Codecs: [
      bucket('H264', 200 * GB, 30),
      bucket('HEVC', 100 * GB, 8),
      bucket('AV1', 0, 0),
      bucket('Other', 30 * GB, 2),
      bucket('Unknown'),
    ],
    Resolutions: [
      bucket('SD', 30 * GB, 2),
      bucket('720p', 0, 0),
      bucket('1080p', 180 * GB, 30),
      bucket('4K', 120 * GB, 8),
      bucket('Unknown'),
    ],
    Hdr: bucket('HDR', 90 * GB, 6),
    H264AtLeast1080p: bucket('H264AtLeast1080p', 180 * GB, 28),
    ...overrides,
  };
}

function report(overrides: Partial<StorageReport> = {}): StorageReport {
  return {
    ComputedAt: '2026-11-11T10:00:00Z',
    Seconds: 3.4,
    Totals: breakdown(),
    Libraries: [
      { Id: 'lib-movies', Name: 'Movies', CollectionType: 'movies', Storage: breakdown() },
      {
        Id: 'lib-shows',
        Name: 'Shows',
        CollectionType: 'tvshows',
        Storage: breakdown({ Files: 0, Size: 0 }),
      },
    ],
    BiggestMovies: [
      {
        Id: 'movie1',
        Name: 'Big Film',
        Year: 2019,
        Size: 62.4 * GB,
        Files: 2,
        Codec: 'HEVC',
        CodecName: 'hevc',
        Resolution: '4K',
        Width: 3840,
        Height: 1600,
        Bitrate: 58_300_000,
        Hdr: 'Dolby Vision',
      },
    ],
    BiggestSeries: [
      {
        Id: 'series1',
        Name: 'Long Show',
        Episodes: 64,
        Size: 210 * GB,
        Files: 64,
        Codecs: [bucket('H264', 180 * GB, 50), bucket('HEVC', 30 * GB, 14)],
      },
    ],
    ...overrides,
  };
}

const ready = (r: StorageReport = report()): StorageStatus => ({ State: 'Ready', Report: r, Error: null });

function fakeApi(overrides: Partial<AdminApi> = {}): AdminApi {
  return {
    getStorage: vi.fn(async () => ready()),
    refreshStorage: vi.fn(async () => ready()),
    ...overrides,
  } as unknown as AdminApi;
}

describe('StorageSettings', () => {
  it('shows the totals, the re-encode pool, the breakdowns and the biggest titles', async () => {
    render(<StorageSettings api={fakeApi()} />);

    expect(await screen.findByText('330 GB')).toBeInTheDocument();
    expect(screen.getByText('in 40 files')).toBeInTheDocument();
    expect(screen.getByText(/^Computed /)).toBeInTheDocument();

    // The one number the card is for.
    const pool = screen.getByText('H.264 at 1080p and above').parentElement!;
    expect(pool).toHaveTextContent('180 GB in 28 files');
    expect(screen.getByText('HDR').parentElement!).toHaveTextContent('90 GB in 6 files');

    const codecs = screen.getByRole('table', { name: 'By codec' });
    expect(within(codecs).getByRole('row', { name: /H\.264/ })).toHaveTextContent('H.264200 GB3061%');
    // "Not probed" is left out when there's none.
    expect(within(codecs).queryByText('Not probed')).toBeNull();
    const resolutions = screen.getByRole('table', { name: 'By resolution' });
    expect(within(resolutions).getByRole('row', { name: /4K/ })).toHaveTextContent('4K120 GB836%');

    // Each library gets a bar per breakdown, named with its numbers.
    expect(
      screen.getByRole('img', {
        name: /^Movies by codec: H\.264 200 GB, 30 files; HEVC 100 GB, 8 files; Other/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /^Movies by resolution: SD 30 GB, 2 files; 1080p/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('No video files')).toBeInTheDocument();

    const movie = screen.getByRole('link', { name: 'Big Film (2019)' });
    expect(movie).toHaveAttribute('href', '#/details?id=movie1');
    expect(movie.closest('li')).toHaveTextContent('62.4 GB');
    expect(movie.closest('li')).toHaveTextContent('HEVC · 4K · 58.3 Mb/s · Dolby Vision · 2 files');

    const show = screen.getByRole('link', { name: 'Long Show' });
    expect(show).toHaveAttribute('href', '#/details?id=series1');
    expect(show.closest('li')).toHaveTextContent('64 episodes · H.264 86% · HEVC 14%');
  });

  it('says why the libraries add up to more than the total when they share files', async () => {
    const hint = /in more than one library, so these add up to more than the total/;
    const { unmount } = render(<StorageSettings api={fakeApi()} />);
    await screen.findByText('330 GB');
    expect(screen.queryByText(hint)).toBeNull();
    unmount();

    const shared = report({
      Libraries: [
        { Id: 'lib-a', Name: 'Films', CollectionType: 'movies', Storage: breakdown() },
        {
          Id: 'lib-b',
          Name: 'All video',
          CollectionType: 'movies',
          Storage: breakdown({ Size: 30 * GB, Files: 2 }),
        },
      ],
    });
    render(<StorageSettings api={fakeApi({ getStorage: vi.fn(async () => ready(shared)) })} />);
    const libraries = await screen.findByRole('region', { name: 'Libraries' });
    expect(within(libraries).getByText(hint)).toBeInTheDocument();
  });

  it('says when sizes are unknown (.strm and remote files)', async () => {
    const r = report({ Totals: breakdown({ UnknownSizeFiles: 12 }) });
    render(<StorageSettings api={fakeApi({ getStorage: vi.fn(async () => ready(r)) })} />);

    expect((await screen.findByText('Size unknown')).parentElement!).toHaveTextContent('12 files');
  });

  it('says computing, then asks again until the report is ready', async () => {
    const getStorage = vi
      .fn<() => Promise<StorageStatus>>()
      .mockResolvedValueOnce({ State: 'Computing', Report: null, Error: null })
      .mockResolvedValueOnce(ready());
    render(<StorageSettings api={fakeApi({ getStorage })} pollMs={10} />);

    expect(await screen.findByText(/Computing… on a big library/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Computing…' })).toBeDisabled();
    expect(await screen.findByText('330 GB')).toBeInTheDocument();
    expect(getStorage).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  });

  it('keeps showing the last report while it updates', async () => {
    const api = fakeApi({
      getStorage: vi.fn(async () => ({ State: 'Computing' as const, Report: report(), Error: null })),
    });
    render(<StorageSettings api={api} pollMs={60_000} />);

    expect(await screen.findByText(/Updating… these numbers are from the last scan/)).toBeInTheDocument();
    expect(screen.getByText('330 GB')).toBeInTheDocument();
  });

  it('Refresh asks the server to scan again', async () => {
    const api = fakeApi();
    render(<StorageSettings api={api} />);
    await screen.findByText('330 GB');

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(api.refreshStorage).toHaveBeenCalledTimes(1));
  });

  it('says so when there are no video files', async () => {
    const empty = report({
      Totals: breakdown({ Size: 0, Files: 0 }),
      Libraries: [],
      BiggestMovies: [],
      BiggestSeries: [],
    });
    render(<StorageSettings api={fakeApi({ getStorage: vi.fn(async () => ready(empty)) })} />);

    expect(await screen.findByText('No video files in your libraries yet.')).toBeInTheDocument();
  });

  it('says when the report can’t be loaded, or the scan failed', async () => {
    const { unmount } = render(
      <StorageSettings api={fakeApi({ getStorage: vi.fn(async () => Promise.reject(new Error('500'))) })} />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the storage report.");
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
    unmount();

    render(
      <StorageSettings
        api={fakeApi({
          getStorage: vi.fn(async () => ({
            State: 'Failed' as const,
            Report: null,
            Error: 'Database locked.',
          })),
        })}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Database locked.');
  });

  it('says there’s no report yet when a scan stopped before it finished', async () => {
    // Jellyfin shutting down mid-scan leaves Ready with no report.
    const getStorage = vi.fn(async (): Promise<StorageStatus> => ({
      State: 'Ready',
      Report: null,
      Error: null,
    }));
    render(<StorageSettings api={fakeApi({ getStorage })} />);

    expect(await screen.findByText('No storage report yet. Refresh to compute one.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  });

  it('announces an error once: as an alert, outside the polite live region', async () => {
    const { container } = render(
      <StorageSettings api={fakeApi({ getStorage: vi.fn(async () => Promise.reject(new Error('500'))) })} />,
    );

    const alert = await screen.findByRole('alert');
    expect(alert.closest('[aria-live]')).toBeNull();
    expect(container.querySelectorAll('[aria-live] [role="alert"]')).toHaveLength(0);
  });

  it('stops asking while the page is hidden, and asks again once it’s shown', async () => {
    const computing: StorageStatus = { State: 'Computing', Report: null, Error: null };
    const getStorage = vi
      .fn<() => Promise<StorageStatus>>()
      .mockResolvedValueOnce(computing)
      .mockResolvedValueOnce(ready());
    let hidden = true;
    const spy = vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    try {
      render(<StorageSettings api={fakeApi({ getStorage })} pollMs={10} />);
      expect(await screen.findByText(/Computing… on a big library/)).toBeInTheDocument();

      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(getStorage).toHaveBeenCalledTimes(1);

      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));

      expect(await screen.findByText('330 GB')).toBeInTheDocument();
      expect(getStorage).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('makes the tables and libraries focus stops only in the TV layout', async () => {
    const { unmount } = render(<StorageSettings api={fakeApi()} />);
    await screen.findByText('330 GB');
    expect(screen.getByRole('table', { name: 'By codec' })).not.toHaveAttribute('tabindex');
    expect(screen.getByRole('group', { name: 'Movies' })).not.toHaveAttribute('tabindex');
    expect(document.querySelectorAll('.lmna-storage .focusable')).toHaveLength(0);
    unmount();

    document.documentElement.classList.add('layout-tv');
    try {
      render(<StorageSettings api={fakeApi()} />);
      await screen.findByText('330 GB');
      expect(screen.getByRole('table', { name: 'By codec' })).toHaveAttribute('tabindex', '0');
      expect(screen.getByRole('table', { name: 'By codec' })).toHaveClass('focusable');
      expect(screen.getByRole('group', { name: 'Movies' })).toHaveAttribute('tabindex', '0');
      expect(screen.getByRole('group', { name: 'Movies' })).toHaveClass('focusable');
    } finally {
      document.documentElement.classList.remove('layout-tv');
    }
  });

  it('waits until the card is near the screen before asking', async () => {
    let seen: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
    const observe = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: typeof seen) {
          seen = callback;
        }
        observe = observe;
        disconnect = vi.fn();
      },
    );
    try {
      const api = fakeApi();
      render(<StorageSettings api={api} />);
      expect(observe).toHaveBeenCalled();
      expect(api.getStorage).not.toHaveBeenCalled();

      seen!([{ isIntersecting: true }]);

      expect(await screen.findByText('330 GB')).toBeInTheDocument();
      expect(api.getStorage).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('storage formatting', () => {
  it('writes sizes in decimal units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(812)).toBe('812 B');
    expect(formatBytes(845_000)).toBe('845 KB');
    expect(formatBytes(1_234_567)).toBe('1.2 MB');
    expect(formatBytes(45_310_000_000)).toBe('45.3 GB');
    expect(formatBytes(412_400_000_000)).toBe('412 GB');
    expect(formatBytes(999_960_000_000)).toBe('1 TB');
    expect(formatBytes(1_230_000_000_000)).toBe('1.2 TB');
  });

  it('writes bitrates and counts', () => {
    expect(formatBitrate(850_000)).toBe('850 kb/s');
    expect(formatBitrate(38_140_000)).toBe('38.1 Mb/s');
    expect(formatFiles(1)).toBe('1 file');
    expect(formatFiles(1204)).toBe('1,204 files');
  });

  it('names an Other codec by itself', () => {
    expect(fileCodecLabel('Other', 'vp9')).toBe('VP9');
    expect(fileCodecLabel('Other', 'mpeg2video')).toBe('MPEG-2');
    expect(fileCodecLabel('H264', 'h264')).toBe('H.264');
    expect(fileCodecLabel('Unknown', null)).toBe('Not probed');
  });

  it('splits shares that add up to 100, by count when no size is known', () => {
    expect(shares([bucket('a', 1), bucket('b', 1), bucket('c', 1)])).toEqual([34, 33, 33]);
    expect(shares([bucket('a', 0, 3), bucket('b', 0, 1)])).toEqual([75, 25]);
    expect(shares([bucket('a'), bucket('b')])).toEqual([0, 0]);
  });

  it('writes a series’ codec mix', () => {
    expect(codecMix([bucket('HEVC', 5 * GB, 10)])).toBe('HEVC');
    expect(codecMix([bucket('H264', 3 * GB, 1), bucket('AV1', 1 * GB, 1)])).toBe('H.264 75% · AV1 25%');
    // An uncommon codec comes by its own name.
    expect(codecMix([bucket('vp9', 3 * GB, 2)])).toBe('VP9');
    expect(codecMix([bucket('H264', 3 * GB, 1), bucket('mpeg2video', 1 * GB, 1)])).toBe(
      'H.264 75% · MPEG-2 25%',
    );
  });
});
