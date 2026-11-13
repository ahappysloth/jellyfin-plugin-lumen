import { act, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTION_TOAST_MS, showToast, TOAST_MS, ToastHost } from './Toast';

describe('ToastHost', () => {
  afterEach(() => vi.useRealTimers());

  it('shows a message in a live region, replaces it with the next, and dismisses itself', () => {
    vi.useFakeTimers();
    render(<ToastHost />);
    const region = screen.getByRole('alert');
    expect(region).toBeEmptyDOMElement();

    act(() => showToast('First'));
    act(() => void vi.advanceTimersByTime(TOAST_MS - 1000));
    act(() => showToast('Second'));
    expect(region).toHaveTextContent('Second');
    expect(region).not.toHaveTextContent('First');

    act(() => void vi.advanceTimersByTime(TOAST_MS - 1)); // the new toast gets its own full time
    expect(region).toHaveTextContent('Second');
    act(() => void vi.advanceTimersByTime(1));
    expect(region).toBeEmptyDOMElement();
  });

  it('can be dismissed by hand', () => {
    render(<ToastHost />);
    act(() => showToast('Oops'));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
  });

  it('can carry a button, which acts and dismisses it, and stays up longer', () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    render(<ToastHost />);
    act(() => showToast('The Matrix is ready to watch', { label: 'Open', onSelect }));

    act(() => void vi.advanceTimersByTime(TOAST_MS));
    expect(screen.getByRole('alert')).toHaveTextContent('The Matrix is ready to watch');
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();

    act(() => showToast('Again', { label: 'Open', onSelect }));
    act(() => void vi.advanceTimersByTime(ACTION_TOAST_MS));
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
  });

  it('TV: a toast with a button takes the remote’s focus to it, and gives it back when it goes', () => {
    vi.useFakeTimers();
    render(
      <>
        <button type="button">A card</button>
        <ToastHost tv />
      </>,
    );
    const card = screen.getByRole('button', { name: 'A card' });
    card.focus();

    // No button, nothing to press: focus stays where it is.
    act(() => showToast('Couldn’t save'));
    expect(card).toHaveFocus();

    act(() => showToast('The Matrix is ready to watch', { label: 'Open', onSelect: vi.fn() }));
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();

    // Dismissed, or gone by itself: back on the card the remote was on.
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    act(() => void vi.advanceTimersByTime(50));
    expect(card).toHaveFocus();

    act(() => showToast('Dune is ready to watch', { label: 'Open', onSelect: vi.fn() }));
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
    act(() => void vi.advanceTimersByTime(ACTION_TOAST_MS + 50));
    expect(card).toHaveFocus();
  });

  it('TV: focus the user has moved on from the toast isn’t pulled back as it goes', () => {
    vi.useFakeTimers();
    render(
      <>
        <button type="button">A card</button>
        <button type="button">Another card</button>
        <ToastHost tv />
      </>,
    );
    screen.getByRole('button', { name: 'A card' }).focus();
    act(() => showToast('The Matrix is ready to watch', { label: 'Open', onSelect: vi.fn() }));

    const other = screen.getByRole('button', { name: 'Another card' });
    other.focus();
    act(() => void vi.advanceTimersByTime(ACTION_TOAST_MS + 50));
    expect(other).toHaveFocus();
  });

  it('TV: with nowhere to give focus back to (the toast beat the page), the page’s own first choice gets it', () => {
    render(
      <>
        <main class="lmn-main">
          <button type="button">More info</button>
          <button type="button" class="lmn-autofocus">
            Play
          </button>
        </main>
        <ToastHost tv />
      </>,
    );
    (document.activeElement as HTMLElement | null)?.blur();

    act(() => showToast('The Matrix is ready to watch', { label: 'Open', onSelect: vi.fn() }));
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.getByRole('button', { name: 'Play' })).toHaveFocus();
  });

  it.each([
    ['a dialog (the request dialog)', 'dialog'],
    ['a confirmation (ConfirmDialog)', 'alertdialog'],
    ['a menu (ContextMenu)', 'menu'],
  ] as const)('TV: doesn’t take focus out of %s', (_, role) => {
    render(
      <>
        <div role={role} aria-label="Request The Matrix">
          <button type="button">Request</button>
        </div>
        <ToastHost tv />
      </>,
    );
    const request = screen.getByRole('button', { name: 'Request' });
    request.focus();

    act(() => showToast('Dune is ready to watch', { label: 'Open', onSelect: vi.fn() }));
    expect(screen.getByRole('alert')).toHaveTextContent('Dune is ready to watch');
    expect(request).toHaveFocus();
  });

  it('TV: doesn’t take focus out of an open Dropdown list', () => {
    render(
      <>
        <ul role="listbox" aria-label="Season" tabIndex={-1}>
          <li role="option" aria-selected="true">
            Season 1
          </li>
        </ul>
        <ToastHost tv />
      </>,
    );
    const list = screen.getByRole('listbox', { name: 'Season' });
    list.focus();

    act(() => showToast('Dune is ready to watch', { label: 'Open', onSelect: vi.fn() }));
    expect(screen.getByRole('alert')).toHaveTextContent('Dune is ready to watch');
    expect(list).toHaveFocus();
  });

  it('TV: a second pop-up replacing the first gives focus back where it was before the first', () => {
    vi.useFakeTimers();
    render(
      <>
        <button type="button">A card</button>
        <button type="button">Another card</button>
        <ToastHost tv />
      </>,
    );
    const card = screen.getByRole('button', { name: 'A card' });
    card.focus();
    const moves: string[] = [];
    const onFocus = (e: FocusEvent): void => void moves.push((e.target as HTMLElement).textContent ?? '');
    document.addEventListener('focusin', onFocus);

    act(() => showToast('The Matrix is ready to watch', { label: 'Open', onSelect: vi.fn() }));
    act(() => showToast('Dune is ready to watch', { label: 'Open', onSelect: vi.fn() }));
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
    // Straight from one Open to the next: not back to the card in between.
    expect(moves).toEqual(['Open', 'Open']);
    document.removeEventListener('focusin', onFocus);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(card).toHaveFocus();

    // The user went back to the page while one was up: the next gives focus back there.
    act(() => showToast('Alien is ready to watch', { label: 'Open', onSelect: vi.fn() }));
    screen.getByRole('button', { name: 'Another card' }).focus();
    act(() => showToast('Heat is ready to watch', { label: 'Open', onSelect: vi.fn() }));
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
    act(() => void vi.advanceTimersByTime(ACTION_TOAST_MS + 50));
    expect(screen.getByRole('button', { name: 'Another card' })).toHaveFocus();
  });

  it('leaves focus alone off a TV: a pointer or a touch reaches the button anyway', () => {
    render(
      <>
        <button type="button">A card</button>
        <ToastHost />
      </>,
    );
    const card = screen.getByRole('button', { name: 'A card' });
    card.focus();

    act(() => showToast('The Matrix is ready to watch', { label: 'Open', onSelect: vi.fn() }));
    expect(card).toHaveFocus();
  });

  it('does nothing when no host is mounted', () => {
    expect(() => showToast('nobody listens')).not.toThrow();
  });
});
