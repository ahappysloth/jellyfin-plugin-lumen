import { act, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import { trailerLogger } from '../home/trailerLog';
import {
  attachToMediaInfo,
  openTrailerInfoDialog,
  TrailerInfo,
  type TrailerInfoResponse,
} from './TrailerInfo';

const now = new Date().toISOString();
const found: TrailerInfoResponse = {
  Previews: true,
  OnlineTrailers: true,
  LocalTrailer: false,
  Skipped: null,
  Imdb: { Id: 'tt0133093', Status: 'found', Qualities: ['1080p', '720p'], Cached: true, FetchedAt: now },
  YouTube: { Status: 'found', VideoId: 'dQw4w9WgXcQ', Source: 'jellyfin', Cached: false },
  CanRefresh: false,
};
const failing: TrailerInfoResponse = {
  ...found,
  Imdb: {
    Id: 'tt0133093',
    Status: 'httpError',
    Detail: 'HTTP 403',
    Qualities: [],
    Cached: false,
    FetchedAt: now,
  },
  YouTube: { Status: 'error', Detail: 'Seerr answered HTTP 503', Cached: true, FetchedAt: now },
};
const target = { key: 'm1', of: 'Items/m1', name: 'Alpha' };

function setup(info: TrailerInfoResponse | (() => unknown), refresh?: () => unknown) {
  const client = createFakeClient(
    routes({ 'Lumen/Items/m1/TrailerInfo': info, 'Lumen/Items/m1/TrailerInfo/Refresh': refresh ?? info }),
  );
  return { client, ctx: makeContext(client) };
}
const text = () => document.body.textContent ?? '';

describe('the Trailer section', () => {
  afterEach(() => {
    sessionStorage.clear();
    document.body.innerHTML = '';
  });

  it('says what the server found: qualities, never addresses, where YouTube’s came from, and whether it was cached', async () => {
    const { ctx } = setup(found);
    render(<TrailerInfo ctx={ctx} target={target} />);

    await screen.findByText('Found: 1080p, 720p available');
    expect(text()).toContain('tt0133093');
    expect(text()).toContain('Cached, fetched');
    const link = screen.getByRole('link', { name: 'dQw4w9WgXcQ' });
    expect(link.getAttribute('href')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(text()).toContain('from Jellyfin’s remote trailers (TMDB)');
    expect(text()).toContain('Not played on this device yet');
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
  });

  it('says why each source failed', async () => {
    const { ctx } = setup(failing);
    render(<TrailerInfo ctx={ctx} target={target} />);

    await screen.findByText('IMDb error: HTTP 403');
    expect(text()).toContain('Error: Seerr answered HTTP 503');
  });

  it('says a local trailer wins, and when there’s no IMDb id to ask by', async () => {
    const { ctx } = setup({
      ...found,
      LocalTrailer: true,
      Imdb: { Id: null, Status: 'noId', Qualities: [], Cached: false },
    });
    render(<TrailerInfo ctx={ctx} target={target} />);

    await screen.findByText('Yes: it plays instead of the online ones');
    expect(text()).toContain('No IMDb id in metadata');
    expect(text()).toContain('Not asked: no IMDb id in metadata');
  });

  it('says which setting is off, and that nothing was asked', async () => {
    const skipped = { Status: 'skipped', Qualities: [], Cached: false };
    const { ctx } = setup({
      ...found,
      OnlineTrailers: false,
      Skipped: 'onlineOff',
      Imdb: { ...skipped, Id: 'tt1' },
      YouTube: skipped,
    });
    render(<TrailerInfo ctx={ctx} target={target} />);

    await screen.findByText('Off (“Use online trailers” is off)');
    expect(screen.getAllByText('Skipped')).toHaveLength(2);
  });

  it('shows this device’s last attempt: what played and how quickly, and what failed and why', async () => {
    const log = trailerLogger('m1', false)!;
    log.end(log.add({ source: 'imdb', quality: 'hd', outcome: 'pending' }), {
      outcome: 'error',
      code: 4,
      message: 'MEDIA_ELEMENT_ERROR: Format error',
    });
    log.add({ source: 'imdb', quality: 'main', outcome: 'timeout' });
    log.add({ source: 'youtube', outcome: 'error', code: 150 });
    log.add({ source: 'local', quality: 'hls', outcome: 'played', ms: 1250 });
    const { ctx } = setup(found);
    render(<TrailerInfo ctx={ctx} target={target} />);

    await screen.findByText('Found: 1080p, 720p available');
    expect(text()).toContain(
      'IMDb 1080pFailed: format not supported (4) (MEDIA_ELEMENT_ERROR: Format error)',
    );
    expect(text()).toContain('IMDb 720pTimed out before the first frame');
    expect(text()).toContain('YouTubeFailed: embedding not allowed (150)');
    expect(text()).toContain('Local trailer (remuxed / transcoded (HLS))Played, under way after 1.3 s');
  });

  it('gives an administrator Check again, which asks past the server’s cache and shows the answer', async () => {
    const { client, ctx } = setup({ ...failing, CanRefresh: true }, () => ({ ...found, CanRefresh: true }));
    render(<TrailerInfo ctx={ctx} target={target} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Check again' }));

    await screen.findByText('Found: 1080p, 720p available');
    expect(screen.getByRole('status').textContent).toBe('Checked again');
    expect(client.requests.map((r) => `${r.type} ${new URL(r.url).pathname}`)).toEqual([
      'GET /Lumen/Items/m1/TrailerInfo',
      'POST /Lumen/Items/m1/TrailerInfo/Refresh',
    ]);
  });

  it('scrolls a control the remote focuses into view: jellyfin-web doesn’t in its full-screen TV dialog', async () => {
    const scroll = vi.fn();
    const had = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    onTestFinished(() => void (Element.prototype.scrollIntoView = had));
    const { ctx } = setup({ ...found, CanRefresh: true });
    render(<TrailerInfo ctx={ctx} target={target} />);
    const check = await screen.findByRole('button', { name: 'Check again' });

    // Not elsewhere: the browser does it, and a click would move the button from under the pointer.
    check.focus();
    expect(scroll).not.toHaveBeenCalled();

    check.blur();
    document.documentElement.classList.add('layout-tv');
    onTestFinished(() => document.documentElement.classList.remove('layout-tv'));
    check.focus();
    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'instant' });
  });

  it('says to wait when the server limits Check again', async () => {
    const limited = { status: 429, headers: new Headers({ 'Retry-After': '25' }) };
    const { ctx } = setup({ ...found, CanRefresh: true }, () => Promise.reject(limited));
    render(<TrailerInfo ctx={ctx} target={target} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Check again' }));

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Checked a moment ago. Try again in 25 s.'),
    );
  });

  it('says so when the server can’t be asked', async () => {
    const { ctx } = setup(() => Promise.reject(new Error('down')));
    render(<TrailerInfo ctx={ctx} target={target} />);

    await screen.findByText('Couldn’t get the server’s trailer status.');
  });
});

describe('Media info’s Trailer section', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const mediaInfo = (): HTMLElement => {
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.innerHTML =
      '<div class="formDialogContent"><div class="dialogContentInner"><div id="mediaInfoContent" class="mediaInfoContent"></div></div></div>';
    document.body.appendChild(dialog);
    return dialog;
  };

  it('goes in beside the stock content once the dialog shows, and stays as jellyfin-web fills that in', async () => {
    const { ctx } = setup(found);
    attachToMediaInfo(ctx, target);
    const dialog = mediaInfo();

    await waitFor(() => expect(dialog.querySelector('.lmn-trailer-info')).not.toBeNull());
    dialog.querySelector('#mediaInfoContent')!.innerHTML = '<span class="mediaInfoLabel">Container</span>';
    await screen.findByText('Found: 1080p, 720p available');
    expect(dialog.querySelector('#mediaInfoContent + div > .lmn-trailer-info')).not.toBeNull();
    expect(dialog.querySelector('#mediaInfoContent')!.textContent).toBe('Container');

    // Once, however often it's asked; gone as the dialog closes.
    attachToMediaInfo(ctx, target);
    expect(dialog.querySelectorAll('.lmn-trailer-info')).toHaveLength(1);
    act(() => void dialog.dispatchEvent(new Event('close')));
    expect(dialog.querySelector('.lmn-trailer-info')).toBeNull();
  });

  it('gives up on a dialog that never shows, and leaves the next one to the next call', async () => {
    vi.useFakeTimers();
    const { ctx } = setup(found);
    attachToMediaInfo(ctx, target);
    vi.advanceTimersByTime(10_001);
    const late = mediaInfo();
    await Promise.resolve();
    vi.useRealTimers();
    expect(late.querySelector('.lmn-trailer-info')).toBeNull();

    document.body.innerHTML = '';
    attachToMediaInfo(ctx, { ...target, key: 'other' });
    attachToMediaInfo(ctx, target);
    const dialog = mediaInfo();
    await screen.findByText('Found: 1080p, 720p available');
    expect(dialog.querySelectorAll('.lmn-trailer-info')).toHaveLength(1);
  });
});

describe('Trailer info (a show)', () => {
  it('opens Lumen’s dialog with the section, closes on Escape, and gives focus back', async () => {
    const { ctx } = setup(found);
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    act(() => openTrailerInfoDialog(ctx, target, opener));

    const dialog = screen.getByRole('dialog', { name: 'Trailer info: Alpha' });
    await screen.findByText('Found: 1080p, 720p available');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));

    act(() => void fireEvent.keyDown(dialog, { key: 'Escape' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
