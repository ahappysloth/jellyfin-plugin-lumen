import { act, render } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import { TrailerPreview } from './TrailerPreview';

describe('TrailerPreview', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  });

  it('starts a muted, authenticated, static trailer after the delay', () => {
    const { container } = render(
      <TrailerPreview trailerId="t1" delaySeconds={4} client={createFakeClient()} />,
    );
    expect(container.querySelector('video')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    const video = container.querySelector('video')!;
    expect(video.muted).toBe(true);
    expect(video.getAttribute('src')).toBe('http://jf/Videos/t1/stream?static=true&ApiKey=token1');
  });

  it('removes the video on error so the backdrop shows', () => {
    const { container } = render(
      <TrailerPreview trailerId="t1" delaySeconds={0} client={createFakeClient()} />,
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });

    act(() => {
      container.querySelector('video')!.dispatchEvent(new Event('error'));
    });

    expect(container.querySelector('video')).toBeNull();
  });

  it('pauses, unloads, and releases the video when it stops or unmounts', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const { container, unmount } = render(
      <TrailerPreview trailerId="t1" delaySeconds={0} client={createFakeClient()} />,
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    const video = container.querySelector('video')!;

    act(() => {
      unmount();
    });

    expect(pause).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(video.hasAttribute('src')).toBe(false);
    pause.mockRestore();
    load.mockRestore();
  });

  it('stops when the page becomes hidden', () => {
    const { container } = render(
      <TrailerPreview trailerId="t1" delaySeconds={0} client={createFakeClient()} />,
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(container.querySelector('video')).not.toBeNull();

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(container.querySelector('video')).toBeNull();
  });
});
