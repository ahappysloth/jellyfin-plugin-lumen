import { act, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import type { ClientConfig, HeroItem } from '../../api/types';
import { Hero } from './Hero';

const config: ClientConfig = {
  Enabled: true,
  HomeTakeover: true,
  DetailsTakeover: true,
  AccentColor: '#f5a524',
  HeroIntervalSeconds: 8,
  TrailerPreview: true,
  TrailerDelaySeconds: 4,
  BuildHash: 'h',
};

const items: HeroItem[] = [
  {
    Item: {
      Id: 'a',
      Name: 'Alpha',
      Type: 'Movie',
      Overview: 'First',
      BackdropImageTags: ['b'],
      ImageTags: { Logo: 'l' },
    },
    TrailerItemId: 't1',
  },
  { Item: { Id: 'b', Name: 'Beta', Type: 'Movie', BackdropImageTags: ['b'] }, TrailerItemId: null },
];

describe('Hero', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('shows the first item with logo, overview, and actions', () => {
    const onPlay = vi.fn();
    const onInfo = vi.fn();
    render(
      <Hero items={items} client={createFakeClient()} config={config} onPlay={onPlay} onInfo={onInfo} />,
    );

    expect(screen.getByRole('img', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByText('First')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    fireEvent.click(screen.getByRole('button', { name: 'More Info' }));
    expect(onPlay).toHaveBeenCalledWith(items[0]!.Item);
    expect(onInfo).toHaveBeenCalledWith(items[0]!.Item);
  });

  it('rotates on the configured interval and pauses while hovered', () => {
    const { container } = render(
      <Hero items={items} client={createFakeClient()} config={config} onPlay={vi.fn()} onInfo={vi.fn()} />,
    );

    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.getByRole('heading', { name: 'Beta' })).toBeInTheDocument();

    fireEvent.mouseEnter(container.querySelector('.lmn-hero')!);
    act(() => {
      vi.advanceTimersByTime(20000);
    });
    expect(screen.getByRole('heading', { name: 'Beta' })).toBeInTheDocument();
  });

  it('renders a trailer slot only when enabled and the item has a trailer', () => {
    const { container, rerender } = render(
      <Hero items={items} client={createFakeClient()} config={config} onPlay={vi.fn()} onInfo={vi.fn()} />,
    );
    expect(container.querySelector('.lmn-hero__trailer')).not.toBeNull();

    rerender(
      <Hero
        items={items}
        client={createFakeClient()}
        config={{ ...config, TrailerPreview: false }}
        onPlay={vi.fn()}
        onInfo={vi.fn()}
      />,
    );
    expect(container.querySelector('.lmn-hero__trailer')).toBeNull();
  });

  it('respects reduced motion', () => {
    window.matchMedia = vi
      .fn()
      .mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const { container } = render(
      <Hero items={items} client={createFakeClient()} config={config} onPlay={vi.fn()} onInfo={vi.fn()} />,
    );

    expect(container.querySelector('.lmn-hero__trailer')).toBeNull();
  });
});
