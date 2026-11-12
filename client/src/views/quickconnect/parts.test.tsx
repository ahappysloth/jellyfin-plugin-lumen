import { fireEvent, render, screen } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { describe, expect, it } from 'vitest';
import { CodeInput } from './parts';

function Field() {
  const [value, setValue] = useState('');
  return (
    <>
      <label for="code">Code</label>
      <CodeInput id="code" value={value} onChange={setValue} />
      <output>{value}</output>
    </>
  );
}

/** Types into the field as a browser would: the new value, then an input event. */
function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  fireEvent.input(input);
}

const cells = (container: Element) =>
  Array.from(container.querySelectorAll('[aria-hidden="true"] span')).map((c) => c.textContent);

describe('CodeInput', () => {
  it('is one labelled field asking for digits, with no autofill and no maxlength', () => {
    render(<Field />);
    const input = screen.getByLabelText<HTMLInputElement>('Code');
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('pattern', '[0-9]*');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).not.toHaveAttribute('maxlength');
  });

  it('takes a pasted "123 456" whole, drawn as six cells', () => {
    const { container } = render(<Field />);
    const input = screen.getByLabelText<HTMLInputElement>('Code');
    type(input, '123 456');
    expect(input.value).toBe('123456');
    expect(screen.getByRole('status')).toHaveTextContent('123456');
    expect(cells(container)).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('drops stray characters as they come, and anything past six digits', () => {
    const { container } = render(<Field />);
    const input = screen.getByLabelText<HTMLInputElement>('Code');
    type(input, '1a');
    expect(input.value).toBe('1');
    type(input, '1-2 3x45678');
    expect(input.value).toBe('123456');
    expect(cells(container)).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('deletes with Backspace, and marks the cell the next digit goes to', () => {
    const { container } = render(<Field />);
    const input = screen.getByLabelText<HTMLInputElement>('Code');
    type(input, '1234');
    type(input, '123');
    expect(input.value).toBe('123');
    expect(cells(container)).toEqual(['1', '2', '3', '', '', '']);
    const active = container.querySelectorAll('[aria-hidden="true"] span.is-active');
    expect(active).toHaveLength(1);
    expect(active[0]).toBe(container.querySelectorAll('[aria-hidden="true"] span')[3]);
  });

  it('starts a new code with a digit typed or a code pasted onto a full one (after "That code isn’t valid")', () => {
    const { container } = render(<Field />);
    const input = screen.getByLabelText<HTMLInputElement>('Code');
    type(input, '999999');
    type(input, '9999997');
    expect(input.value).toBe('7');
    expect(cells(container)).toEqual(['7', '', '', '', '', '']);
    type(input, '712345');
    // Pasted with the caret somewhere in the middle of the old code.
    input.value = '712654 321345';
    input.setSelectionRange(10, 10);
    fireEvent.input(input);
    expect(input.value).toBe('654321');
    // A letter typed onto a full code changes nothing.
    type(input, '654321x');
    expect(input.value).toBe('654321');
  });

  it("keeps the caret at the end: Left and Right don't move it", () => {
    render(<Field />);
    const input = screen.getByLabelText<HTMLInputElement>('Code');
    type(input, '123');
    for (const key of ['ArrowLeft', 'ArrowRight']) expect(fireEvent.keyDown(input, { key }), key).toBe(false);
    expect(fireEvent.keyDown(input, { key: '4' })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'ArrowDown' })).toBe(true);
  });

  it('keeps a selection, so a new code typed over a whole one replaces it', () => {
    render(<Field />);
    const input = screen.getByLabelText<HTMLInputElement>('Code');
    type(input, '999999');
    input.focus();
    input.select();
    fireEvent.click(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 6]);
    input.setSelectionRange(2, 2);
    fireEvent.click(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([6, 6]);
  });
});
