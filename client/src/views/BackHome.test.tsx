import { act, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import buttonsCss from '../styles/buttons.css?raw';
import tvCss from '../styles/tv.css?raw';
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
    // Back fills the pill on its own: the white disc is the whole circle, with no dark ring of padding round it.
    expect(screen.getByRole('button', { name: 'Back' }).parentElement).toHaveClass(
      'lmn-pill',
      'lmn-pill--single',
    );
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
    // Two buttons keep their smaller discs inside the pill.
    expect(pill).not.toHaveClass('lmn-pill--single');
    // Icons only, in the buttons' own colour (white on the glass, dark on the white disc).
    for (const icon of pill.querySelectorAll('svg')) expect(icon).toHaveAttribute('stroke', 'currentColor');
  });

  it('follows the depth if it changes under the page', () => {
    go(MOVIE);
    render(<BackHome onBack={vi.fn()} />);
    expect(screen.queryByRole('link', { name: 'Home' })).toBeNull();

    act(() => go(ACTOR));
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' }).parentElement).not.toHaveClass('lmn-pill--single');
  });

  // jsdom lays nothing out, so this reads the stylesheet: the pill is as tall with one button as with two, so it
  // doesn't jump as Home comes and goes, and never changes size under the pointer.
  it('is the same height with Back alone as with Home beside it', () => {
    const px = (selector: string, property: string, css = buttonsCss): number => {
      // A rule of its own, not the end of a longer selector list (a line ending in a comma before it).
      let start = css.indexOf(`\n${selector} {`);
      while (start > 0 && css[start - 1] === ',') start = css.indexOf(`\n${selector} {`, start + 1);
      expect(start, selector).toBeGreaterThanOrEqual(0);
      const match = new RegExp(`\\b${property}: (\\d+)(?:px)?;`).exec(
        css.slice(start, css.indexOf('}', start)),
      );
      expect(match, `${selector} ${property}`).not.toBeNull();
      return Number(match![1]);
    };
    const two =
      2 * px('.lmn-pill,\n.lmn-details__trailer-controls', 'padding') + px('.lmn-icon-button--lg', 'height');
    expect(px('.lmn-pill--single', 'padding')).toBe(0);
    expect(px('.lmn-pill--single > .lmn-icon-button', 'height')).toBe(two);
    expect(px('.lmn-pill--single > .lmn-icon-button', 'width')).toBe(two);
    // Hover and focus only change colours, never the size.
    for (const state of [':hover', ':active', ':focus-visible']) {
      const start = buttonsCss.indexOf(`.lmn-icon-button${state} {`);
      expect(buttonsCss.slice(start, buttonsCss.indexOf('}', start))).not.toMatch(
        /width|height|padding|transform/,
      );
    }
    // On a TV, Back alone's ring stands off it as a lone round button's does (not the pill buttons' 1px).
    expect(px('.layout-tv .lmn-pill--single > .lmn-icon-button:focus', 'outline-offset', tvCss)).toBe(3);
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
