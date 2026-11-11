import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import { loadProfile } from './lazyProfile';

/** A module that hasn't loaded the profile pages yet, whatever ran before. */
const freshModule = async () => {
  vi.resetModules();
  return import('./lazyProfile');
};

const stubPages = () => ({
  ProfileView: () => <section data-testid="profile" />,
  SettingsFrame: (p: { page: string }) => <div data-testid="frame">{p.page}</div>,
});

const failingImport = () => {
  throw new Error('Failed to fetch dynamically imported module');
};

describe('lazyProfile', () => {
  afterEach(() => {
    cleanup();
    vi.doUnmock('./ProfilePages');
    vi.resetModules();
    vi.useRealTimers();
  });

  it("shows the profile page's empty loading page until its code is in, then the page", async () => {
    vi.doMock('./ProfilePages', stubPages);
    const fresh = await freshModule();
    const { container } = render(<fresh.LazyProfileView ctx={makeContext(createFakeClient())} />);
    expect(container.querySelector('.lmn-browse__pending')).toHaveAttribute('aria-busy', 'true');
    expect(await screen.findByTestId('profile')).toBeInTheDocument();
  });

  it("hands the profile page to the stock one if the code can't load, and asks for it again next time", async () => {
    vi.doMock('./ProfilePages', failingImport);
    const fresh = await freshModule();
    const ctx = makeContext(createFakeClient());
    render(<fresh.LazyProfileView ctx={ctx} />);
    await vi.waitFor(() => expect(ctx.onFallback).toHaveBeenCalled());

    vi.doUnmock('./ProfilePages');
    vi.doMock('./ProfilePages', stubPages);
    await expect(fresh.loadProfile()).resolves.toHaveProperty('ProfileView');
  });

  it('hands the profile page to the stock one if the code takes too long', async () => {
    vi.doMock('./ProfilePages', () => new Promise(() => undefined)); // a download that never finishes
    const fresh = await freshModule();
    vi.useFakeTimers();
    const ctx = makeContext(createFakeClient());
    render(<fresh.LazyProfileView ctx={ctx} />);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(ctx.onFallback).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(ctx.onFallback).toHaveBeenCalled();
  });

  it('shows the settings frame once its code is in', async () => {
    vi.doMock('./ProfilePages', stubPages);
    const fresh = await freshModule();
    const { container } = render(<fresh.LazySettingsFrame page="playback" />);
    expect(container).toBeEmptyDOMElement();
    expect(await screen.findByTestId('frame')).toHaveTextContent('playback');
  });

  it("leaves the stock settings page on its own if the code can't load", async () => {
    vi.doMock('./ProfilePages', failingImport);
    const fresh = await freshModule();
    const { container } = render(<fresh.LazySettingsFrame page="playback" />);
    await expect(fresh.loadProfile()).rejects.toThrow();
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });

  it('loads the real code once, for both pages', async () => {
    expect(loadProfile()).toBe(loadProfile());
    const module = await loadProfile();
    expect(typeof module.ProfileView).toBe('function');
    expect(typeof module.SettingsFrame).toBe('function');
  }, 10_000);
});
