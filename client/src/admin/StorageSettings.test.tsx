import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('asks for the report as soon as it is shown (its tab is opened)', async () => {
    const api = fakeApi();
    render(<StorageSettings api={api} />);
    expect(api.getStorage).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('330 GB')).toBeInTheDocument();
  });

  it('shows the headline figures in the text colour, and only what follows them dimmed', async () => {
    render(<StorageSettings api={fakeApi()} />);
    const total = await screen.findByText('330 GB');
    // Dimmed text is .lmna-storage__files (admin.css); a figure inside a dimmed line would be dimmed too.
    expect(total.closest('.lmna-storage__files')).toBeNull();
    expect(total.nextElementSibling).toHaveClass('lmna-storage__files');
    expect(total.nextElementSibling).toHaveTextContent('in 40 files');
    const tiles = document.querySelectorAll('.lmna-storage__tile dd strong');
    expect(Array.from(tiles, (t) => t.textContent)).toEqual(['180 GB', '90 GB']);
    for (const figure of Array.from(tiles)) {
      expect(figure.closest('dd')).not.toHaveClass('lmna-storage__files');
      expect(figure.nextElementSibling).toHaveClass('lmna-storage__files');
    }
  });

  it('dims no headline figure in admin.css', async () => {
    const css = (await import('./admin.css?raw')).default;
    const rule = (selector: string) => {
      const start = css.indexOf(`${selector} {`);
      expect(start, selector).toBeGreaterThanOrEqual(0);
      return css.slice(start, css.indexOf('}', start));
    };
    expect(rule('.lmn-admin .lmna-storage__total')).not.toMatch(/color:/);
    expect(rule('.lmn-admin .lmna-storage__tile dd')).not.toMatch(/color:/);
    expect(rule('.lmn-admin .lmna-storage__files')).toMatch(/color:\s*var\(--a-dim\)/);
  });
});

