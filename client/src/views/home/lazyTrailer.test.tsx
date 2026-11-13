import { act, cleanup, render } from '@testing-library/preact';
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

  it("plays the title's trailer from YouTube when it has no local one, from the same download", async () => {
    vi.doMock('./TrailerPreview', () => ({
      TrailerPreview: () => <div data-testid="local" />,
      YouTubePreview: (p: {
        youTubeId: string;
        embedBase?: string | null;
        delaySeconds: number;
        paused?: boolean;
      }) => (
        <div
          data-testid="youtube"
          data-id={p.youTubeId}
          data-base={String(p.embedBase)}
          data-delay={String(p.delaySeconds > 3.5 && p.delaySeconds <= 4)}
          data-paused={String(p.paused)}
        />
      ),
    }));
    const fresh = await freshModule();
    const client = createFakeClient();
    const { container, rerender } = render(
      <fresh.LazyTrailer
        youTubeId="dQw4w9WgXcQ"
        embedBase="http://localhost:5055"
        delaySeconds={4}
        client={client}
        paused
      />,
    );
    await vi.waitFor(() => expect(container.querySelector('[data-testid="youtube"]')).not.toBeNull());
    const preview = container.querySelector('[data-testid="youtube"]')!;
    expect(preview).toHaveAttribute('data-id', 'dQw4w9WgXcQ');
    expect(preview).toHaveAttribute('data-base', 'http://localhost:5055');
    expect(preview).toHaveAttribute('data-delay', 'true');
    expect(preview).toHaveAttribute('data-paused', 'true');
    expect(container.querySelector('[data-testid="local"]')).toBeNull();

    // A local trailer always wins; with neither there is nothing to play.
    rerender(<fresh.LazyTrailer trailerId="t1" youTubeId="dQw4w9WgXcQ" delaySeconds={4} client={client} />);
    expect(container.querySelector('[data-testid="local"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="youtube"]')).toBeNull();
    rerender(<fresh.LazyTrailer trailerId={null} youTubeId={null} delaySeconds={4} client={client} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('counts the delay from when the preview was asked for, the download included', async () => {
    // The code takes 1 s to arrive.
    const actual = await vi.importActual<typeof import('./TrailerPreview')>('./TrailerPreview');
    vi.doMock('./TrailerPreview', () => new Promise((resolve) => setTimeout(() => resolve(actual), 1000)));
    const fresh = await freshModule();
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined); // jsdom has no media playback
    try {
      const start = Date.now();
      const { container } = render(<fresh.LazyTrailer {...props} delaySeconds={4} />);
      /** Runs the clock to `ms` after the render, in steps: effects that an act() schedules run as it ends. */
      const runTo = async (ms: number) => {
        while (Date.now() - start < ms) {
          await act(async () => {
            await vi.advanceTimersByTimeAsync(Math.min(100, ms - (Date.now() - start)));
          });
        }
      };

      await runTo(3900);
      expect(container.querySelector('video')).toBeNull();
      await runTo(4100);
      expect(container.querySelector('video')).not.toBeNull(); // 4 s in, not 5
    } finally {
      cleanup(); // while timers are still fake (see TrailerPreview.test)
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it('loads the code once, however often it is asked for', async () => {
    expect(loadTrailer()).toBe(loadTrailer());
    expect(typeof (await loadTrailer()).TrailerPreview).toBe('function');
    expect(typeof (await loadTrailer()).YouTubePreview).toBe('function');
  });
});
