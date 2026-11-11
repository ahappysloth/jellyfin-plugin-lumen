import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { changePage } from '../../test/navigation';
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

  it.each(['pushState', 'hash'] as const)(
    "answers no when the page changes (by %s: jellyfin-web's pushState, as a remote's Home key does, or a hash change)",
    async (how) => {
      const { answer } = setup();
      const restore = changePage(how);
      await settle();
      expect(answer()).toBe(false);
      expect(screen.queryByRole('alertdialog')).toBeNull();
      // The new page decides where focus goes: nothing is sent back to the old one's control.
      expect(screen.getByRole('button', { name: 'Watched' })).not.toHaveFocus();
      restore();
    },
  );

  it('answers no when another confirmation replaces it, and each request exactly once', async () => {
    const second = setup();
    let third: boolean | undefined;
    act(() => {
      void confirmDialog({ ...OPTIONS, title: 'Again?' }).then((ok) => (third = ok));
    });
    await settle();
    expect(second.answer()).toBe(false);
    expect(screen.getByRole('alertdialog', { name: 'Again?' })).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Mark unwatched' });
    fireEvent.click(confirm);
    fireEvent.click(confirm); // a second press as it closes changes nothing
    await settle();
    expect(third).toBe(true);
    expect(second.answer()).toBe(false);
  });

  it("locks the page's scroll while open, and gives <body> back exactly the styles it had", async () => {
    document.body.style.overflow = 'clip';
    document.body.style.paddingRight = '3px';
    setup();
    expect(document.body.style.overflow).toBe('hidden');
    // A replacing request keeps it locked, and the styles still come back as they were.
    act(() => void confirmDialog({ ...OPTIONS, title: 'Again?' }));
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await settle();
    expect(document.body.style.overflow).toBe('clip');
    expect(document.body.style.paddingRight).toBe('3px');
    document.body.removeAttribute('style');
  });
});
