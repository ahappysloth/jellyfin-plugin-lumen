import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { ProgressBar } from './ProgressBar';
import { trickplayFrame } from './trickplay';

function bar(props: Partial<Parameters<typeof ProgressBar>[0]> = {}) {
  const onSeek = vi.fn();
  const view = render(
    <ProgressBar
      positionMs={10_000}
      durationMs={100_000}
      bufferedMs={0}
      disabled={false}
      onSeek={onSeek}
      {...props}
    />,
  );
  const slider = screen.getByRole('slider');
  slider.getBoundingClientRect = () => ({
    left: 0,
    width: 1000,
    top: 0,
    height: 10,
    right: 1000,
    bottom: 10,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  return { ...view, slider, onSeek };
}

describe('ProgressBar', () => {
  it('stays where you clicked until the player gets there, instead of snapping back', () => {
    const { slider, onSeek, rerender } = bar();

    fireEvent.pointerDown(slider, { button: 0, clientX: 600 });
    fireEvent.pointerUp(slider, { clientX: 600 });

    expect(onSeek).toHaveBeenCalledWith(60_000);
    expect(slider).toHaveAttribute('aria-valuenow', '60'); // not back at 10 s
    rerender(
      <ProgressBar
        positionMs={10_250}
        durationMs={100_000}
        bufferedMs={0}
        disabled={false}
        onSeek={onSeek}
      />,
    );
    expect(slider).toHaveAttribute('aria-valuenow', '60'); // the player hasn't caught up yet
    rerender(
      <ProgressBar
        positionMs={60_400}
        durationMs={100_000}
        bufferedMs={0}
        disabled={false}
        onSeek={onSeek}
      />,
    );
    expect(slider).toHaveAttribute('aria-valuenow', '60');
    rerender(
      <ProgressBar
        positionMs={65_000}
        durationMs={100_000}
        bufferedMs={0}
        disabled={false}
        onSeek={onSeek}
      />,
    );
    expect(slider).toHaveAttribute('aria-valuenow', '65'); // following the player again
  });

  it('adds up quick arrow-key steps from the pending position', () => {
    const { slider, onSeek } = bar();
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onSeek).toHaveBeenLastCalledWith(30_000);
  });

  it('shows the trickplay frame for the time under the pointer', () => {
    const { slider, container } = bar({
      preview: (ms: number) => ({
        url: 'blob:tile0',
        ...trickplayFrame(ms, {
          Width: 320,
          Height: 180,
          TileWidth: 10,
          TileHeight: 10,
          ThumbnailCount: 20,
          Interval: 10_000,
        }),
      }),
    });
    fireEvent.pointerMove(slider, { clientX: 250 }); // 25 s: thumbnail 2

    const thumb = container.querySelector<HTMLElement>('.lmn-seek__thumbnail')!;
    expect(thumb.style.backgroundImage).toContain('blob:tile0');
    expect(thumb.style.backgroundPosition).toBe('-640px 0px');
  });
});

describe('trickplayFrame', () => {
  const info = {
    Width: 320,
    Height: 180,
    TileWidth: 10,
    TileHeight: 10,
    ThumbnailCount: 250,
    Interval: 10_000,
  };
  it('finds the tile and the frame inside it', () => {
    expect(trickplayFrame(0, info)).toMatchObject({ tile: 0, x: 0, y: 0 });
    expect(trickplayFrame(125_000, info)).toMatchObject({ tile: 0, x: 640, y: 180 }); // thumbnail 12
    expect(trickplayFrame(1_015_000, info)).toMatchObject({ tile: 1, x: 160 * 2, y: 0 }); // thumbnail 101
  });
  it('clamps to the last thumbnail', () => {
    expect(trickplayFrame(99_999_999, info)).toMatchObject({ tile: 2, x: 320 * 9, y: 180 * 4 }); // thumbnail 249
  });
});
