import { act, render } from '@testing-library/preact';
import { useRef, useState } from 'preact/hooks';
import { describe, expect, it, vi } from 'vitest';
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

let showPrimary: (show: boolean) => void = () => undefined;

/** The primary action renders only once its data has loaded, as a series' Play does. */
function LateHarness() {
  const ref = useRef<HTMLDivElement>(null);
  const [primary, setPrimary] = useState(false);
  showPrimary = setPrimary;
  useAutoFocus(ref, true, 'tv');
  return (
    <div ref={ref}>
      <button>back</button>
      <button>other</button>
      {primary && <button class="lmn-autofocus">play</button>}
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

  it('moves on to a primary action that renders after the view is ready', () => {
    const { getByText } = render(<LateHarness />);
    expect(document.activeElement).toBe(getByText('back'));

    act(() => showPrimary(true));

    expect(document.activeElement).toBe(getByText('play'));
  });

  it('leaves focus where the user moved it before the primary action appeared', () => {
    const { getByText } = render(<LateHarness />);
    getByText('other').focus();

    act(() => showPrimary(true));

    expect(document.activeElement).toBe(getByText('other'));
  });

  it('stops waiting for the primary action once the user points or scrolls', () => {
    for (const input of ['pointerdown', 'wheel']) {
      const { getByText, unmount } = render(<LateHarness />);
      document.dispatchEvent(new Event(input));

      act(() => showPrimary(true));

      expect(document.activeElement).toBe(getByText('back'));
      unmount();
    }
  });

  it('moves on to the late primary action without scrolling the page', () => {
    const { getByText } = render(<LateHarness />);
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');

    act(() => showPrimary(true));

    expect(document.activeElement).toBe(getByText('play'));
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    focus.mockRestore();
  });

  it('does not take focus back after the user returned to the stand-in', () => {
    const { getByText } = render(<LateHarness />);
    getByText('other').focus();
    getByText('back').focus();

    act(() => showPrimary(true));

    expect(document.activeElement).toBe(getByText('back'));
  });
});
