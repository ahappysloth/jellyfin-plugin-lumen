import { render } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { describe, expect, it } from 'vitest';
import type { Layout } from '../compat/jellyfin';
import { useAutoFocus } from './useAutoFocus';

function Harness({ layout, preferred }: { layout: Layout; preferred?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useAutoFocus(ref, true, layout, preferred);
  return (
    <div ref={ref}>
      <button>first</button>
      <button class="lmn-autofocus">primary</button>
      <button data-item-id="abc123">card</button>
    </div>
  );
}

describe('useAutoFocus', () => {
  it('focuses the primary action in TV layout', () => {
    const { getByText } = render(<Harness layout="tv" />);
    expect(document.activeElement).toBe(getByText('primary'));
  });

  it('restores focus to the previously selected item', () => {
    const { getByText } = render(<Harness layout="tv" preferred="abc123" />);
    expect(document.activeElement).toBe(getByText('card'));
  });

  it('does not move focus on desktop or mobile', () => {
    (document.activeElement as HTMLElement | null)?.blur();
    render(<Harness layout="desktop" />);
    expect(document.activeElement).toBe(document.body);
  });
});
