import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfirmHost, confirmDialog } from './ConfirmDialog';

const OPTIONS = {
  title: 'Mark as unwatched?',
  body: 'This resets how far you got and removes it from your History.',
  confirmLabel: 'Mark unwatched',
};

function setup() {
  render(
    <>
      <button type="button">Watched</button>
      <ConfirmHost />
    </>,
  );
  const trigger = screen.getByRole('button', { name: 'Watched' });
  trigger.focus();
  let answer: boolean | undefined;
  act(() => {
    void confirmDialog(OPTIONS).then((ok) => (answer = ok));
  });
  return { trigger, answer: () => answer };
}

/** Lets the promise's then run. */
const settle = () => act(() => Promise.resolve());

describe('confirmDialog', () => {
  afterEach(cleanup);

  // First: Preact runs an unmounted host's effect cleanup a frame later, so later tests would still find one.
  it("answers no when there's no host to ask in", async () => {
    await expect(confirmDialog(OPTIONS)).resolves.toBe(false);
  });

  it('is a labelled alert dialog with Cancel focused, and a red button that goes ahead', () => {
    setup();
    const dialog = screen.getByRole('alertdialog', { name: 'Mark as unwatched?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription(OPTIONS.body);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Mark unwatched' })).toHaveClass('lmn-button--danger');
    // jellyfin-web's D-pad (focusManager) keeps focus inside a focuscontainer.
    expect(dialog).toHaveClass('focuscontainer');
  });

  it('goes ahead on its button, and returns focus to the control that opened it', async () => {
    const { trigger, answer } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Mark unwatched' }));
    await settle();
    expect(answer()).toBe(true);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('answers no to Cancel, a press outside, Escape and a remote Back, each returning focus', async () => {
    const dismissals: ((dialog: HTMLElement) => void)[] = [
      () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' })),
      (dialog) => fireEvent.pointerDown(dialog.parentElement!),
      () => fireEvent.keyDown(document.activeElement!, { key: 'Escape' }),
      // webOS's Back (keyCode 461), wherever focus is.
      () => fireEvent.keyDown(document.body, { key: 'Unidentified', keyCode: 461 }),
    ];
    for (const dismiss of dismissals) {
      const { trigger, answer } = setup();
      dismiss(screen.getByRole('alertdialog'));
      await settle();
      expect(answer()).toBe(false);
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(trigger).toHaveFocus();
      cleanup();
    }
  });

  it('keeps Back from jellyfin-web, which would leave the page', () => {
    setup();
    const back = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.activeElement!.dispatchEvent(back);
    expect(back.defaultPrevented).toBe(true);
  });

  it('moves between its buttons with Left and Right, and keeps every arrow from the page', () => {
    setup();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Mark unwatched' });
    const press = (key: string, init: KeyboardEventInit = {}) =>
      fireEvent.keyDown(document.activeElement!, { key, ...init });

    expect(press('ArrowRight')).toBe(false); // consumed: jellyfin-web's D-pad skips it
    expect(confirm).toHaveFocus();
    press('ArrowRight'); // no wrapping round
    expect(confirm).toHaveFocus();
    expect(press('ArrowUp')).toBe(false);
    expect(press('ArrowDown')).toBe(false);
    expect(confirm).toHaveFocus();
    press('ArrowLeft');
    expect(cancel).toHaveFocus();
    // Tab wraps round inside the dialog.
    press('Tab', { shiftKey: true });
    expect(confirm).toHaveFocus();
    press('Tab');
    expect(cancel).toHaveFocus();
  });

  it('answers no when the page changes, or when another confirmation replaces it', async () => {
    const first = setup();
    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await settle();
    expect(first.answer()).toBe(false);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    cleanup();

    const second = setup();
    let third: boolean | undefined;
    act(() => {
      void confirmDialog({ ...OPTIONS, title: 'Again?' }).then((ok) => (third = ok));
    });
    await settle();
    expect(second.answer()).toBe(false);
    expect(screen.getByRole('alertdialog', { name: 'Again?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark unwatched' }));
    await settle();
    expect(third).toBe(true);
  });
});
