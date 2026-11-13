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

  it('TV: doesn’t take focus out of an open dialog or menu', () => {
    render(
      <>
        <div role="dialog" aria-label="Request The Matrix">
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
