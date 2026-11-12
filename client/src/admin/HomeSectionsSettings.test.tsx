import { act, fireEvent, render, screen } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LumenConfig, SectionDef, SectionTypeDef } from './adminApi';
import { HomeSectionsSettings } from './HomeSectionsSettings';

const types: SectionTypeDef[] = [
  {
    Type: 'ContinueWatching',
    DisplayName: 'Continue Watching',
    Description: 'Started, not finished.',
    Parameters: [],
  },
  { Type: 'NextUp', DisplayName: 'Next Up', Description: 'The next episode of each show.', Parameters: [] },
  {
    Type: 'Genre',
    DisplayName: 'Genre rows',
    Description: 'A row per genre the viewer likes.',
    Parameters: [
      {
        Name: 'genreCount',
        Label: 'Number of genre rows',
        Kind: 'Integer',
        Required: false,
        DefaultValue: '3',
        Min: 1,
        Max: 6,
      },
    ],
  },
];

const sections = (): SectionDef[] => [
  { Id: 's1', Type: 'ContinueWatching', Enabled: true, Title: null, Params: [] },
  { Id: 's2', Type: 'NextUp', Enabled: false, Title: null, Params: [] },
  { Id: 's3', Type: 'Genre', Enabled: true, Title: 'Moods', Params: [{ Name: 'genreCount', Value: '3' }] },
];

/**
 * The card with the configuration kept as AdminApp keeps it, every change recorded: `update` takes none while a save is
 * in flight, and Discard puts the saved list back and remounts the card.
 */
function renderCard(start: SectionDef[] = sections()) {
  const changes: SectionDef[][] = [];
  const controls: { setBusy: (busy: boolean) => void; discard: () => void } = {
    setBusy: () => {},
    discard: () => {},
  };
  function Harness() {
    const [config, setConfig] = useState({ Sections: start } as LumenConfig);
    const [busy, setBusy] = useState(false);
    const [revision, setRevision] = useState(0);
    controls.setBusy = setBusy;
    controls.discard = () => {
      setConfig({ Sections: start } as LumenConfig);
      setRevision((r) => r + 1);
    };
    return (
      <HomeSectionsSettings
        key={`sections-${revision}`}
        config={config}
        types={types}
        lookups={{ Library: [], Collection: [], Playlist: [] }}
        newId={() => 'new1'}
        busy={busy}
        update={(patch) => {
          if (busy) return;
          changes.push(patch.Sections!);
          setConfig((c) => ({ ...c, ...patch }));
        }}
      />
    );
  }
  const view = render(<Harness />);
  const names = () => [...view.container.querySelectorAll('.lmna-section__label')].map((n) => n.textContent);
  const announced = () => view.container.querySelector('[aria-live="assertive"]')!.textContent;
  const setBusy = (busy: boolean) => act(() => controls.setBusy(busy));
  const discard = () => act(() => controls.discard());
  return { ...view, changes, names, announced, setBusy, discard };
}

/**
 * Rows laid out as a browser would (jsdom lays nothing out): 40px tall, 50px apart, the first 100px down the list (its
 * wrapper at the top of the window).
 */
function layRowsOut() {
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('lmna-section')
      ? 100 + [...this.parentElement!.children].indexOf(this) * 50
      : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('lmna-section') ? 40 : 0;
  });
}

const MOUSE = { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 };

/** A mouse drag by `name`'s handle, from `fromY` to `toY` (not let go). */
function dragBy(name: string, fromY: number, toY: number) {
  const handle = screen.getByRole('button', { name: `Move ${name}` });
  fireEvent.pointerDown(handle, { ...MOUSE, clientY: fromY });
  fireEvent.pointerMove(window, { ...MOUSE, clientY: (fromY + toY) / 2 });
  fireEvent.pointerMove(window, { ...MOUSE, clientY: toY });
  return handle;
}

const last = <T,>(list: T[]): T => list[list.length - 1]!;

