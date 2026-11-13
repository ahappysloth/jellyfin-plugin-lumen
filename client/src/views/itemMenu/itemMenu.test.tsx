import { act, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import type { BaseItem } from '../../api/types';
import * as dialogs from '../../compat/itemMenu';
import { ContextMenuHost } from '../../components/ContextMenu';
import { ToastHost } from '../../components/Toast';
import { hasSnapshot, saveSnapshot, takeSnapshot } from '../browse/browseStore';
import { getCachedHome, setCachedHome } from '../home/homeStore';
import { useState } from 'preact/hooks';
import { resetSessionCaches } from '../../util/sessionCaches';
import { openItemMenuAt, prepareItemMenu, resetItemMenuUsers, whenItemDialogsLoad } from './itemMenu';

const trailerInfo = vi.hoisted(() => ({ attachToMediaInfo: vi.fn(), openTrailerInfoDialog: vi.fn() }));
vi.mock('../trailerInfo/lazyTrailerInfo', () => ({ loadTrailerInfo: () => Promise.resolve(trailerInfo) }));

const full = {
  Id: 'm1',
  Name: 'Alpha',
  Type: 'Movie',
  MediaType: 'Video',
  MediaSources: [{ Id: 'm1' }],
  CanDownload: true,
  CanDelete: true,
};
const admin = {
  Id: 'user1',
  Name: 'admin',
  Policy: { IsAdministrator: true, EnableContentDownloading: true },
};
const kid = { Id: 'user1', Name: 'kid', Policy: { EnableContentDownloading: true } };

function context(user: object = admin, layout: 'desktop' | 'tv' = 'desktop') {
  const client = createFakeClient(routes({ 'Users/user1': user, 'Items/m1': full }));
  return { client, ctx: makeContext(client, { layout }) };
}
const card: BaseItem = { Id: 'm1', Name: 'Alpha', Type: 'Movie' }; // as a list returns it: no CanDelete
const labels = () => screen.getAllByRole('menuitem').map((i) => i.textContent);
const choose = (name: string) => fireEvent.click(screen.getByRole('menuitem', { name }));

describe('the item menu', () => {
  beforeEach(() => {
    resetItemMenuUsers();
    vi.spyOn(dialogs, 'canOpenItemDialogs').mockReturnValue(true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetSessionCaches();
  });

  it('fetches a card’s full item and the user’s policy, then lists what jellyfin-web would offer', async () => {
    const { client, ctx } = context();
    render(<ContextMenuHost />);
    await act(() => openItemMenuAt(ctx, card, { x: 10, y: 10, returnFocus: null }));

    expect(screen.getByRole('menu', { name: 'More actions for Alpha' })).toBeTruthy();
    expect(labels()).toEqual([
      'Add to playlist',
      'Add to collection',
      'Download',
      'Copy stream URL',
      'Media info',
      'Edit metadata',
      'Edit images',
      'Edit subtitles',
      'Identify',
      'Refresh metadata',
      'Delete movie',
    ]);
    // A line before the editors and before Delete.
    const separated = screen
      .getAllByRole('menuitem')
      .filter((i) => i.classList.contains('lmn-menu__item--separated'))
      .map((i) => i.textContent);
    expect(separated).toEqual(['Edit metadata', 'Delete movie']);
    expect(client.requests.map((r) => new URL(r.url).pathname)).toEqual(['/Items/m1', '/Users/user1']);
  });

  it('asks for the user once per page load, and not for a page’s own full item', async () => {
    const { client, ctx } = context(kid);
    await prepareItemMenu(ctx, { ...full } as BaseItem, { complete: true });
    await prepareItemMenu(ctx, { ...full } as BaseItem, { complete: true });
    expect(client.requests.map((r) => new URL(r.url).pathname)).toEqual(['/Users/user1']);
  });

  it('says so when there is nothing to offer', async () => {
    const { ctx } = context({ ...kid, Policy: {} }, 'tv');
    render(<ToastHost />);
    const series = { Id: 's1', Name: 'Show', Type: 'Series', IsFolder: true, CanDelete: false } as BaseItem;
    await openItemMenuAt(ctx, series, { x: 0, y: 0, returnFocus: null });
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Nothing more to do with this one'),
    );
  });

  it("opens jellyfin-web's dialog with the full item and user, and reloads the page after a change", async () => {
    const open = vi.spyOn(dialogs, 'openItemDialog').mockResolvedValue({ updated: true, deleted: false });
    const { ctx } = context();
    const onChanged = vi.fn();
    const onDeleted = vi.fn();
    render(<ContextMenuHost />);
    const menu = await prepareItemMenu(ctx, card, { onChanged, onDeleted });
    act(() => menu.open({ x: 0, y: 0, returnFocus: null }));

    choose('Edit metadata');
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ Id: 'm1', CanDelete: true }), admin, 'edit');
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('adds the Trailer section to a movie’s Media info, which still opens as jellyfin-web has it', async () => {
    const open = vi.spyOn(dialogs, 'openItemDialog').mockResolvedValue({ updated: false, deleted: false });
    const { ctx } = context();
    render(<ContextMenuHost />);
    const menu = await prepareItemMenu(ctx, card);
    act(() => menu.open({ x: 0, y: 0, returnFocus: null }));

    choose('Media info');
    await waitFor(() => expect(open).toHaveBeenCalledWith(expect.anything(), admin, 'moremediainfo'));
    await waitFor(() =>
      expect(trailerInfo.attachToMediaInfo).toHaveBeenCalledWith(ctx, {
        key: 'm1',
        of: 'Items/m1',
        name: 'Alpha',
      }),
    );
  });

  it('gives a show Trailer info, in Lumen’s dialog, while trailer previews are on', async () => {
    const show = { Id: 's1', Name: 'Saga', Type: 'Series', IsFolder: true, CanDelete: false };
    const client = createFakeClient(routes({ 'Users/user1': kid, 'Items/s1': show }));
    const ctx = makeContext(client, { config: { ...makeContext(client).config, TrailerPreview: true } });
    render(<ContextMenuHost />);
    const menu = await prepareItemMenu(ctx, show as BaseItem, { complete: true });
    expect(menu.commands).toContain('trailerinfo');
    act(() => menu.open({ x: 0, y: 0, returnFocus: null }));

    choose('Trailer info');
    await waitFor(() =>
      expect(trailerInfo.openTrailerInfoDialog).toHaveBeenCalledWith(
        ctx,
        { key: 's1', of: 'Items/s1', name: 'Saga' },
        expect.anything(),
      ),
    );
    expect(
      (await prepareItemMenu(makeContext(client), show as BaseItem, { complete: true })).commands,
    ).not.toContain('trailerinfo');
  });

  it("opens jellyfin-web's dialog once its stylesheet is in, so it doesn't restyle as it shows", async () => {
    const open = vi.spyOn(dialogs, 'openItemDialog').mockResolvedValue({ updated: false, deleted: false });
    // The guard's link, still on its way.
    const link = document.createElement('link');
    link.setAttribute('data-lmn-css', 'lumen-stock.css');
    document.head.append(link);
    const { ctx } = context();
    render(<ContextMenuHost />);
    const menu = await prepareItemMenu(ctx, card, {});
    act(() => menu.open({ x: 0, y: 0, returnFocus: null }));

    choose('Edit metadata');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(open).not.toHaveBeenCalled();
    link.dispatchEvent(new Event('load'));
    await waitFor(() => expect(open).toHaveBeenCalled());
    link.remove();
  });

  it('leaves the page after a deletion', async () => {
    vi.spyOn(dialogs, 'openItemDialog').mockResolvedValue({ updated: true, deleted: true });
    const { ctx } = context();
    const onChanged = vi.fn();
    const onDeleted = vi.fn();
    render(<ContextMenuHost />);
    const menu = await prepareItemMenu(ctx, card, { onChanged, onDeleted });
    act(() => menu.open({ x: 0, y: 0, returnFocus: null }));

    choose('Delete movie');
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("forgets a deleted title in saved grids and the cached home, so Back doesn't bring its card back", async () => {
    vi.spyOn(dialogs, 'openItemDialog').mockResolvedValue({ updated: false, deleted: true });
    const { ctx } = context();
    saveSnapshot('movies', {
      items: [card, { Id: 'm2', Name: 'Beta', Type: 'Movie' }],
      total: 2,
      scrollY: 0,
      offset: 2,
    });
    const beta = { Id: 'm2', Name: 'Beta', Type: 'Movie' };
    setCachedHome('user1', {
      ConfigVersion: 1,
      Hero: [],
      Rows: [{ Id: 'r1', Type: 'Latest', Title: 'Latest', Items: [card, beta] }],
    });
    const onDeleted = vi.fn();
    render(<ContextMenuHost />);
    const menu = await prepareItemMenu(ctx, card, { onDeleted });
    act(() => menu.open({ x: 0, y: 0, returnFocus: null }));

    choose('Delete movie');
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(getCachedHome('user1')!.Rows[0]!.Items).toEqual([beta]);
    expect(hasSnapshot('movies')).toBe(true);
    const grid = takeSnapshot('movies')!;
    expect(grid.items.map((i) => i.Id)).toEqual(['m2']);
    expect([grid.total, grid.offset]).toEqual([1, 1]);
  });

  it("offers only what jellyfin-web's own menu would, where it can be asked (a TV browser, no file saving)", async () => {
    const stock = vi
      .spyOn(dialogs, 'stockItemCommands')
      .mockResolvedValue(['delete', 'edit', 'refresh', 'play']);
    const { ctx } = context();
    render(<ContextMenuHost />);
    const menu = await prepareItemMenu(ctx, card);
    act(() => menu.open({ x: 0, y: 0, returnFocus: null }));

    expect(labels()).toEqual(['Edit metadata', 'Refresh metadata', 'Delete movie']);
    expect(stock).toHaveBeenCalledWith(expect.objectContaining({ Id: 'm1', CanDelete: true }), admin);
  });

  it('asks jellyfin-web again as the menu opens, if its item menu loaded after the menu was prepared', async () => {
    const loaded = vi.spyOn(dialogs, 'canOpenItemDialogs').mockReturnValue(false);
    const stock = vi
      .spyOn(dialogs, 'stockItemCommands')
      .mockResolvedValue(['addtoplaylist', 'edit', 'delete']);
    const { client, ctx } = context();
    render(<ContextMenuHost />);
    const menu = await prepareItemMenu(ctx, card);
    // Lumen's own rules, without the dialogs only jellyfin-web can open.
    expect(menu.dialogs).toBe(false);
    expect(menu.commands).not.toContain('delete');
    expect(stock).not.toHaveBeenCalled();

    loaded.mockReturnValue(true);
    act(() => menu.open({ x: 0, y: 0, returnFocus: null }));
    await waitFor(() => expect(labels()).toEqual(['Add to playlist', 'Edit metadata', 'Delete movie']));
    // The full item it already had: only the user is asked for, once.
    expect(client.requests.map((r) => new URL(r.url).pathname)).toEqual(['/Items/m1', '/Users/user1']);
  });

  it("waits up to 30 s for jellyfin-web's item menu to load", () => {
    vi.useFakeTimers();
    const loaded = vi.spyOn(dialogs, 'canOpenItemDialogs').mockReturnValue(false);
    const then = vi.fn();
    whenItemDialogsLoad(then);
    vi.advanceTimersByTime(5000);
    expect(then).not.toHaveBeenCalled();
    loaded.mockReturnValue(true);
    vi.advanceTimersByTime(60_000);
    expect(then).toHaveBeenCalledTimes(1);

    loaded.mockReturnValue(false);
    const late = vi.fn();
    whenItemDialogsLoad(late);
    vi.advanceTimersByTime(30_000);
    loaded.mockReturnValue(true);
    vi.advanceTimersByTime(60_000);
    expect(late).not.toHaveBeenCalled();

    const stopped = vi.fn();
    whenItemDialogsLoad(stopped)();
    vi.advanceTimersByTime(60_000);
    expect(stopped).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  describe('focus after a delete from a card', () => {
    const titles = ['a', 'b', 'c'].map((Id) => ({ ...full, Id, Name: Id.toUpperCase() }));
    /** A list of cards, as Lumen's rows and grids render them, that drops a card when its title is deleted. */
    let menuFor: (id: string, from: HTMLElement) => Promise<void>;
    /** A row's cards (in the row itself), or with `grid` a grid's (each in a list item). */
    function List({
      ctx,
      more,
      grid,
    }: {
      ctx: ReturnType<typeof context>['ctx'];
      more?: boolean;
      grid?: boolean;
    }) {
      const [items, setItems] = useState(titles);
      menuFor = (id, from) =>
        openItemMenuAt(
          ctx,
          titles.find((t) => t.Id === id)!,
          { x: 0, y: 0, returnFocus: from },
          { onDeleted: () => setItems((list) => list.filter((i) => i.Id !== id)) },
        );
      const cell = (item: (typeof titles)[number]) => (
        <div class="lmn-card-cell" key={item.Id}>
          <a href="#" class="lmn-card" data-item-id={item.Id}>
            {item.Name}
          </a>
          {more && (
            <button type="button" class="lmn-card__more">
              More for {item.Name}
            </button>
          )}
        </div>
      );
      return (
        <main class="lmn-main">
          <button type="button">Sort</button>
          <div role={grid ? 'list' : undefined}>
            {items.map((item) =>
              grid ? (
                <div role="listitem" key={item.Id}>
                  {cell(item)}
                </div>
              ) : (
                cell(item)
              ),
            )}
          </div>
        </main>
      );
    }
    async function deleteFrom(id: string, more = false) {
      const card = document.querySelector<HTMLElement>(`[data-item-id="${id}"]`)!;
      const from = more ? (card.nextElementSibling as HTMLElement) : card;
      from.focus();
      await act(() => menuFor(id, from));
      choose('Delete movie');
    }

    beforeEach(() => {
      vi.spyOn(dialogs, 'openItemDialog').mockResolvedValue({ updated: false, deleted: true });
    });

    it('moves to the card after it, or before it if it was the last, as its kind of control', async () => {
      const { ctx } = context();
      render(
        <>
          <List ctx={ctx} more />
          <ContextMenuHost />
        </>,
      );
      // A ⋯ button stays on ⋯ buttons.
      await deleteFrom('c', true);
      await waitFor(() => expect(document.querySelector('[data-item-id="c"]')).toBeNull());
      await waitFor(() => expect(document.activeElement?.textContent).toBe('More for B'));
      await deleteFrom('a', true);
      await waitFor(() => expect(document.querySelector('[data-item-id="a"]')).toBeNull());
      // Its refocus has run (the list may have reused the deleted card's element for the next one).
      await act(() => new Promise((resolve) => setTimeout(resolve)));
      expect(document.activeElement?.textContent).toBe('More for B');
    });

    it('does so for a TV layout’s cards in a grid, and goes to the page’s first control when none is left', async () => {
      // The TV layout: no ⋯ buttons, the card itself had focus. A grid, where each card is in a list item.
      const { ctx } = context(admin, 'tv');
      render(
        <>
          <List ctx={ctx} grid />
          <ContextMenuHost />
        </>,
      );
      const focused = () => document.activeElement?.getAttribute('data-item-id');
      await deleteFrom('c');
      await waitFor(() => expect(focused()).toBe('b'));
      await deleteFrom('b');
      await waitFor(() => expect(focused()).toBe('a'));
      await deleteFrom('a');
      await waitFor(() => expect(document.activeElement?.textContent).toBe('Sort'));
    });
  });

  it("doesn't watch for a refresh the user cancelled", async () => {
    vi.spyOn(dialogs, 'openItemDialog').mockResolvedValue({
      updated: false,
      deleted: false,
      refreshQueued: false,
    });
    const { client, ctx } = context();
    client.subscribe = vi.fn(() => vi.fn());
    const onChanged = vi.fn();
    render(<ContextMenuHost />);
    const menu = await prepareItemMenu(ctx, card, { onChanged });
    act(() => menu.open({ x: 0, y: 0, returnFocus: null }));

    choose('Refresh metadata');
    await waitFor(() => expect(dialogs.openItemDialog).toHaveBeenCalled());
    await act(async () => undefined);
    expect(client.subscribe).not.toHaveBeenCalled();
  });

  it('hands the watch for a started refresh to the page, which stops it when it closes', async () => {
    vi.spyOn(dialogs, 'openItemDialog').mockResolvedValue({
      updated: false,
      deleted: false,
      refreshQueued: true,
    });
    const { client, ctx } = context();
    const off = vi.fn();
    client.subscribe = vi.fn(() => off);
    const track = vi.fn();
    render(<ContextMenuHost />);
    const menu = await prepareItemMenu(ctx, card, { onChanged: vi.fn(), track });
    act(() => menu.open({ x: 0, y: 0, returnFocus: null }));

    choose('Refresh metadata');
    await waitFor(() => expect(track).toHaveBeenCalledWith(expect.any(Function)));
    expect(off).not.toHaveBeenCalled();
    (track.mock.calls[0] as [() => void])[0]();
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('reloads after a refresh once the server reports the item updated', async () => {
    vi.spyOn(dialogs, 'openItemDialog').mockResolvedValue({ updated: false, deleted: false });
    const { client, ctx } = context();
    let listener: ((message: { Data?: unknown }) => void) | undefined;
    const stop = vi.fn();
    client.subscribe = vi.fn((_types, l) => {
      listener = l;
      return stop;
    });
    const onChanged = vi.fn();
    render(<ContextMenuHost />);
    const menu = await prepareItemMenu(ctx, card, { onChanged });
    act(() => menu.open({ x: 0, y: 0, returnFocus: null }));

    choose('Refresh metadata');
    await waitFor(() =>
      expect(client.subscribe).toHaveBeenCalledWith(['LibraryChanged'], expect.any(Function)),
    );
    listener!({ Data: { ItemsUpdated: ['other'] } });
    expect(onChanged).not.toHaveBeenCalled();
    listener!({ Data: { ItemsUpdated: ['m1'] } });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalled();
  });

  describe("a card's More actions…", () => {
    const at = { x: 0, y: 0, returnFocus: null };

    it('tells the list about a deletion', async () => {
      vi.spyOn(dialogs, 'openItemDialog').mockResolvedValue({ updated: false, deleted: true });
      const { ctx } = context();
      const onDeleted = vi.fn();
      render(<ContextMenuHost />);
      await act(() => openItemMenuAt(ctx, card, at, { onDeleted, openDetails: vi.fn() }));

      choose('Delete movie');
      await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(card));
    });

    it('gives the list (and saved grids) the title as the server has it after an edit', async () => {
      vi.spyOn(dialogs, 'openItemDialog').mockResolvedValue({ updated: true, deleted: false });
      const { client, ctx } = context();
      saveSnapshot('movies', { items: [card], total: 1, scrollY: 0 });
      const onChanged = vi.fn();
      render(<ContextMenuHost />);
      await act(() => openItemMenuAt(ctx, card, at, { onChanged }));
      client.respond = routes({ 'Items/m1': { ...full, Name: 'Alpha (Director’s Cut)' } });

      choose('Edit metadata');
      await waitFor(() =>
        expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ Name: 'Alpha (Director’s Cut)' })),
      );
      expect(takeSnapshot('movies')!.items[0]!.Name).toBe('Alpha (Director’s Cut)');
    });

    it("opens the title's page instead where jellyfin-web hasn't loaded its item menu (a TV browser's home)", async () => {
      vi.spyOn(dialogs, 'canOpenItemDialogs').mockReturnValue(false);
      const { client, ctx } = context();
      const openDetails = vi.fn();
      render(<ContextMenuHost />);
      await act(() => openItemMenuAt(ctx, card, at, { openDetails }));

      expect(openDetails).toHaveBeenCalled();
      expect(screen.queryByRole('menu')).toBeNull();
      expect(client.requests).toEqual([]);
    });
  });

  describe("when jellyfin-web's dialogs can't be opened here", () => {
    beforeEach(() => vi.spyOn(dialogs, 'canOpenItemDialogs').mockReturnValue(false));

    it("sends an administrator's edit to the metadata manager", async () => {
      vi.spyOn(dialogs, 'openItemDialog').mockRejectedValue(new dialogs.ItemDialogUnavailable('not found'));
      const { ctx } = context();
      render(<ContextMenuHost />);
      const menu = await prepareItemMenu(ctx, card);
      act(() => menu.open({ x: 0, y: 0, returnFocus: null }));

      // Without a stock page to fall back to, only what still works is offered.
      expect(labels()).toEqual([
        'Download',
        'Copy stream URL',
        'Edit metadata',
        'Edit images',
        'Identify',
        'Refresh metadata',
      ]);
      choose('Edit images');
      await waitFor(() => expect(ctx.navigate).toHaveBeenCalledWith('#/metadata?id=m1'));
    });

    it('hands a details page back to jellyfin-web for the rest', async () => {
      vi.spyOn(dialogs, 'openItemDialog').mockRejectedValue(new dialogs.ItemDialogUnavailable('not found'));
      const { ctx } = context(kid);
      const fallback = vi.fn();
      render(<ContextMenuHost />);
      const menu = await prepareItemMenu(ctx, card, { fallback });
      act(() => menu.open({ x: 0, y: 0, returnFocus: null }));

      expect(labels()).toContain('Add to playlist');
      choose('Add to playlist');
      await waitFor(() => expect(fallback).toHaveBeenCalled());
    });
  });

  it('copies the stream URL itself, and says so', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('isSecureContext', true);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { ctx } = context();
    render(
      <>
        <ContextMenuHost />
        <ToastHost />
      </>,
    );
    const menu = await prepareItemMenu(ctx, card);
    act(() => menu.open({ x: 0, y: 0, returnFocus: null }));

    choose('Copy stream URL');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Stream URL copied'));
    expect(writeText).toHaveBeenCalledWith('http://jf/Items/m1/Download?ApiKey=token1');
    vi.unstubAllGlobals();
  });
});
