import { act, fireEvent, render, screen } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { describe, expect, it, vi } from 'vitest';
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

/** The card with the configuration kept as AdminApp keeps it, every change recorded. */
function renderCard(start: SectionDef[] = sections()) {
  const changes: SectionDef[][] = [];
  function Harness() {
    const [config, setConfig] = useState({ Sections: start } as LumenConfig);
    return (
      <HomeSectionsSettings
        config={config}
        types={types}
        lookups={{ Library: [], Collection: [], Playlist: [] }}
        newId={() => 'new1'}
        update={(patch) => {
          changes.push(patch.Sections!);
          setConfig((c) => ({ ...c, ...patch }));
        }}
      />
    );
  }
  const view = render(<Harness />);
  const names = () => [...view.container.querySelectorAll('.lmna-section__label')].map((n) => n.textContent);
  const announced = () => view.container.querySelector('[aria-live="assertive"]')!.textContent;
  return { ...view, changes, names, announced };
}

const last = <T,>(list: T[]): T => list[list.length - 1]!;

describe('HomeSectionsSettings', () => {
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
    // Still the handle that has focus, after the row moved.
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
