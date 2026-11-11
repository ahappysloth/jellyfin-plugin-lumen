import { act, fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { changePage } from '../../test/navigation';
import { pressRemoteBack, REMOTE_BACK_KEY_CODES } from '../../test/remoteBack';
import { ContextMenuHost, openContextMenu } from './ContextMenu';

describe('ContextMenu', () => {
  const open = (onSelect = vi.fn()) => {
    render(<ContextMenuHost />);
    act(() =>
      openContextMenu({
        x: 10,
        y: 10,
        returnFocus: null,
        label: 'Actions for X',
        entries: [
          { label: 'Play', icon: 'play', onSelect },
          { label: 'More info', icon: 'info', onSelect },
        ],
      }),
    );
    return onSelect;
  };

  it('shows the entries as a menu and runs the chosen one', () => {
    const onSelect = open();
    const menu = screen.getByRole('menu', { name: 'Actions for X' });
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Play', 'More info']);

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it.each(REMOTE_BACK_KEY_CODES)(
    "closes on a TV remote's Back (keyCode %i), which jellyfin-web then doesn't also act on",
    (keyCode) => {
      const onSelect = open();
      expect(pressRemoteBack(screen.getByRole('menu'), keyCode).reachedJellyfin).toBe(false);
      expect(screen.queryByRole('menu')).toBeNull();
      expect(onSelect).not.toHaveBeenCalled();
    },
  );

  it('closes on Escape and on an outside press', () => {
    open();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    act(() =>
      openContextMenu({
        x: 0,
        y: 0,
        returnFocus: null,
        label: 'm',
        entries: [{ label: 'A', icon: 'play', onSelect: vi.fn() }],
      }),
    );
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it.each(['pushState', 'hash'] as const)(
    "closes when the page changes (by %s: jellyfin-web's pushState, as a remote's Home key does, or a hash change)",
    (how) => {
      const onSelect = open();
      const restore = changePage(how);
      expect(screen.queryByRole('menu')).toBeNull();
      expect(onSelect).not.toHaveBeenCalled();
      restore();
    },
  );

  it('closes when the page scrolls, unless it hangs from a button, which it then follows', () => {
    open();
    fireEvent.scroll(window);
    expect(screen.queryByRole('menu')).toBeNull();

    const button = document.createElement('button');
    document.body.appendChild(button);
    let top = 100;
    button.getBoundingClientRect = () =>
      ({ left: 20, right: 60, top, bottom: top + 40, width: 40, height: 40 }) as DOMRect;
    act(() =>
      openContextMenu({
        x: 20,
        y: 140,
        returnFocus: button,
        anchor: button,
        label: 'm',
        entries: [{ label: 'A', icon: 'play', onSelect: vi.fn() }],
      }),
    );
    expect(screen.getByRole('menu').style.top).toBe('146px');
    top = 40; // jellyfin-web's TV layout scrolled the button into view
    act(() => {
      fireEvent.scroll(window);
    });
    expect(screen.getByRole('menu').style.top).toBe('86px');
    button.remove();
  });

  it('draws a line above an entry that starts a group, and ignores its own scrolling', () => {
    render(<ContextMenuHost />);
    act(() =>
      openContextMenu({
        x: 0,
        y: 0,
        returnFocus: null,
        label: 'm',
        entries: [
          { label: 'A', icon: 'play', onSelect: vi.fn() },
          { label: 'B', icon: 'trash', onSelect: vi.fn(), separated: true },
        ],
      }),
    );
    const [a, b] = screen.getAllByRole('menuitem');
    expect(a).not.toHaveClass('lmn-menu__item--separated');
    expect(b).toHaveClass('lmn-menu__item--separated');
    fireEvent.scroll(screen.getByRole('menu'));
    expect(screen.queryByRole('menu')).not.toBeNull();
  });
});
