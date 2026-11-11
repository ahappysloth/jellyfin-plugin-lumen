import { act, render } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import type { BaseItem } from '../../api/types';
import type { ItemMenuOptions, PreparedMenu } from './itemMenu';
import { useItemMenu } from './lazyItemMenu';

/** Each prepareItemMenu call, answered when the test says so. */
const pending: { item: BaseItem; options: ItemMenuOptions; answer: (menu: PreparedMenu) => void }[] = [];
vi.mock('./itemMenu', () => ({
  prepareItemMenu: (_ctx: unknown, item: BaseItem, options: ItemMenuOptions) =>
    new Promise<PreparedMenu>((answer) => pending.push({ item, options, answer })),
}));

const menuFor = (item: BaseItem): PreparedMenu => ({ item, commands: ['delete'], open: vi.fn() });
const season1: BaseItem = { Id: 's1', Name: 'Season 1', Type: 'Season' };
const season2: BaseItem = { Id: 's2', Name: 'Season 2', Type: 'Season' };

function renderHook(item: BaseItem | null) {
  const ctx = makeContext(createFakeClient());
  const seen: (PreparedMenu | null)[] = [];
  function Probe({ item }: { item: BaseItem | null }) {
    seen.push(useItemMenu(ctx, item, {}));
    return null;
  }
  const view = render(<Probe item={item} />);
  return {
    current: () => seen[seen.length - 1],
    rerender: (next: BaseItem | null) => view.rerender(<Probe item={next} />),
    unmount: view.unmount,
  };
}
const answerLast = async (menu: PreparedMenu) => act(async () => pending[pending.length - 1]!.answer(menu));

describe('useItemMenu', () => {
  afterEach(() => {
    pending.length = 0;
  });

  it('has no menu for no item', async () => {
    const hook = renderHook(null);
    await act(async () => undefined);
    expect(hook.current()).toBeNull();
    expect(pending).toHaveLength(0);
  });

  it("drops the old item's menu as soon as the item changes, before the new one is ready", async () => {
    const hook = renderHook(season1);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    await answerLast(menuFor(season1));
    expect(hook.current()?.item.Id).toBe('s1');

    hook.rerender(season2);
    // Not for one render, either: the page would show Season 1's Delete under Season 2's name.
    expect(hook.current()).toBeNull();
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    await answerLast(menuFor(season2));
    expect(hook.current()?.item.Id).toBe('s2');

    hook.rerender(null);
    expect(hook.current()).toBeNull();
  });

  it('keeps the menu while the same item is prepared again (after an edit), so the button stays put', async () => {
    const hook = renderHook(season1);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    const first = menuFor(season1);
    await answerLast(first);

    hook.rerender({ ...season1, Name: 'Season One' });
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(hook.current()).toBe(first);
    const second = menuFor({ ...season1, Name: 'Season One' });
    await answerLast(second);
    expect(hook.current()).toBe(second);
  });

  it('ignores a menu that arrives after the item has changed again', async () => {
    const hook = renderHook(season1);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    hook.rerender(season2);
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => pending[0]!.answer(menuFor(season1)));
    expect(hook.current()).toBeNull();
  });

  it('stops watching for a refresh when the page closes', async () => {
    const hook = renderHook(season1);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    const stop = vi.fn();
    pending[0]!.options.track!(stop);
    expect(stop).not.toHaveBeenCalled();
    act(() => hook.unmount());
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
