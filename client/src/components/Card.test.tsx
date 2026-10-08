import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../test/fakeClient';
import type { BaseItem } from '../api/types';
import { Card } from './Card';

const movie: BaseItem = { Id: 'm1', Name: 'Lumen Alpha', Type: 'Movie', ImageTags: { Primary: 'tag1' } };

describe('Card', () => {
  it('renders a lazy poster image and selects on click', () => {
    const onSelect = vi.fn();
    render(<Card item={movie} client={createFakeClient()} variant="poster" onSelect={onSelect} />);

    const button = screen.getByRole('button', { name: 'Lumen Alpha' });
    const img = button.querySelector('img')!;
    expect(img.getAttribute('src')).toContain('Items/m1/Images/Primary');
    expect(img.getAttribute('loading')).toBe('lazy');
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith(movie);
  });

  it('renders a title placeholder when the item has no image', () => {
    render(
      <Card
        item={{ Id: 'x', Name: 'No Art', Type: 'Movie' }}
        client={createFakeClient()}
        variant="poster"
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole('button').querySelector('img')).toBeNull();
    expect(screen.getByText('No Art')).toBeInTheDocument();
  });

  it('shows progress for partially watched items and includes the caption in its label', () => {
    const item: BaseItem = { ...movie, RunTimeTicks: 100, UserData: { PlaybackPositionTicks: 40 } };
    render(
      <Card item={item} client={createFakeClient()} variant="thumb" caption="S1:E2" onSelect={vi.fn()} />,
    );

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByRole('button', { name: 'Lumen Alpha, S1:E2' })).toBeInTheDocument();
  });
});
