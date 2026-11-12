import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import { PENDING_CLASS } from '../../veil/veil';
import { loadSecondary } from './lazySecondary';

/** A module that hasn't loaded the file yet, whatever ran before. */
const freshModule = async () => {
  vi.resetModules();
  return import('./lazySecondary');
};

/** A stand-in for the file, quick to load. */
const stubViews = () => ({
  SearchView: ({ initialQuery }: { initialQuery: string }) => <h1 data-testid="search">{initialQuery}</h1>,
  openWatchTogether: vi.fn(() => Promise.resolve()),
});

const failingImport = () => {
  throw new Error('Failed to fetch dynamically imported module');
};

const veiled = () => document.documentElement.classList.contains(PENDING_CLASS);

describe('LazySecondary', () => {
  afterEach(() => {
    cleanup();
    vi.doUnmock('./SecondaryViews');
    vi.resetModules();
    vi.useRealTimers();
    document.documentElement.classList.remove(PENDING_CLASS);
  });

  it('shows the pending page under the veil until the file is in, then the page', async () => {
    vi.doMock('./SecondaryViews', stubViews);
    const fresh = await freshModule();
    document.documentElement.classList.add(PENDING_CLASS);
    const { container } = render(
      <fresh.LazySecondary
        ctx={makeContext(createFakeClient())}
        view={(m) => <m.SearchView initialQuery="alien" ctx={makeContext(createFakeClient())} />}
      />,
    );
    expect(container.querySelector('.lmn-browse__pending')).toHaveAttribute('aria-busy', 'true');
    // A cold load keeps the veil up: the page lifts it once it has something to show (as it did before).
    expect(veiled()).toBe(true);

    expect(await screen.findByTestId('search')).toHaveTextContent('alien');
    expect(container.querySelector('.lmn-browse__pending')).toBeNull();
    expect(veiled()).toBe(true);
  });

  it('lifts the veil as the file arrives for a page that draws its header at once', async () => {
    vi.doMock('./SecondaryViews', stubViews);
    const fresh = await freshModule();
    document.documentElement.classList.add(PENDING_CLASS);
    render(
      <fresh.LazySecondary
        ctx={makeContext(createFakeClient())}
        liftOnLoad
        view={() => <h1 data-testid="history">History</h1>}
      />,
    );
    await screen.findByTestId('history');
    await waitFor(() => expect(veiled()).toBe(false));
  });

  it("shows Lumen's error page if the file can't load, and Try again asks for it again", async () => {
    vi.doMock('./SecondaryViews', failingImport);
    const fresh = await freshModule();
    document.documentElement.classList.add(PENDING_CLASS);
    const onBack = vi.fn();
    render(
      <fresh.LazySecondary
        ctx={makeContext(createFakeClient())}
        onBack={onBack}
        view={(m) => <m.SearchView initialQuery="alien" ctx={makeContext(createFakeClient())} />}
      />,
    );

    expect(await screen.findByRole('heading', { name: "Couldn't load this page" })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t load/i);
    // The veil doesn't stay over the error.
    expect(veiled()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalled();

    // The file is back (the server restarted, the network returned).
    vi.doUnmock('./SecondaryViews');
    vi.doMock('./SecondaryViews', stubViews);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('search')).toHaveTextContent('alien');
  });

  it('shows a page of its own instead when given one', async () => {
    vi.doMock('./SecondaryViews', failingImport);
    const fresh = await freshModule();
    render(
      <fresh.LazySecondary
        ctx={makeContext(createFakeClient())}
        failed={(retry) => (
          <button type="button" onClick={retry}>
            Again
          </button>
        )}
        view={() => <p>never</p>}
      />,
    );
    expect(await screen.findByRole('button', { name: 'Again' })).toBeInTheDocument();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('shows the error if the file takes too long', async () => {
    vi.doMock('./SecondaryViews', () => new Promise(() => undefined)); // a download that never finishes
    const fresh = await freshModule();
    vi.useFakeTimers();
    render(<fresh.LazySecondary ctx={makeContext(createFakeClient())} view={() => <p>never</p>} />);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(screen.queryByRole('alert')).toBeNull();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('prefetches the file once, when the browser is idle, so a page opens at once', async () => {
    const factory = vi.fn(stubViews);
    vi.doMock('./SecondaryViews', factory);
    const fresh = await freshModule();
    vi.useFakeTimers();
    fresh.prefetchSecondary();
    fresh.prefetchSecondary();
    expect(factory).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(factory).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
    await fresh.loadSecondary();
    render(
      <fresh.LazySecondary
        ctx={makeContext(createFakeClient())}
        view={(m) => <m.SearchView initialQuery="x" ctx={makeContext(createFakeClient())} />}
      />,
    );
    expect(screen.getByTestId('search')).toBeInTheDocument();
  });

  it('opens the Watch together menu from the file, and nothing if it cannot load', async () => {
    const views = stubViews();
    vi.doMock('./SecondaryViews', () => views);
    let fresh = await freshModule();
    const ctx = makeContext(createFakeClient());
    const state = { group: null, canCreate: true, canStart: false, canStop: false, self: 'Ann' };
    const button = document.createElement('button');
    await fresh.openWatchTogether(ctx, state as never, button);
    expect(views.openWatchTogether).toHaveBeenCalledWith(ctx, state, button, button);

    vi.doUnmock('./SecondaryViews');
    vi.doMock('./SecondaryViews', failingImport);
    fresh = await freshModule();
    await expect(fresh.openWatchTogether(ctx, state as never, button)).resolves.toBeUndefined();
  });

  it('loads the real file once, however often it is asked for', async () => {
    expect(loadSecondary()).toBe(loadSecondary());
    const module = await loadSecondary();
    expect(typeof module.SearchView).toBe('function');
    expect(typeof module.PersonDetails).toBe('function');
    expect(typeof module.openWatchTogether).toBe('function');
  }, 10_000);
});
