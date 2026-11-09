import { act, fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
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
});
