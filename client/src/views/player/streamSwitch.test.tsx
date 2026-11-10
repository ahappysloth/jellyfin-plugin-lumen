import { act, render } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_SHOWN_MS, SwitchOverlay, useStreamSwitch } from './streamSwitch';

function Harness({ onReady }: { onReady: (begin: (label: string) => void) => void }) {
  const { state, begin } = useStreamSwitch();
  onReady(begin);
  return <SwitchOverlay state={state} />;
}

describe('stream switch overlay', () => {
  let video: HTMLVideoElement;
  let begin: (label: string) => void = () => undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    video = document.createElement('video');
    video.className = 'htmlvideoplayer';
    document.body.appendChild(video);
  });
  afterEach(() => {
    video.remove();
    vi.useRealTimers();
  });

  const setup = () => render(<Harness onReady={(b) => (begin = b)} />);
  const fire = (type: string) => act(() => void video.dispatchEvent(new Event(type)));
  const playing = () => {
    Object.defineProperty(video, 'paused', { value: false, configurable: true });
    Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
  };

  it('stays up through a slow restart (a server transcoding for 40 s) and goes once the video plays', () => {
    const { container } = setup();
    act(() => begin('480p'));
    fire('emptied');
    expect(container.textContent).toContain('480p');

    act(() => void vi.advanceTimersByTime(40_000));
    expect(container.querySelector('.lmn-switching')).not.toBeNull();

    playing();
    fire('timeupdate');
    expect(container.querySelector('.lmn-switching')).toBeNull();
  });

  it('goes when the new stream fails, and after the cap at the latest', () => {
    const { container } = setup();
    act(() => begin('480p'));
    fire('emptied');
    fire('error');
    expect(container.querySelector('.lmn-switching')).toBeNull();

    act(() => begin('720p'));
    fire('loadstart');
    act(() => void vi.advanceTimersByTime(MAX_SHOWN_MS));
    expect(container.querySelector('.lmn-switching')).toBeNull();
  });

  it('shows nothing when the change needs no reload', () => {
    const { container } = setup();
    act(() => begin('English'));
    act(() => void vi.advanceTimersByTime(3000));
    fire('emptied');
    expect(container.querySelector('.lmn-switching')).toBeNull();
  });
});
