import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import { PENDING_CLASS } from '../../veil/veil';
import { loadTitle } from './lazyTitle';

/** A module that hasn't loaded the title page yet, whatever ran before. */
const freshModule = async () => {
  vi.resetModules();
  return import('./lazyTitle');
};

/** A stand-in title page, quick to load, that shows what it was given. */
const stubTitleView = () => ({
  TitleView: (p: { mediaType: string; tmdbId: number }) => (
    <article data-testid="title">
      {p.mediaType}-{p.tmdbId}
    </article>
  ),
});

const failingImport = () => {
  throw new Error('Failed to fetch dynamically imported module');
};

describe('LazyTitleView', () => {
  afterEach(() => {
    cleanup();
    vi.doUnmock('./TitleView');
    vi.resetModules();
    vi.useRealTimers();
    document.documentElement.classList.remove(PENDING_CLASS);
  });

  it("shows the title page's empty loading page until its code is in, then the page", async () => {
    vi.doMock('./TitleView', stubTitleView);
    const fresh = await freshModule();
    const { container } = render(
      <fresh.LazyTitleView mediaType="movie" tmdbId={603} ctx={makeContext(createFakeClient())} />,
    );
    // The same placeholder TitleView shows while its data loads, so nothing jumps when it takes over.
    expect(container.querySelector('.lmn-details--loading')).toHaveAttribute('aria-busy', 'true');

    expect(await screen.findByTestId('title')).toHaveTextContent('movie-603');
    expect(container.querySelector('.lmn-details--loading')).toBeNull();
  });

  it("shows the page's error if the code can't load, and Try again asks for it again", async () => {
    vi.doMock('./TitleView', failingImport);
    const fresh = await freshModule();
    document.documentElement.classList.add(PENDING_CLASS);
    render(<fresh.LazyTitleView mediaType="tv" tmdbId={1399} ctx={makeContext(createFakeClient())} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t load/i);
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    // The veil doesn't stay over the error.
    expect(document.documentElement).not.toHaveClass(PENDING_CLASS);

    // The file is back (the server restarted, the network returned).
    vi.doUnmock('./TitleView');
    vi.doMock('./TitleView', stubTitleView);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('title')).toHaveTextContent('tv-1399');
  });

  it('shows the error if the code takes too long', async () => {
    vi.doMock('./TitleView', () => new Promise(() => undefined)); // a download that never finishes
    const fresh = await freshModule();
    vi.useFakeTimers();
    render(<fresh.LazyTitleView mediaType="movie" tmdbId={603} ctx={makeContext(createFakeClient())} />);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(screen.queryByRole('alert')).toBeNull();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('prefetches the code once, when the browser is idle', async () => {
    const factory = vi.fn(stubTitleView);
    vi.doMock('./TitleView', factory);
    const fresh = await freshModule();
    vi.useFakeTimers();
    fresh.prefetchTitle();
    fresh.prefetchTitle(); // every catalog card asks
    expect(factory).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(factory).toHaveBeenCalledTimes(1);

    // Opening a title now shows it at once, without the loading page.
    vi.useRealTimers();
    await fresh.loadTitle();
    render(<fresh.LazyTitleView mediaType="movie" tmdbId={603} ctx={makeContext(createFakeClient())} />);
    expect(screen.getByTestId('title')).toBeInTheDocument();
  });

  it('loads the real code once, however often it is asked for', async () => {
    expect(loadTitle()).toBe(loadTitle());
    // A fresh import of the title page's code: give it time under load.
    expect(typeof (await loadTitle()).TitleView).toBe('function');
  }, 10_000);
});
