import { act, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { trackPageDepth } from '../takeover/pageDepth';
import { BackHome, goBack } from './BackHome';

const MOVIE = '#/details?id=11111111111111111111111111111111';
const ACTOR = '#/details?id=22222222222222222222222222222222';

let stop: () => void = () => undefined;

/** A link: a new history entry, and the event a browser fires for it. */
function go(hash: string): void {
  History.prototype.pushState.call(history, null, '', hash);
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
}

beforeEach(() => {
  History.prototype.pushState.call(history, null, '', '#/home');
  stop = trackPageDepth(window);
});
afterEach(() => stop());

describe('BackHome', () => {
  it('is Back alone one page in', () => {
    go(MOVIE);
    const onBack = vi.fn();
    render(<BackHome onBack={onBack} />);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(screen.queryByRole('link', { name: 'Home' })).toBeNull();
  });

  it('adds Home, a link to Lumen’s home, more than one page in', () => {
    go(MOVIE);
    go(ACTOR);
    const { container } = render(<BackHome onBack={vi.fn()} />);

    const home = screen.getByRole('link', { name: 'Home' });
    expect(home).toHaveAttribute('href', '#/home');
    // Both in one pill, Back first.
    const pill = container.querySelector('.lmn-pill')!;
    expect(Array.from(pill.children)).toEqual([screen.getByRole('button', { name: 'Back' }), home]);
    // Icons only, in the buttons' own colour (white on the glass, dark on the white disc).
    for (const icon of pill.querySelectorAll('svg')) expect(icon).toHaveAttribute('stroke', 'currentColor');
  });

  it('follows the depth if it changes under the page', () => {
    go(MOVIE);
    render(<BackHome onBack={vi.fn()} />);
    expect(screen.queryByRole('link', { name: 'Home' })).toBeNull();

    act(() => go(ACTOR));
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
  });

  it('takes the page’s default focus on a TV only where it’s asked to', () => {
    go(MOVIE);
    const { rerender } = render(<BackHome onBack={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Back' })).not.toHaveClass('lmn-autofocus');

    rerender(<BackHome onBack={vi.fn()} autoFocus />);
    expect(screen.getByRole('button', { name: 'Back' })).toHaveClass('lmn-autofocus');
  });
});

describe('goBack', () => {
  it('goes back in the history, or home when there’s nowhere to go back to', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const navigate = vi.fn();

    goBack({ navigate });
    expect(back).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();

    vi.spyOn(window.history, 'length', 'get').mockReturnValue(1);
    goBack({ navigate });
    expect(back).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith('#/home');
    vi.restoreAllMocks();
  });
});
