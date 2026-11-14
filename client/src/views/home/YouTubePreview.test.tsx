import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { render as preactRender } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRAILER_FADE_MS, TRAILER_HOLD_MS, TRAILER_START_TIMEOUT_MS } from './trailerTiming';
import { coverSize, YOUTUBE_CHROME_MS, YOUTUBE_DWELL_MS, YouTubePreview } from './YouTubePreview';

import { lastAttempt } from '../trailerInfo/deviceLog';

const ORIGIN = 'https://www.youtube-nocookie.com';
const ID = 'dQw4w9WgXcQ';

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const frameOf = (container: Element) => container.querySelector('iframe');
const srcOf = (container: Element) => new URL(frameOf(container)!.getAttribute('src')!);

/**
 * The player in the frame, as far as the page can tell: what it's sent, and a way for it to say something back.
 * jsdom loads nothing into the frame, so every message is the test's.
 */
const playerIn = (container: Element, origin = ORIGIN) => {
  const frame = frameOf(container)!;
  const posted: { func?: string; args?: unknown[]; event: string }[] = [];
  vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(((data: string) => {
    posted.push(JSON.parse(data));
  }) as Window['postMessage']);
  const say = (event: string, info?: unknown) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ event, info, id: 'lumen', channel: 'widget' }),
          origin,
          source: frame.contentWindow,
        }),
      );
    });
  return {
    frame,
    posted,
    say,
    commands: () => posted.filter((p) => p.event === 'command').map((p) => p.func),
    /** The commands, but for taking its captions off (it's told again whenever it plays). */
    told: () => posted.filter((p) => p.event === 'command' && p.func !== 'unloadModule').map((p) => p.func),
    /** Loaded and answering, not started yet. */
    ready: (duration = 120) => {
      fireEvent.load(frame);
      say('initialDelivery', { playerState: -1, currentTime: 0, duration });
      say('onReady', null);
    },
    /** Playing, at `currentTime`. */
    play: (currentTime = 0) => say('infoDelivery', { playerState: 1, currentTime }),
    tick: (currentTime: number) => say('infoDelivery', { currentTime }),
  };
};

/** Mounted, its frame up (a delay of 4 s is all spent on YouTube's own interface), loaded and playing. */
const playing = (props: Partial<Parameters<typeof YouTubePreview>[0]> = {}) => {
  const view = render(<YouTubePreview youTubeId={ID} delaySeconds={4} {...props} />);
  advance(Math.max(YOUTUBE_DWELL_MS, (props.delaySeconds ?? 4) * 1000 - YOUTUBE_CHROME_MS));
  const player = playerIn(view.container);
  player.ready();
  player.play();
  return { ...view, player };
};

