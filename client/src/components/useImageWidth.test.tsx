import { render, screen } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../test/fakeClient';
import { FakeResizeObserver, resize, resizeObservers } from '../../test/resizeObserver';
import type { BaseItem } from '../api/types';
import { EpisodeList } from '../views/details/EpisodeList';
import { Card } from './Card';
import { useImageWidth } from './useImageWidth';

const movie: BaseItem = { Id: 'm1', Name: 'Lumen Alpha', Type: 'Movie', BackdropImageTags: ['bd'] };
const episode: BaseItem = {
  Id: 'e1',
  Name: 'Pilot',
  Type: 'Episode',
  IndexNumber: 1,
  ImageTags: { Primary: 'still' },
};
const size = (img: Element | null) => {
  const query = new URL(img!.getAttribute('src')!).searchParams;
  return `${query.get('fillWidth')}×${query.get('fillHeight')}`;
};

function Probe({ fallback = 320 }: { fallback?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useImageWidth(ref, fallback);
  return (
    <div ref={ref} data-testid="box">
      {width}
    </div>
  );
}

describe('useImageWidth', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('devicePixelRatio', 1);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is 0 until measured, then the ladder step of the box; it grows but never shrinks', () => {
    render(<Probe />);
    const box = screen.getByTestId('box');
    expect(box).toHaveTextContent(/^0$/);

    resize(0); // hidden: wait for a real size
    expect(box).toHaveTextContent(/^0$/);
    resize(500);
    expect(box).toHaveTextContent(/^640$/);
    resize(200);
    expect(box).toHaveTextContent(/^640$/);
    resize(700);
    expect(box).toHaveTextContent(/^960$/);
  });

  it('watches every box with one observer and lets go of a box when it unmounts', () => {
    const before = resizeObservers.length;
    const { unmount } = render(
      <>
        <Probe />
        <Probe />
        <Probe />
      </>,
    );
    const observers = resizeObservers.filter((o) => o.observed.size > 0);
    expect(resizeObservers.length - before).toBeLessThanOrEqual(1);
    expect(observers).toHaveLength(1);
    expect(observers[0]!.observed.size).toBe(3);
    unmount();
    expect(observers[0]!.observed.size).toBe(0);
  });

  it('is the fallback step at once where there is no ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    render(<Probe fallback={260} />);
    expect(screen.getByTestId('box')).toHaveTextContent(/^320$/);
  });
});

describe('images sized to their box', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('devicePixelRatio', 1);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('asks for a card stretched across a browse grid column at the width it renders, not 320', () => {
    const { container } = render(
      <Card item={movie} client={createFakeClient()} variant="landscape" onSelect={vi.fn()} />,
    );
    const img = container.querySelector('img');
    // Not fetched at a guessed size before the box is measured.
    expect(img).not.toHaveAttribute('src');

    resize(600, [container.querySelector('.lmn-card__art')!]);
    expect(size(img)).toBe('640×360');
  });

  it("asks for an episode still at a phone's full width, not 320", () => {
    const { container } = render(
      <EpisodeList episodes={[episode]} client={createFakeClient()} onPlay={vi.fn()} />,
    );
    const img = container.querySelector('img');
    expect(img).not.toHaveAttribute('src');

    resize(690);
    expect(size(img)).toBe('960×540');
  });

  it("still asks for one URL for an episode's still in a row card and beside the episode list", () => {
    const client = createFakeClient();
    const { container } = render(
      <>
        <Card item={episode} client={client} variant="landscape" onSelect={vi.fn()} />
        <EpisodeList episodes={[episode]} client={client} onPlay={vi.fn()} />
      </>,
    );
    // A 320 px row card (318 inside its border) and the 260 px episode column (258).
    resize(318, [container.querySelector('.lmn-card__art')!]);
    resize(258, [container.querySelector('.lmn-episode__thumb img')!]);

    const [card, still] = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src'));
    expect(card).toContain('Items/e1/Images/Primary');
    expect(still).toBe(card);
    expect(size(container.querySelector('img'))).toBe('320×180');

    // A card in a wide browse grid column and a phone's full-width still: both on the 960 step, still one URL.
    resize(900, [container.querySelector('.lmn-card__art')!]);
    resize(690, [container.querySelector('.lmn-episode__thumb img')!]);
    const [wideCard, wideStill] = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src'));
    expect(wideStill).toBe(wideCard);
    expect(size(container.querySelector('img'))).toBe('960×540');
  });
});