describe('Storage bar tooltips', () => {
  // layOut replaces jsdom's own (always 0) sizes; each test gets them back afterwards.
  const proto = HTMLElement.prototype;
  const sizes = ['offsetWidth', 'offsetHeight'].map(
    (name) => [name, Object.getOwnPropertyDescriptor(proto, name)!] as const,
  );
  afterEach(() => {
    for (const [name, descriptor] of sizes) Object.defineProperty(proto, name, descriptor);
    Reflect.deleteProperty(document.documentElement, 'clientWidth');
  });

  /** jsdom has no layout: lay a bar's parts out side by side, 100px each from `left`, in a window `width` wide. */
  function layOut(bar: HTMLElement, { left = 100, top = 300, width = 1000, tip = 200 } = {}): void {
    const rect = (l: number, r: number, t: number) =>
      ({ left: l, right: r, top: t, bottom: t + 8, width: r - l, height: 8, x: l, y: t }) as DOMRect;
    const parts = Array.from(bar.children) as HTMLElement[];
    parts.forEach((seg, i) => {
      seg.getBoundingClientRect = () => rect(left + i * 100, left + i * 100 + 98, top);
    });
    bar.parentElement!.getBoundingClientRect = () => rect(0, width, top - 6);
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => tip });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 30 });
  }
  const tip = (): HTMLElement | null => document.querySelector('.lmna-tip');
  const codecBar = async (): Promise<HTMLElement> => screen.findByRole('img', { name: /^Movies by codec:/ });

  it('shows a part’s name, size, files and share where the mouse points, and goes when it leaves', async () => {
    render(<StorageSettings api={fakeApi()} />);
    const bar = await codecBar();
    layOut(bar);
    const wrap = bar.parentElement!;

    fireEvent.pointerMove(wrap, { pointerType: 'mouse', clientX: 250 });
    expect(tip()).toHaveTextContent('HEVC · 100 GB · 8 files · 30% of Movies');
    expect(tip()).toHaveAttribute('aria-hidden', 'true');
    expect(bar.children[1]).toHaveClass('is-active');
    expect(wrap).toHaveClass('is-pointing');

    // In a gap between parts: the nearest.
    fireEvent.pointerMove(wrap, { pointerType: 'mouse', clientX: 199 });
    expect(tip()).toHaveTextContent(/^H\.264 · 200 GB · 30 files · 61% of Movies$/);

    fireEvent.pointerLeave(wrap, { pointerType: 'mouse' });
    expect(tip()).toBeNull();
    // No native tooltip besides the styled one.
    expect(bar.querySelector('[title]')).toBeNull();
  });

  it('on a touch screen, a tap shows it, the same tap again or a tap elsewhere hides it', async () => {
    render(<StorageSettings api={fakeApi()} />);
    const bar = await codecBar();
    layOut(bar);
    const wrap = bar.parentElement!;
    const tap = (clientX: number): void => {
      fireEvent.pointerDown(wrap, { pointerType: 'touch', clientX });
      fireEvent.pointerUp(wrap, { pointerType: 'touch', clientX });
    };

    tap(320);
    expect(tip()).toHaveTextContent('Other · 30 GB · 2 files · 9% of Movies');
    // A touch's move (scrolling) doesn't change it.
    fireEvent.pointerMove(wrap, { pointerType: 'touch', clientX: 120 });
    expect(tip()).toHaveTextContent(/^Other/);
    tap(320);
    expect(tip()).toBeNull();

    // A swipe that starts on the bar becomes a scroll (pointercancel, no pointerup): no tooltip.
    fireEvent.pointerDown(wrap, { pointerType: 'touch', clientX: 120 });
    fireEvent.pointerCancel(wrap, { pointerType: 'touch', clientX: 120 });
    expect(tip()).toBeNull();

    tap(120);
    expect(tip()).toHaveTextContent(/^H\.264/);
    fireEvent.pointerDown(document.body, { pointerType: 'touch' });
    expect(tip()).toBeNull();
  });

  it('from the keyboard: one Tab stop per bar, its arrows go part to part, Escape or leaving hides it', async () => {
    render(<StorageSettings api={fakeApi()} />);
    const bar = await codecBar();
    layOut(bar);
    expect(bar).toHaveAttribute('tabindex', '0');
    // The parts aren't stops (or names) of their own: the bar's name reads them all, once.
    expect(bar.querySelectorAll('[tabindex], [role], [aria-label]')).toHaveLength(0);

    fireEvent.focus(bar);
    expect(tip()).toHaveTextContent(/^H\.264/);
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    expect(tip()).toHaveTextContent(/^HEVC/);
    fireEvent.keyDown(bar, { key: 'End' });
    expect(tip()).toHaveTextContent(/^Other/);
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    expect(tip()).toHaveTextContent(/^Other/);
    fireEvent.keyDown(bar, { key: 'Home' });
    expect(tip()).toHaveTextContent(/^H\.264/);
    expect(fireEvent.keyDown(bar, { key: 'Escape' })).toBe(false);
    expect(tip()).toBeNull();
    // Escape with nothing showing is left to the page.
    expect(fireEvent.keyDown(bar, { key: 'Escape' })).toBe(true);

    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    expect(tip()).not.toBeNull();
    fireEvent.blur(bar);
    expect(tip()).toBeNull();
  });

  it('keeps inside the window: shifted in from an edge, its arrow still on the part, and under the bar near the top', async () => {
    render(<StorageSettings api={fakeApi()} />);
    const bar = await codecBar();
    const wrap = bar.parentElement!;

    // The last part ends at the window's right edge: a 200px tooltip centred on it would overflow.
    layOut(bar, { left: 702, width: 1000 });
    fireEvent.pointerMove(wrap, { pointerType: 'mouse', clientX: 960 });
    expect(tip()!.style.left).toBe(`${1000 - 8 - 200}px`);
    expect(tip()!.style.getPropertyValue('--tip-arrow')).toBe(`${951 - 792}px`);
    expect(tip()).not.toHaveClass('is-below');
    fireEvent.pointerLeave(wrap, { pointerType: 'mouse' });

    // The first part at the left edge, the bar at the top of the window.
    layOut(bar, { left: 0, top: 20 });
    fireEvent.pointerMove(wrap, { pointerType: 'mouse', clientX: 5 });
    expect(tip()!.style.left).toBe('8px');
    expect(tip()).toHaveClass('is-below');
  });

  it('isn’t a Tab stop in the TV layout, where the library is the D-pad stop', async () => {
    document.documentElement.classList.add('layout-tv');
    try {
      render(<StorageSettings api={fakeApi()} />);
      expect(await codecBar()).not.toHaveAttribute('tabindex');
    } finally {
      document.documentElement.classList.remove('layout-tv');
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