describe('YouTubePreview', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  });

  it('loads the player ahead of the delay by as long as its own interface shows, and no sooner', () => {
    const { container } = render(<YouTubePreview youTubeId={ID} delaySeconds={10} />);
    advance(10_000 - YOUTUBE_CHROME_MS - 1);
    expect(frameOf(container)).toBeNull();
    advance(1);
    expect(frameOf(container)).not.toBeNull();
  });

  it('loads it once the title has been up a moment when the delay is shorter than that, not before', () => {
    const { container } = render(<YouTubePreview youTubeId={ID} delaySeconds={4} />);
    advance(YOUTUBE_DWELL_MS - 1);
    expect(frameOf(container)).toBeNull();
    advance(1);
    expect(frameOf(container)).not.toBeNull();
  });

  it('asks YouTube for nothing for a title that was only passed through', () => {
    const { container, unmount } = render(<YouTubePreview youTubeId={ID} delaySeconds={0} />);
    advance(YOUTUBE_DWELL_MS - 1);
    expect(frameOf(container)).toBeNull();
    unmount(); // the next slide
    advance(YOUTUBE_DWELL_MS);
    expect(document.querySelector('iframe')).toBeNull();
  });

  it("frames YouTube's no-cookie player for this video: muted, inline, no controls, and out of reach", () => {
    const { container } = render(
      <YouTubePreview youTubeId={ID} delaySeconds={0} class="lmn-details__trailer" />,
    );
    advance(YOUTUBE_DWELL_MS);
    const url = srcOf(container);
    expect(url.origin + url.pathname).toBe(`${ORIGIN}/embed/${ID}`);
    expect(url.searchParams.get('autoplay')).toBe('1');
    expect(url.searchParams.get('mute')).toBe('1');
    expect(url.searchParams.get('controls')).toBe('0');
    expect(url.searchParams.get('playsinline')).toBe('1');
    expect(url.searchParams.get('enablejsapi')).toBe('1');
    expect(url.searchParams.get('origin')).toBe(window.location.origin);
    expect(url.searchParams.has('start')).toBe(false);

    const frame = frameOf(container)!;
    expect(frame).toHaveClass('lmn-hero__video');
    expect(frame).not.toHaveClass('is-shown');
    // No click, tap, focus or pop-up: swipes and the page's buttons work as they do over a backdrop.
    expect(frame.style.pointerEvents).toBe('none');
    expect(frame).toHaveAttribute('tabindex', '-1');
    expect(frame).toHaveAttribute('inert');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin');
    expect(frame).toHaveAttribute('allow', 'autoplay; encrypted-media');
    expect(frame).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    const wrapper = container.querySelector('.lmn-hero__trailer')!;
    expect(wrapper).toHaveClass('lmn-details__trailer');
    expect(wrapper).toHaveAttribute('aria-hidden', 'true');
  });

  it.each(['', 'short', 'dQw4w9WgXcQ"><script>', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'])(
    'shows nothing for %j, which is no video id',
    (id) => {
      const onFinish = vi.fn();
      const { container } = render(<YouTubePreview youTubeId={id} delaySeconds={0} onFinish={onFinish} />);
      advance(TRAILER_START_TIMEOUT_MS);
      expect(frameOf(container)).toBeNull();
      expect(onFinish).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps the backdrop until it plays and its interface has gone, then fades in', () => {
    const onPlayingChange = vi.fn();
    const { container } = render(
      <YouTubePreview youTubeId={ID} delaySeconds={4} onPlayingChange={onPlayingChange} />,
    );
    advance(YOUTUBE_DWELL_MS);
    const player = playerIn(container);
    player.ready();
    advance(3000); // loading, buffering: nothing to see
    expect(player.frame).not.toHaveClass('is-shown');

    player.play();
    advance(YOUTUBE_CHROME_MS - 1);
    expect(player.frame).not.toHaveClass('is-shown');
    expect(onPlayingChange).not.toHaveBeenCalledWith(true);

    advance(1);
    expect(player.frame).toHaveClass('is-shown');
    expect(onPlayingChange).toHaveBeenLastCalledWith(true);
  });

  it("takes the player's captions off, and starts one that hasn't begun", () => {
    const { container } = render(<YouTubePreview youTubeId={ID} delaySeconds={0} />);
    advance(YOUTUBE_DWELL_MS);
    const player = playerIn(container);
    player.ready();
    expect(player.posted[0]).toMatchObject({ event: 'listening' });
    expect(player.commands()).toContain('unloadModule');
    expect(player.posted.find((p) => p.func === 'unloadModule')!.args).toEqual(['captions']);
    expect(player.commands()).toContain('playVideo');
  });

  it('talks to a player whose frame had loaded before the page got to listen for it', async () => {
    // Without act(): Preact then runs effects when it would in a browser, a frame after the DOM changed. A cached
    // player (or the tests' stub, on this machine) can load within that frame.
    const container = document.createElement('div');
    document.body.append(container);
    try {
      preactRender(<YouTubePreview youTubeId={ID} delaySeconds={0} />, container);
      for (let ms = 0; ms < YOUTUBE_DWELL_MS + 500 && !frameOf(container); ms++)
        await vi.advanceTimersByTimeAsync(1);
      const frame = frameOf(container)!;
      const posted: string[] = [];
      vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(((data: string) => {
        posted.push((JSON.parse(data) as { event: string }).event);
      }) as Window['postMessage']);
      fireEvent.load(frame);
      expect(posted).toEqual([]); // nothing is listening for the load yet

      await vi.advanceTimersByTimeAsync(200);
      expect(posted[0]).toBe('listening');
    } finally {
      preactRender(null, container);
      container.remove();
    }
  });

  it("doesn't tell a player that's already going to play", () => {
    const { container } = render(<YouTubePreview youTubeId={ID} delaySeconds={0} />);
    advance(YOUTUBE_DWELL_MS);
    const player = playerIn(container);
    fireEvent.load(player.frame);
    player.say('initialDelivery', { playerState: 3, currentTime: 0, duration: 120 });
    expect(player.commands()).not.toContain('playVideo');
  });

  it('follows the trailer for the page from when it plays: its time, length and whether it is still there', () => {
    const onProgress = vi.fn();
    const { player, unmount } = playing({ onProgress });
    expect(onProgress).toHaveBeenCalledTimes(1);
    // Before it shows: a hero slide that waits for its trailer holds on through the player's interface.
    player.tick(1);
    expect(player.frame).not.toHaveClass('is-shown');
    expect(onProgress).toHaveBeenCalledTimes(2);

    advance(YOUTUBE_CHROME_MS);
    player.tick(4.6);
    expect(onProgress).toHaveBeenCalledTimes(3);
    const clock = onProgress.mock.calls[2]![0] as {
      currentTime: number;
      duration: number;
      isConnected: boolean;
    };
    expect(clock.currentTime).toBeCloseTo(4.6, 3);
    expect(clock.duration).toBe(120);
    expect(clock.isConnected).toBe(true);
    advance(200);
    expect(clock.currentTime).toBeCloseTo(4.8, 3); // runs on between the player's messages

    unmount();
    expect(clock.isConnected).toBe(false);
  });

  it('Pause stops it and gives the backdrop back; Play picks it up a few seconds back and fades it in again', () => {
    const { player, rerender } = playing();
    advance(YOUTUBE_CHROME_MS);
    player.tick(20);
    expect(player.frame).toHaveClass('is-shown');
    player.posted.length = 0;

    rerender(<YouTubePreview youTubeId={ID} delaySeconds={4} paused />);
    expect(player.commands()).toEqual(['pauseVideo']);
    player.say('infoDelivery', { playerState: 2, currentTime: 20 });
    expect(player.frame).not.toHaveClass('is-shown');
    expect(frameOf(document.body)).toBe(player.frame); // still there, where it stopped
    player.posted.length = 0;

    rerender(<YouTubePreview youTubeId={ID} delaySeconds={4} />);
    expect(player.commands()).toEqual(['seekTo', 'playVideo']);
    // Its interface shows again as it resumes: back by as long as that takes, so it shows where it was paused.
    expect(player.posted[0]!.args).toEqual([20 - YOUTUBE_CHROME_MS / 1000, true]);
    player.say('infoDelivery', { playerState: 1, currentTime: 15.5 });
    advance(YOUTUBE_CHROME_MS - 1);
    expect(player.frame).not.toHaveClass('is-shown');
    advance(1);
    expect(player.frame).toHaveClass('is-shown');
  });

  it('keeps the page told it is playing through Pause and Play, so its controls stay', () => {
    const onPlayingChange = vi.fn();
    const { player, rerender } = playing({ onPlayingChange });
    advance(YOUTUBE_CHROME_MS);
    expect(onPlayingChange).toHaveBeenLastCalledWith(true);
    onPlayingChange.mockClear();

    rerender(<YouTubePreview youTubeId={ID} delaySeconds={4} onPlayingChange={onPlayingChange} paused />);
    player.say('infoDelivery', { playerState: 2, currentTime: 9 });
    rerender(<YouTubePreview youTubeId={ID} delaySeconds={4} onPlayingChange={onPlayingChange} />);
    player.say('infoDelivery', { playerState: 1, currentTime: 4.5 });
    advance(YOUTUBE_CHROME_MS);
    expect(onPlayingChange).not.toHaveBeenCalledWith(false);
  });

  it("waits when it's mounted paused, and plays when that's lifted", () => {
    const { container, rerender } = render(<YouTubePreview youTubeId={ID} delaySeconds={0} paused />);
    advance(YOUTUBE_DWELL_MS);
    expect(srcOf(container).searchParams.get('autoplay')).toBe('0');
    const player = playerIn(container);
    player.ready();
    expect(player.commands()).not.toContain('playVideo');
    // Not expected to play: the start watchdog doesn't give up on it.
    advance(TRAILER_START_TIMEOUT_MS * 2);
    expect(frameOf(container)).not.toBeNull();

    rerender(<YouTubePreview youTubeId={ID} delaySeconds={0} />);
    expect(player.commands()).toContain('playVideo');
    expect(player.commands()).not.toContain('seekTo'); // nothing was shown yet: nothing to go back for
  });

  it('pauses a player that started although it was told to wait', () => {
    const { container } = render(<YouTubePreview youTubeId={ID} delaySeconds={0} paused />);
    advance(YOUTUBE_DWELL_MS);
    const player = playerIn(container);
    player.ready();
    player.play();
    expect(player.commands()).toContain('pauseVideo');
    advance(YOUTUBE_CHROME_MS);
    expect(player.frame).not.toHaveClass('is-shown');
  });

  it('gives the backdrop back while it stalls, and shows again once it has played on', () => {
    const { player } = playing();
    advance(YOUTUBE_CHROME_MS);
    expect(player.frame).toHaveClass('is-shown');

    player.say('onStateChange', 3);
    expect(player.frame).not.toHaveClass('is-shown');
    player.say('onStateChange', 1);
    advance(YOUTUBE_CHROME_MS);
    expect(player.frame).toHaveClass('is-shown');
  });

  it("fades back to the backdrop shortly before the end, ahead of the player's end screen, then goes", () => {
    const onFinish = vi.fn();
    const onPlayingChange = vi.fn();
    const { container, player } = playing({ onFinish, onPlayingChange });
    advance(YOUTUBE_CHROME_MS);
    player.tick(110);
    expect(player.frame).toHaveClass('is-shown');
    expect(onFinish).not.toHaveBeenCalled();

    player.tick(118);
    expect(player.frame).not.toHaveClass('is-shown');
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onPlayingChange).toHaveBeenLastCalledWith(false);
    expect(frameOf(container)).toBe(player.frame); // fading

    player.say('infoDelivery', { playerState: 0, currentTime: 120 });
    advance(TRAILER_FADE_MS);
    expect(frameOf(container)).toBeNull();
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('is over when the player says it ended, shown or not', () => {
    const onFinish = vi.fn();
    const { container, player } = playing({ onFinish });
    player.say('onStateChange', 0); // a trailer shorter than the wait for its interface
    expect(frameOf(container)).toBeNull();
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it.each([2, 5, 100, 101, 150])('keeps the backdrop, with no message, on error %i', (code) => {
    const onFinish = vi.fn();
    const { container } = render(<YouTubePreview youTubeId={ID} delaySeconds={0} onFinish={onFinish} />);
    advance(YOUTUBE_DWELL_MS);
    const player = playerIn(container);
    player.ready();
    player.say('onError', code);
    expect(frameOf(container)).toBeNull();
    expect(container.textContent).toBe('');
    expect(onFinish).toHaveBeenCalledTimes(1);
    // And it stays that way.
    advance(60_000);
    expect(frameOf(container)).toBeNull();
  });

  it('gives up on a player that never starts (blocked, offline), keeping the backdrop', () => {
    const onFinish = vi.fn();
    const { container } = render(<YouTubePreview youTubeId={ID} delaySeconds={0} onFinish={onFinish} />);
    advance(YOUTUBE_DWELL_MS);
    advance(TRAILER_START_TIMEOUT_MS - 1);
    expect(frameOf(container)).not.toBeNull();
    advance(1);
    expect(frameOf(container)).toBeNull();
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("doesn't give up on one that starts late: it's playing, and shows once its interface has gone", () => {
    const { container } = render(<YouTubePreview youTubeId={ID} delaySeconds={0} />);
    advance(YOUTUBE_DWELL_MS);
    const player = playerIn(container);
    player.ready();
    advance(8000); // a slow network
    player.play();
    advance(TRAILER_START_TIMEOUT_MS - 8000 + 1);
    expect(frameOf(container)).toBe(player.frame);
    advance(YOUTUBE_CHROME_MS - (TRAILER_START_TIMEOUT_MS - 8000 + 1));
    expect(player.frame).toHaveClass('is-shown');

    // Stalling later still gives it the whole wait again.
    player.say('onStateChange', 3);
    advance(TRAILER_START_TIMEOUT_MS - 1);
    expect(frameOf(container)).toBe(player.frame);
    advance(1);
    expect(frameOf(container)).toBeNull();
  });

  it("doesn't give up on one that's playing, shown or about to be", () => {
    const { container, player } = playing();
    advance(YOUTUBE_CHROME_MS - 1);
    expect(frameOf(container)).toBe(player.frame);
    advance(1);
    expect(player.frame).toHaveClass('is-shown');
    advance(TRAILER_START_TIMEOUT_MS * 3);
    expect(frameOf(container)).toBe(player.frame);
  });

  it('gives up on one that stalls and does not come back, so nothing waits on it for good', () => {
    const onFinish = vi.fn();
    const { container, player } = playing({ onFinish });
    advance(YOUTUBE_CHROME_MS);
    player.say('onStateChange', 3);
    advance(TRAILER_START_TIMEOUT_MS - 1);
    expect(frameOf(container)).toBe(player.frame);
    advance(1);
    expect(frameOf(container)).toBeNull();
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('pauses while the page is in the background, and plays on when it is back, a few seconds back, unseen till then', () => {
    const onPlayingChange = vi.fn();
    const { container, player } = playing({ delaySeconds: 6, onPlayingChange });
    advance(YOUTUBE_CHROME_MS);
    expect(player.frame).toHaveClass('is-shown');
    player.posted.length = 0;
    act(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    // The same player, paused: nothing plays unseen, and the page knows it isn't playing.
    expect(frameOf(container)).toBe(player.frame);
    expect(player.commands()).toEqual(['pauseVideo']);
    expect(onPlayingChange).toHaveBeenLastCalledWith(false);
    player.say('onStateChange', 2);
    expect(player.frame).not.toHaveClass('is-shown');
    // Paused out of view isn't a stall.
    advance(TRAILER_START_TIMEOUT_MS);
    expect(frameOf(container)).toBe(player.frame);

    act(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(frameOf(container)).toBe(player.frame);
    expect(player.commands()).toEqual(['pauseVideo', 'seekTo', 'playVideo']);
    player.play(30);
    advance(YOUTUBE_CHROME_MS);
    expect(player.frame).toHaveClass('is-shown');
    expect(onPlayingChange).toHaveBeenLastCalledWith(true);
  });

  it('lets the player go once it has been out of view for long, and starts over after the delay when back', () => {
    const { container, player } = playing({ delaySeconds: 6 });
    act(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    advance(TRAILER_HOLD_MS - 1);
    expect(frameOf(container)).toBe(player.frame);
    advance(1);
    expect(frameOf(container)).toBeNull(); // nothing plays, or downloads, unseen

    act(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(frameOf(container)).toBeNull();
    advance(6000 - YOUTUBE_CHROME_MS);
    expect(frameOf(container)).not.toBeNull();
    expect(frameOf(container)).not.toBe(player.frame);
    expect(frameOf(container)).not.toHaveClass('is-shown');
  });

  it('out of view before it has shown, tells the page it is not playing: it waits to be seen', () => {
    const onPlayingChange = vi.fn();
    const { container, player } = playing({ onPlayingChange });
    advance(1000);
    onPlayingChange.mockClear();
    act(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(frameOf(container)).toBe(player.frame);
    expect(onPlayingChange).toHaveBeenCalledWith(false);
    expect(player.commands()).toContain('pauseVideo');
  });

  it("is put back where the hero says it was, less what plays unseen before it's shown", () => {
    const { container } = render(<YouTubePreview youTubeId={ID} delaySeconds={0} startAt={() => 42.7} />);
    advance(0);
    expect(srcOf(container).searchParams.get('start')).toBe('38');
    cleanup();

    const early = render(<YouTubePreview youTubeId={ID} delaySeconds={0} startAt={() => 3} />);
    advance(0);
    expect(srcOf(early.container).searchParams.has('start')).toBe(false);
  });

  it('unmuted, has sound only once it shows, and mutes and unmutes when the page asks', () => {
    const { container, rerender } = render(<YouTubePreview youTubeId={ID} delaySeconds={0} muted={false} />);
    advance(YOUTUBE_DWELL_MS);
    const player = playerIn(container);
    player.ready();
    player.play();
    // It must start muted to start at all, and nothing is to be heard over the backdrop.
    advance(YOUTUBE_CHROME_MS - 1);
    expect(player.commands()).not.toContain('unMute');
    advance(1);
    expect(player.frame).toHaveClass('is-shown');
    expect(player.commands()).toContain('unMute');
    player.posted.length = 0;

    rerender(<YouTubePreview youTubeId={ID} delaySeconds={0} muted />);
    rerender(<YouTubePreview youTubeId={ID} delaySeconds={0} muted={false} />);
    expect(player.commands()).toEqual(['mute', 'unMute']);
  });

  it('unmuted, plays muted again whenever the backdrop is back: Pause and Play, a stall', () => {
    const { container, rerender } = render(<YouTubePreview youTubeId={ID} delaySeconds={0} muted={false} />);
    advance(YOUTUBE_DWELL_MS);
    const player = playerIn(container);
    player.ready();
    player.play();
    advance(YOUTUBE_CHROME_MS);
    player.tick(20);
    player.posted.length = 0;

    rerender(<YouTubePreview youTubeId={ID} delaySeconds={0} muted={false} paused />);
    player.say('infoDelivery', { playerState: 2, currentTime: 20 });
    expect(player.told()).toEqual(['pauseVideo', 'mute']);
    player.posted.length = 0;

    // Play goes back a few seconds, unseen: those play without sound, until the picture is back.
    rerender(<YouTubePreview youTubeId={ID} delaySeconds={0} muted={false} />);
    player.say('infoDelivery', { playerState: 1, currentTime: 15.5 });
    advance(YOUTUBE_CHROME_MS - 1);
    expect(player.told()).toEqual(['seekTo', 'playVideo']);
    advance(1);
    expect(player.frame).toHaveClass('is-shown');
    expect(player.told()).toEqual(['seekTo', 'playVideo', 'unMute']);
    player.posted.length = 0;

    player.say('onStateChange', 3);
    expect(player.told()).toEqual(['mute']);
    player.say('onStateChange', 1);
    advance(YOUTUBE_CHROME_MS);
    expect(player.told()).toEqual(['mute', 'unMute']);
  });

  it('unmuted and stopped by the browser for it (no tap to allow sound), plays on muted', () => {
    const { container, rerender } = render(<YouTubePreview youTubeId={ID} delaySeconds={0} muted={false} />);
    advance(YOUTUBE_DWELL_MS);
    const player = playerIn(container);
    player.ready();
    player.play();
    advance(YOUTUBE_CHROME_MS);
    player.posted.length = 0;

    player.say('onStateChange', 2); // nobody asked for that
    expect(player.told()).toEqual(['mute', 'playVideo']);
    player.say('onStateChange', 1);
    advance(YOUTUBE_CHROME_MS);
    expect(player.frame).toHaveClass('is-shown');
    expect(player.commands()).not.toContain('unMute');

    // Unmute pressed again (a tap): sound is tried again.
    rerender(<YouTubePreview youTubeId={ID} delaySeconds={0} muted />);
    rerender(<YouTubePreview youTubeId={ID} delaySeconds={0} muted={false} />);
    expect(player.told()).toEqual(['mute', 'playVideo', 'mute', 'unMute']);
  });

  it("loads the tests' stub player from where the server says, and listens to that origin only", () => {
    const stub = 'http://localhost:5055';
    const { container } = render(<YouTubePreview youTubeId={ID} delaySeconds={0} embedBase={stub} />);
    advance(YOUTUBE_DWELL_MS);
    expect(srcOf(container).origin).toBe(stub);

    const real = playerIn(container); // says it's YouTube: not where this frame was loaded from
    real.play();
    advance(YOUTUBE_CHROME_MS);
    expect(real.frame).not.toHaveClass('is-shown');

    const player = playerIn(container, stub);
    player.play();
    advance(YOUTUBE_CHROME_MS);
    expect(player.frame).toHaveClass('is-shown');
  });

  it('removes the frame, and stops listening, when it is unmounted', () => {
    const onProgress = vi.fn();
    const { container, player, unmount } = playing({ onProgress });
    advance(YOUTUBE_CHROME_MS);
    onProgress.mockClear();
    unmount();
    expect(frameOf(container)).toBeNull();
    player.tick(30);
    expect(onProgress).not.toHaveBeenCalled();
  });
});

describe('coverSize', () => {
  const covers = (box: { width: number; height: number }) => {
    const size = coverSize(box);
    // 16:9, to the pixel's rounding.
    expect(size.width / size.height).toBeCloseTo(16 / 9, 1);
    // Covers the box, centred, with YouTube's top and bottom rows (60 px each) outside it.
    expect(size.left).toBeLessThanOrEqual(0);
    expect(size.left + size.width).toBeGreaterThanOrEqual(box.width);
    expect(size.top).toBeLessThanOrEqual(-60);
    expect(size.top + size.height).toBeGreaterThanOrEqual(box.height + 60);
    expect(Math.abs(size.left + size.width / 2 - box.width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(size.top + size.height / 2 - box.height / 2)).toBeLessThanOrEqual(1);
    return size;
  };

  it('covers a wide desktop hero, a phone hero and a square box', () => {
    expect(covers({ width: 1280, height: 634 })).toMatchObject({ width: 1341, height: 754 });
    expect(covers({ width: 393, height: 514 })).toMatchObject({ width: 1128, height: 634 });
    covers({ width: 2560, height: 900 });
    covers({ width: 800, height: 800 });
    covers({ width: 1920, height: 1080 });
  });
});

describe('YouTubePreview notes how it went on this device (its Media info)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('the player’s error code', () => {
    const { container } = render(<YouTubePreview youTubeId={ID} delaySeconds={0} logKey="m1" />);
    advance(YOUTUBE_DWELL_MS);
    const player = playerIn(container);
    player.ready();
    player.say('onError', 150);
    expect(lastAttempt('m1')!.steps).toEqual([{ source: 'youtube', outcome: 'error', code: 150 }]);
  });

  it('a player that never started', () => {
    render(<YouTubePreview youTubeId={ID} delaySeconds={0} logKey="m1" />);
    advance(YOUTUBE_DWELL_MS);
    advance(TRAILER_START_TIMEOUT_MS);
    expect(lastAttempt('m1')!.steps).toEqual([{ source: 'youtube', outcome: 'timeout' }]);
  });

  it('one that played, and how long after its frame was asked for', () => {
    const view = render(<YouTubePreview youTubeId={ID} delaySeconds={0} logKey="m1" />);
    advance(YOUTUBE_DWELL_MS);
    const player = playerIn(view.container);
    advance(1500);
    player.ready();
    player.play();
    expect(lastAttempt('m1')!.steps).toEqual([{ source: 'youtube', outcome: 'played', ms: 1500 }]);
  });
});
