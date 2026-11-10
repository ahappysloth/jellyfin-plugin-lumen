import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import { loadTrailer } from './lazyTrailer';

/** A module that hasn't loaded the trailer preview yet, whatever ran before. */
const freshModule = async () => {
  vi.resetModules();
  return import('./lazyTrailer');
};

const props = { trailerId: 't1', delaySeconds: 4, client: createFakeClient() };

describe('LazyTrailer', () => {
  afterEach(() => {
    cleanup();
    vi.doUnmock('./TrailerPreview');
    vi.resetModules();
  });

  it("shows nothing until the preview's code is in, then the preview", async () => {
    const fresh = await freshModule();
    const { container } = render(<fresh.LazyTrailer {...props} class="lmn-details__trailer" />);
    expect(container).toBeEmptyDOMElement();

    // A fresh import of the preview's code: give it time under load (vi.waitFor defaults to 1 s).
    await vi.waitFor(() => expect(container.querySelector('.lmn-hero__trailer')).not.toBeNull(), {
      timeout: 10_000,
    });
    expect(container.querySelector('.lmn-hero__trailer')).toHaveClass('lmn-details__trailer');
  });

  it("shows no preview if the code can't load, and asks for it again next time", async () => {
    vi.doMock('./TrailerPreview', () => {
      throw new Error('Failed to fetch dynamically imported module');
    });
    const fresh = await freshModule();
    const { container } = render(<fresh.LazyTrailer {...props} />);
    await expect(fresh.loadTrailer()).rejects.toThrow();
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();

    // The file is back (the server restarted, the network returned): the next preview loads it.
    vi.doUnmock('./TrailerPreview');
    vi.doMock('./TrailerPreview', () => ({ TrailerPreview: () => <div data-testid="preview" /> }));
    await expect(fresh.loadTrailer()).resolves.toHaveProperty('TrailerPreview');
  });

  it("passes the page's Pause, Mute and other props through to the preview", async () => {
    vi.doMock('./TrailerPreview', () => ({
      TrailerPreview: (p: { paused?: boolean; muted?: boolean; allowTranscode?: boolean }) => (
        <div
          data-testid="preview"
          data-paused={String(p.paused)}
          data-muted={String(p.muted)}
          data-transcode={String(p.allowTranscode)}
        />
      ),
    }));
    const fresh = await freshModule();
    const { container, rerender } = render(
      <fresh.LazyTrailer {...props} paused={false} muted allowTranscode />,
    );
    await vi.waitFor(() => expect(container.querySelector('[data-testid="preview"]')).not.toBeNull());
    const preview = container.querySelector('[data-testid="preview"]')!;
    expect(preview).toHaveAttribute('data-paused', 'false');
    expect(preview).toHaveAttribute('data-muted', 'true');
    expect(preview).toHaveAttribute('data-transcode', 'true');

    rerender(<fresh.LazyTrailer {...props} paused muted={false} allowTranscode />);
    expect(preview).toHaveAttribute('data-paused', 'true');
    expect(preview).toHaveAttribute('data-muted', 'false');
  });

  it('loads the code once, however often it is asked for', async () => {
    expect(loadTrailer()).toBe(loadTrailer());
    expect(typeof (await loadTrailer()).TrailerPreview).toBe('function');
  });
});
