import { act, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import type { BaseItem } from '../../api/types';
import * as dialogs from '../../compat/itemMenu';
import { ContextMenuHost } from '../../components/ContextMenu';
import { ToastHost } from '../../components/Toast';
import { openItemMenuAt, prepareItemMenu, resetItemMenuUsers } from './itemMenu';

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
  afterEach(() => vi.restoreAllMocks());

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