describe('HomeSectionsSettings', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows one compact row per section: its name, the type under a title of its own, and its controls', () => {
    const { container, names } = renderCard();
    expect(names()).toEqual(['Continue Watching', 'Next Up', 'Moods']);
    expect(container.querySelector('[data-section-id="s3"] small')).toHaveTextContent('Genre rows');
    expect(container.querySelector('[data-section-id="s1"] small')).toBeNull();
    // A hidden section keeps its dimmed look.
    expect(container.querySelector('[data-section-id="s2"]')).toHaveClass('is-disabled');
    expect(screen.getByRole('switch', { name: 'Show Next Up' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Remove Moods' })).toBeInTheDocument();
    // No settings, no chevron; the rest start closed.
    expect(screen.queryByRole('button', { name: 'Continue Watching settings' })).toBeNull();
    const chevron = screen.getByRole('button', { name: 'Moods settings' });
    expect(chevron).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('Number of genre rows')).not.toBeVisible();
    // No Title field any more: the name is renamed in place.
    expect(screen.queryByLabelText(/Title/)).toBeNull();
  });

  it('opens and closes a section’s settings with its chevron', () => {
    const { changes } = renderCard();
    const chevron = screen.getByRole('button', { name: 'Moods settings' });
    fireEvent.click(chevron);
    expect(chevron).toHaveAttribute('aria-expanded', 'true');
    const count = screen.getByLabelText('Number of genre rows');
    expect(count).toBeVisible();
    fireEvent.input(count, { target: { value: '5' } });
    expect(last(changes)[2]!.Params).toEqual([{ Name: 'genreCount', Value: '5' }]);
    fireEvent.click(chevron);
    expect(chevron).toHaveAttribute('aria-expanded', 'false');
    expect(count).not.toBeVisible();
  });

  it('opens a section just added, to be set up', () => {
    const { container, changes } = renderCard(sections().slice(0, 2));
    fireEvent.click(screen.getByRole('button', { name: /^Section type to add:/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Genre rows' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(last(changes).map((s) => s.Id)).toEqual(['s1', 's2', 'new1']);
    expect(screen.getByRole('button', { name: 'Genre rows settings' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(container.querySelector('[data-section-id="new1"] .lmna-section__body')).toBeVisible();
    // The single-use rule still stands.
    fireEvent.click(screen.getByRole('button', { name: /^Section type to add:/ }));
    expect(screen.getByRole('option', { name: 'Continue Watching (already added)' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('describes each type in its ⓘ: a tooltip from the keyboard, gone with Escape', () => {
    renderCard();
    const info = screen.getByRole('button', { name: 'About Next Up' });
    expect(info).toHaveAccessibleDescription('The next episode of each show.');
    const tip = document.getElementById(info.getAttribute('aria-describedby')!)!;
    expect(tip).toHaveAttribute('role', 'tooltip');
    expect(tip).not.toBeVisible();
    fireEvent.focus(info);
    expect(tip).toBeVisible();
    fireEvent.keyDown(info, { key: 'Escape' });
    expect(tip).not.toBeVisible();
    // Enter (a click with no pointer) brings it back.
    fireEvent.click(info, { detail: 0 });
    expect(tip).toBeVisible();
    fireEvent.blur(info);
    expect(tip).not.toBeVisible();
  });

  it('toggles the tooltip with Enter after a mouse click on the ⓘ', () => {
    renderCard();
    const info = screen.getByRole('button', { name: 'About Next Up' });
    const tip = document.getElementById(info.getAttribute('aria-describedby')!)!;
    // Clicked with a mouse (and pointed away): the click doesn't toggle it, and focus stays.
    fireEvent.pointerEnter(info, { pointerType: 'mouse' });
    fireEvent.pointerDown(info, { pointerType: 'mouse' });
    fireEvent.click(info, { detail: 1 });
    fireEvent.pointerLeave(info, { pointerType: 'mouse' });
    expect(tip).not.toBeVisible();
    // Then Enter: a key, and its click with no pointer behind it.
    fireEvent.keyDown(info, { key: 'Enter' });
    fireEvent.click(info, { detail: 0 });
    expect(tip).toBeVisible();
    fireEvent.keyDown(info, { key: ' ' });
    fireEvent.click(info, { detail: 0 });
    expect(tip).not.toBeVisible();
  });

  it('shows the tooltip while pointed at, and toggles it with a tap', () => {
    renderCard();
    const info = screen.getByRole('button', { name: 'About Next Up' });
    const tip = document.getElementById(info.getAttribute('aria-describedby')!)!;
    fireEvent.pointerEnter(info, { pointerType: 'mouse' });
    expect(tip).toBeVisible();
    fireEvent.pointerLeave(info, { pointerType: 'mouse' });
    expect(tip).not.toBeVisible();
    fireEvent.pointerDown(info, { pointerType: 'touch' });
    fireEvent.pointerUp(info, { pointerType: 'touch' });
    expect(tip).toBeVisible();
    // A tap elsewhere hides it.
    fireEvent.pointerDown(document.body);
    expect(tip).not.toBeVisible();
  });

  it('renames in place: Enter keeps the name, Escape drops the change, empty goes back to the type’s', () => {
    const { names, changes } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Rename Next Up' }));
    const field = screen.getByRole('textbox', { name: 'Name for Next Up' });
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute('placeholder', 'Next Up');
    fireEvent.input(field, { target: { value: '  Up next  ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(names()).toEqual(['Continue Watching', 'Up next', 'Moods']);
    expect(last(changes)[1]!.Title).toBe('Up next');
    expect(screen.getByRole('button', { name: 'Rename Up next' })).toHaveFocus();

    // Escape: nothing changes.
    const count = changes.length;
    fireEvent.click(screen.getByRole('button', { name: 'Rename Up next' }));
    const again = screen.getByRole('textbox', { name: 'Name for Next Up' });
    expect(again).toHaveValue('Up next');
    fireEvent.input(again, { target: { value: 'Something else' } });
    fireEvent.keyDown(again, { key: 'Escape' });
    expect(names()).toEqual(['Continue Watching', 'Up next', 'Moods']);
    expect(changes.length).toBe(count);

    // Emptied and left (blur): the type's name again, no title.
    fireEvent.click(screen.getByRole('button', { name: 'Rename Moods' }));
    const moods = screen.getByRole('textbox', { name: 'Name for Genre rows' });
    fireEvent.input(moods, { target: { value: '' } });
    fireEvent.blur(moods);
    expect(names()).toEqual(['Continue Watching', 'Up next', 'Genre rows']);
    expect(last(changes)[2]!.Title).toBeNull();
  });

  it('shows the pencil on a touch screen once the name is tapped', () => {
    const { container } = renderCard();
    const title = container.querySelector('[data-section-id="s1"] .lmna-section__title')!;
    expect(title).not.toHaveClass('is-armed');
    fireEvent.pointerUp(title.querySelector('.lmna-section__label')!, { pointerType: 'touch' });
    expect(title).toHaveClass('is-armed');
    fireEvent.pointerDown(document.body);
    expect(title).not.toHaveClass('is-armed');
  });

  it('moves a section from the keyboard: picked up with Enter, moved with the arrows, put down with Enter', () => {
    const { names, announced, changes } = renderCard();
    const handle = screen.getByRole('button', { name: 'Move Continue Watching' });
    expect(handle).toHaveAccessibleDescription(/Enter picks the row up/);
    handle.focus();
    // Enter on a button is a click.
    fireEvent.click(handle);
    expect(handle).toHaveAttribute('aria-pressed', 'true');
    expect(announced()).toMatch(/^Continue Watching picked up, position 1 of 3\./);

    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(names()).toEqual(['Next Up', 'Continue Watching', 'Moods']);
    expect(announced()).toBe('Continue Watching moved to position 2 of 3.');
    // Still the handle that has focus, after the row moved. (Moving down, it's the row after that's taken out and put
    // back; moving up, below, this one.)
    expect(screen.getByRole('button', { name: 'Move Continue Watching' })).toHaveFocus();

    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(names()).toEqual(['Next Up', 'Moods', 'Continue Watching']);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(announced()).toBe('Continue Watching is already at the bottom, position 3 of 3.');
    fireEvent.click(document.activeElement!);
    expect(screen.getByRole('button', { name: 'Move Continue Watching' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(announced()).toBe('Continue Watching put down at position 3 of 3.');
    expect(last(changes).map((s) => s.Id)).toEqual(['s2', 's3', 's1']);
    // Put down, the arrows don't move it any more.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(names()).toEqual(['Next Up', 'Moods', 'Continue Watching']);
  });

  it('keeps focus on a row’s handle as it moves up, the row itself taken out of the page and put back', () => {
    const { names } = renderCard();
    const handle = screen.getByRole('button', { name: 'Move Moods' });
    handle.focus();
    fireEvent.click(handle);
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(names()).toEqual(['Moods', 'Continue Watching', 'Next Up']);
    expect(screen.getByRole('button', { name: 'Move Moods' })).toHaveFocus();
    // And from its ↓ button, down past the row it moved up past.
    fireEvent.click(screen.getByRole('button', { name: 'Move Moods down' }));
    expect(names()).toEqual(['Continue Watching', 'Moods', 'Next Up']);
    expect(screen.getByRole('button', { name: 'Move Moods down' })).toHaveFocus();
  });

  it('doesn’t move rows while a save is in flight, or say they moved: it says to try again', () => {
    const { names, announced, changes, setBusy } = renderCard();
    const handle = screen.getByRole('button', { name: 'Move Next Up' });
    handle.focus();
    fireEvent.click(handle);
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(names()).toEqual(['Next Up', 'Continue Watching', 'Moods']);
    const count = changes.length;
    setBusy(true);
    // Its move controls say so, and stay where they are for the keyboard.
    expect(handle).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Move Next Up down' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    // A move tried is answered, once a press: a press again is read out again (the text changes), a held key's
    // repeats aren't.
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(announced()).toBe('Saving, try again in a moment.');
    fireEvent.keyDown(handle, { key: 'ArrowDown', repeat: true });
    expect(announced()).toBe('Saving, try again in a moment.');
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(announced()).toBe('Saving, try again in a moment.\u00a0');
    fireEvent.keyDown(handle, { key: 'ArrowDown', repeat: true });
    expect(announced()).toBe('Saving, try again in a moment.\u00a0');
    fireEvent.click(screen.getByRole('button', { name: 'Move Next Up down' }));
    expect(announced()).toBe('Saving, try again in a moment.');
    expect(names()).toEqual(['Next Up', 'Continue Watching', 'Moods']);
    expect(changes.length).toBe(count);
    // Escape can't put it back: it's put down where it is.
    fireEvent.keyDown(handle, { key: 'Escape' });
    expect(announced()).toBe('Next Up put down at position 1 of 3.');
    expect(handle).toHaveAttribute('aria-pressed', 'false');
    // Nor picked up again, nor dragged.
    fireEvent.click(handle);
    expect(handle).toHaveAttribute('aria-pressed', 'false');
    layRowsOut();
    dragBy('Moods', 220, 110);
    expect(document.documentElement).not.toHaveClass('lmna-dragging');
    fireEvent.pointerUp(window, { ...MOUSE, buttons: 0, clientY: 110 });
    expect(names()).toEqual(['Next Up', 'Continue Watching', 'Moods']);
    setBusy(false);
    expect(handle).not.toHaveAttribute('aria-disabled');
  });

  it('drops a row dragged with the mouse where the line is, focus on its handle', () => {
    layRowsOut();
    const { names, announced, container } = renderCard();
    // Moods (100 + 2 × 50 = 200 to 240), grabbed 20px down, over the top half of the first row.
    dragBy('Moods', 220, 110);
    expect(document.documentElement).toHaveClass('lmna-dragging');
    expect(container.querySelector('.lmna-sections__drop')).toBeInTheDocument();
    fireEvent.pointerUp(window, { ...MOUSE, buttons: 0, clientY: 110 });
    expect(names()).toEqual(['Moods', 'Continue Watching', 'Next Up']);
    expect(announced()).toBe('Moods moved to position 1 of 3.');
    expect(screen.getByRole('button', { name: 'Move Moods' })).toHaveFocus();
    expect(document.documentElement).not.toHaveClass('lmna-dragging');
    expect(container.querySelector('.lmna-sections__drop')).toBeNull();
  });

  it('cancels a mouse drag the window lost the release of (a button let go elsewhere, alt-tab, a context menu)', () => {
    layRowsOut();
    const { names, announced, changes } = renderCard();
    const lose: Array<() => void> = [
      // Let go outside the window: it moves on with no button down.
      () => fireEvent.pointerMove(window, { ...MOUSE, buttons: 0, clientY: 105 }),
      () => fireEvent.blur(window),
      () => fireEvent.contextMenu(window),
    ];
    for (const lost of lose) {
      const handle = dragBy('Moods', 220, 110);
      lost();
      expect(document.documentElement).not.toHaveClass('lmna-dragging');
      expect(announced()).toBe('Move cancelled. Moods is back at position 3 of 3.');
      // The row doesn't follow the pointer any more, and the next click elsewhere drops nothing.
      const row = handle.closest<HTMLElement>('.lmna-section')!;
      fireEvent.pointerMove(window, { ...MOUSE, buttons: 0, clientY: 150 });
      expect(row.style.transform).toBe('');
      const other = screen.getByRole('button', { name: 'Move Continue Watching' });
      fireEvent.pointerDown(other, { ...MOUSE, clientY: 120 });
      fireEvent.pointerUp(window, { ...MOUSE, buttons: 0, clientY: 120 });
      fireEvent.click(other, { detail: 1 });
      expect(names()).toEqual(['Continue Watching', 'Next Up', 'Moods']);
      expect(changes).toEqual([]);
      // That click was a click: it picked its row up. Put it back down for the next round.
      expect(other).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(other);
    }
  });

  it('doesn’t pick a row up when a drag cancelled with Escape is let go over its handle', async () => {
    layRowsOut();
    const { names, announced } = renderCard();
    const handle = dragBy('Moods', 220, 110);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(announced()).toBe('Move cancelled. Moods is back at position 3 of 3.');
    // A moment later, back over its own handle, it's let go: the click that follows isn't a click on the handle.
    await act(() => new Promise((resolve) => setTimeout(resolve)));
    fireEvent.pointerMove(window, { ...MOUSE, clientY: 220 });
    fireEvent.pointerUp(window, { ...MOUSE, buttons: 0, clientY: 220 });
    fireEvent.click(handle, { detail: 1 });
    expect(handle).toHaveAttribute('aria-pressed', 'false');
    expect(names()).toEqual(['Continue Watching', 'Next Up', 'Moods']);
    // A click of its own, later, is one.
    await act(() => new Promise((resolve) => setTimeout(resolve)));
    fireEvent.pointerDown(handle, { ...MOUSE, clientY: 220 });
    fireEvent.pointerUp(window, { ...MOUSE, buttons: 0, clientY: 220 });
    fireEvent.click(handle, { detail: 1 });
    expect(handle).toHaveAttribute('aria-pressed', 'true');
  });

  it('picks a row up with Enter on its handle after a drag the window lost (no pointer down since)', () => {
    layRowsOut();
    const { announced } = renderCard();
    const lose: Array<() => void> = [
      () => fireEvent.blur(window),
      () => fireEvent.contextMenu(window),
      () => fireEvent.pointerMove(window, { ...MOUSE, buttons: 0, clientY: 105 }),
    ];
    for (const lost of lose) {
      const handle = dragBy('Moods', 220, 110);
      lost();
      expect(announced()).toBe('Move cancelled. Moods is back at position 3 of 3.');
      // Back in the window, the handle still focused: Enter's click (detail 0, from no pointer) is a click.
      handle.focus();
      fireEvent.click(handle, { detail: 0 });
      expect(handle).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(handle, { detail: 0 });
      expect(handle).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('takes a drag down when Discard remounts the card mid-drag: letting go brings nothing back', () => {
    layRowsOut();
    const { names, changes, discard } = renderCard();
    // A change to discard: Next Up to the top.
    const nextUp = screen.getByRole('button', { name: 'Move Next Up' });
    fireEvent.click(nextUp);
    fireEvent.click(screen.getByRole('button', { name: 'Move Next Up up' }));
    fireEvent.click(nextUp);
    expect(names()).toEqual(['Next Up', 'Continue Watching', 'Moods']);
    const count = changes.length;
    // Moods dragged to the top; another finger taps Discard.
    dragBy('Moods', 220, 110);
    discard();
    expect(names()).toEqual(['Continue Watching', 'Next Up', 'Moods']);
    expect(document.documentElement).not.toHaveClass('lmna-dragging');
    fireEvent.pointerMove(window, { ...MOUSE, clientY: 105 });
    fireEvent.pointerUp(window, { ...MOUSE, buttons: 0, clientY: 105 });
    expect(names()).toEqual(['Continue Watching', 'Next Up', 'Moods']);
    expect(changes.length).toBe(count);
  });

  it('puts a picked-up section back where it was with Escape, and a TV remote’s Back', () => {
    const { names, announced } = renderCard();
    for (const back of [{ key: 'Escape' }, { key: 'Unidentified', keyCode: 461 }]) {
      const handle = screen.getByRole('button', { name: 'Move Moods' });
      handle.focus();
      fireEvent.click(handle);
      fireEvent.keyDown(handle, { key: 'ArrowUp' });
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
      expect(names()).toEqual(['Moods', 'Continue Watching', 'Next Up']);
      const event = new KeyboardEvent('keydown', { ...back, bubbles: true, cancelable: true });
      const parent = vi.fn();
      document.addEventListener('keydown', parent);
      act(() => {
        document.activeElement!.dispatchEvent(event);
      });
      document.removeEventListener('keydown', parent);
      // jellyfin-web's Back doesn't see it.
      expect(parent).not.toHaveBeenCalled();
      expect(names()).toEqual(['Continue Watching', 'Next Up', 'Moods']);
      expect(announced()).toBe('Move cancelled. Moods is back at position 3 of 3.');
    }
  });

  it('keeps the arrows for the D-pad while nothing is picked up', () => {
    renderCard();
    const handle = screen.getByRole('button', { name: 'Move Next Up' });
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    handle.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('offers ↑ and ↓ buttons once a section is picked up, for a tap or a screen reader', () => {
    const { names } = renderCard();
    expect(screen.queryByRole('button', { name: 'Move Next Up up' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Move Next Up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move Next Up up' }));
    expect(names()).toEqual(['Next Up', 'Continue Watching', 'Moods']);
    expect(screen.getByRole('button', { name: 'Move Next Up up' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Move Next Up down' }));
    expect(names()).toEqual(['Continue Watching', 'Next Up', 'Moods']);
    // A tap outside the row puts it down.
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('button', { name: 'Move Next Up up' })).toBeNull();
  });

  it('removes a section and moves focus on to the next one', () => {
    const { names, announced } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Continue Watching' }));
    expect(names()).toEqual(['Next Up', 'Moods']);
    expect(announced()).toBe('Continue Watching removed.');
    expect(screen.getByRole('button', { name: 'Move Next Up' })).toHaveFocus();
  });
});
