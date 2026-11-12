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

  it('does nothing when no host is mounted', () => {
    expect(() => showToast('nobody listens')).not.toThrow();
  });
});
