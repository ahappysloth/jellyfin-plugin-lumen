import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { pressRemoteBack, REMOTE_BACK_KEY_CODES } from '../../test/remoteBack';
import { Dropdown } from './Dropdown';

const options = [
  { value: 'a', label: 'Apple' },
  { value: 'b', label: 'Banana' },
  { value: 'c', label: 'Cherry' },
] as const;

describe('Dropdown', () => {
  it('opens a listbox, marks the selection, and picks by click', () => {
    const onChange = vi.fn();
    render(<Dropdown label="Fruit" value="a" options={options} onChange={onChange} />);

    const button = screen.getByRole('button', { name: 'Fruit Apple' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('option', { name: 'Apple' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('option', { name: 'Cherry' }));
    expect(onChange).toHaveBeenCalledWith('c');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('is named as it reads: label and value, or the value after its label when only that shows (WCAG 2.5.3)', () => {
    const { rerender } = render(<Dropdown label="Fruit" value="a" options={options} onChange={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAccessibleName('Fruit Apple');
    expect(screen.getByRole('button').textContent).toBe('Fruit Apple'); // as axe reads it

    rerender(<Dropdown label="Fruit" value="a" options={options} onChange={vi.fn()} hideLabel />);
    expect(screen.getByRole('button')).toHaveAccessibleName('Fruit: Apple');
    expect(screen.getByRole('button')).toHaveTextContent(/^Apple$/);
  });

  it('supports arrows, type-ahead, Enter and Escape', () => {
    const onChange = vi.fn();
    render(<Dropdown label="Fruit" value="a" options={options} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'ArrowDown' });
    const list = screen.getByRole('listbox');

    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('b');

    fireEvent.click(screen.getByRole('button'));
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'c' });
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('c');

    fireEvent.click(screen.getByRole('button'));
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it.each(REMOTE_BACK_KEY_CODES)(
    "closes on a TV remote's Back (keyCode %i), which jellyfin-web then doesn't also act on",
    (keyCode) => {
      const onChange = vi.fn();
      render(<Dropdown label="Fruit" value="a" options={options} onChange={onChange} />);
      fireEvent.click(screen.getByRole('button'));

      expect(pressRemoteBack(screen.getByRole('listbox'), keyCode).reachedJellyfin).toBe(false);
      expect(screen.queryByRole('listbox')).toBeNull();
      expect(screen.getByRole('button')).toHaveFocus();
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it("leaves Up and Down to a TV's D-pad: OK opens it there", () => {
    document.documentElement.classList.add('layout-tv');
    try {
      render(<Dropdown label="Fruit" value="a" options={options} onChange={vi.fn()} />);
      const button = screen.getByRole('button');
      const down = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
      button.dispatchEvent(down);
      expect(down.defaultPrevented).toBe(false);
      expect(screen.queryByRole('listbox')).toBeNull();
      fireEvent.click(button);
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    } finally {
      document.documentElement.classList.remove('layout-tv');
    }
  });

  it('closes on an outside press without changing the value', () => {
    const onChange = vi.fn();
    render(<Dropdown label="Fruit" value="a" options={options} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
