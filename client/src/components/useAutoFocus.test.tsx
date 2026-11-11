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

  it('falls back to the first button or card (a link) when there is no primary action', () => {
    function Grid() {
      const ref = useRef<HTMLDivElement>(null);
      useAutoFocus(ref, true, 'tv');
      return (
        <div ref={ref}>
          <a href="#/x">a link that isn't a card</a>
          <a class="lmn-card" href="#/details?id=m1">
            card
          </a>
          <button>after the cards</button>
        </div>
      );
    }
    const { getByText } = render(<Grid />);
    expect(document.activeElement).toBe(getByText('card'));
  });

  // Each kind of popup: the account menu (from the nav), a list, a dialog, and the Mark as unwatched confirmation.
  it.each([
    ['a menu the user opened while the view loaded (the account menu, from the nav)', 'menu', 'menuitem'],
    ['a list', 'listbox', 'option'],
    ['a dialog', 'dialog', 'button'],
    ['a confirmation (Mark as unwatched?)', 'alertdialog', 'button'],
  ])('leaves focus in %s', (_, role, itemRole) => {
    let setReady: (ready: boolean) => void = () => undefined;
    function Late() {
      const ref = useRef<HTMLDivElement>(null);
      const [ready, set] = useState(false);
      setReady = set;
      useAutoFocus(ref, ready, 'tv');
      return <div ref={ref}>{ready && <button class="lmn-autofocus">primary</button>}</div>;
    }
    const nav = document.createElement('div');
    nav.innerHTML = `<div role="${role}"><button role="${itemRole}">History</button></div>`;
    document.body.appendChild(nav);
    const item = nav.querySelector('button')!;
    render(<Late />);
    item.focus();

    act(() => setReady(true));

    expect(document.activeElement).toBe(item);
    nav.remove();
  });

  it('does not move focus on desktop or mobile', () => {
    (document.activeElement as HTMLElement | null)?.blur();
    render(<Harness layout="desktop" />);
    expect(document.activeElement).toBe(document.body);
  });

  it('focuses a restored selection on desktop too (Back to a page), without scrolling to it', () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const { getByText } = render(<Harness layout="desktop" preferred="abc123" />);
    expect(document.activeElement).toBe(getByText('card'));
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    focus.mockRestore();
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
