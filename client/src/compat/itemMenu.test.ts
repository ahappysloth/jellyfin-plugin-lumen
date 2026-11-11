import { describe, expect, it, vi } from 'vitest';
import type { BaseItem } from '../api/types';
import {
  canOpenItemDialogs,
  findItemMenu,
  ItemDialogUnavailable,
  openItemDialog,
  stockItemCommands,
  whenRefreshDialogCloses,
} from './itemMenu';

/** Minified sources: what the search sees of each module (12.4's chunks, abridged). */
const MENU_SOURCE =
  'n.d(t,{getCommands:function(){return g},show:function(){return E}});case"addtocollection":case"editsubtitles":' +
  'case"moremediainfo":throw new Error("No item commands present")';
const SHEET_SOURCE = 'class="actionSheetMenuItem";resolveOnClick:["share"];t.default={show:d}';

const item = { Id: 'm1', Name: 'Movie', Type: 'Movie', ServerId: 's1' } as BaseItem;
const user = { Id: 'u1', Policy: { IsAdministrator: true } };

interface Fakes {
  /** The commands jellyfin-web's getCommands lists. */
  offers?: string[];
  /** What running the command resolves with (its dialog closing). */
  result?: { updated?: boolean; deleted?: boolean };
  /** Extra modules, e.g. a second match. */
  extra?: Record<string, { source: string; exports: unknown }>;
  sheetExports?: (show: () => Promise<string>) => unknown;
}

/**
 * jellyfin-web's item menu and action sheet as webpack modules: `show` lists the commands, asks the sheet (through
 * `default.show`, looked up as it calls, like the real one) and "runs" the answer.
 */
function fakeJellyfinWeb({ offers = ['edit', 'delete'], result = {}, extra = {}, sheetExports }: Fakes = {}) {
  const ran: string[] = [];
  const stockSheet = vi.fn(async () => 'stock-choice');
  const sheetModule = (sheetExports?.(stockSheet) ?? { show: stockSheet, default: { show: stockSheet } }) as {
    default: { show: (o: unknown) => Promise<string> };
  };
  const menu = {
    getCommands: vi.fn(async () => offers.map((id) => ({ id }))),
    show: vi.fn(async (options: { positionTo: unknown }) => {
      const id = await sheetModule.default.show({
        items: offers.map((o) => ({ id: o })),
        positionTo: options.positionTo,
      });
      ran.push(id);
      return { command: id, ...result };
    }),
  };
  const modules: Record<string, { source: string; exports: unknown }> = {
    '1': { source: 'unrelated', exports: {} },
    '55802': { source: MENU_SOURCE, exports: { ...menu, default: menu } },
    '62882': { source: SHEET_SOURCE, exports: sheetModule },
    ...extra,
  };
  const required: string[] = [];
  const require = Object.assign(
    (id: string) => {
      required.push(id);
      return modules[id]!.exports;
    },
    { m: Object.fromEntries(Object.entries(modules).map(([id, m]) => [id, m.source])) },
  );
  const push = (chunk: [unknown, unknown, (r: typeof require) => void]) => chunk[2](require);
  const win = { webpackChunk: Object.assign([], { push }), document } as unknown as Window;
  return { win, menu, sheet: sheetModule.default, stockSheet, ran, required };
}

describe('findItemMenu', () => {
  it("finds jellyfin-web's item menu and action sheet by their code, requiring only those two", () => {
    const { win, required } = fakeJellyfinWeb();
    expect(findItemMenu(win)).not.toBeNull();
    expect(canOpenItemDialogs(win)).toBe(true);
    expect(required.sort()).toEqual(['55802', '62882']);
  });

  it('finds nothing when the item menu has not loaded, and requires nothing', () => {
    const { win, required } = fakeJellyfinWeb({
      extra: { '55802': { source: 'something else', exports: {} } },
    });
    expect(findItemMenu(win)).toBeNull();
    expect(required).toEqual([]);
  });

  it('finds nothing when two modules match (it would be guessing)', () => {
    const { win } = fakeJellyfinWeb({ extra: { '9': { source: MENU_SOURCE, exports: {} } } });
    expect(findItemMenu(win)).toBeNull();
  });

  it("finds nothing when the action sheet's default export is not its show", () => {
    const { win } = fakeJellyfinWeb({
      sheetExports: (show) => ({ show, default: { show: () => Promise.resolve('x') } }),
    });
    expect(findItemMenu(win)).toBeNull();
  });
});

describe('openItemDialog', () => {
  it("runs the command through jellyfin-web's own menu, answering its action sheet without showing it", async () => {
    const { win, menu, sheet, stockSheet, ran } = fakeJellyfinWeb({ result: { updated: true } });
    const original = sheet.show;

    await expect(openItemDialog(item, user, 'edit', win)).resolves.toEqual({ updated: true, deleted: false });
    expect(ran).toEqual(['edit']);
    expect(menu.show).toHaveBeenCalledWith(expect.objectContaining({ item, user }));
    expect(stockSheet).not.toHaveBeenCalled();
    expect(sheet.show).toBe(original);
  });

  it('reports a deletion', async () => {
    const { win } = fakeJellyfinWeb({ result: { updated: true, deleted: true } });
    await expect(openItemDialog(item, user, 'delete', win)).resolves.toEqual({
      updated: true,
      deleted: true,
    });
  });

  it("refuses a command jellyfin-web doesn't offer, and leaves its sheet as it was", async () => {
    const { win, sheet, ran } = fakeJellyfinWeb({ offers: ['moremediainfo'] });
    const original = sheet.show;
    await expect(openItemDialog(item, user, 'edit', win)).rejects.toBeInstanceOf(ItemDialogUnavailable);
    expect(ran).toEqual([]);
    expect(sheet.show).toBe(original);
  });

  it('treats a menu that fails before asking as unavailable, and puts the sheet back', async () => {
    const { win, menu, sheet } = fakeJellyfinWeb();
    const original = sheet.show;
    menu.show.mockRejectedValueOnce(new Error('No item commands present'));
    await expect(openItemDialog(item, user, 'edit', win)).rejects.toBeInstanceOf(ItemDialogUnavailable);
    expect(sheet.show).toBe(original);
  });

  it("leaves anyone else's action sheet to jellyfin-web while it waits", async () => {
    const { win, sheet, stockSheet, menu } = fakeJellyfinWeb();
    let release!: () => void;
    menu.getCommands.mockImplementation(() => new Promise((r) => (release = () => r([]))));
    menu.show.mockImplementationOnce(async (options) => {
      await menu.getCommands();
      return { command: await sheet.show({ items: [{ id: 'edit' }], positionTo: options.positionTo }) };
    });
    const pending = openItemDialog(item, user, 'edit', win);
    await expect(sheet.show({ items: [{ id: 'edit' }], positionTo: null })).resolves.toBe('stock-choice');
    expect(stockSheet).toHaveBeenCalledTimes(1);
    release();
    await expect(pending).resolves.toEqual({ updated: false, deleted: false });
  });

  it('throws ItemDialogUnavailable when jellyfin-web has no item menu on this page', async () => {
    const win = { document } as unknown as Window;
    await expect(openItemDialog(item, user, 'edit', win)).rejects.toBeInstanceOf(ItemDialogUnavailable);
  });
});

describe('stockItemCommands', () => {
  it("asks jellyfin-web's own getCommands for the item and user", async () => {
    const { win, menu } = fakeJellyfinWeb({ offers: ['edit', 'refresh', 'delete'] });
    await expect(stockItemCommands(item, user, win)).resolves.toEqual(['edit', 'refresh', 'delete']);
    expect(menu.getCommands).toHaveBeenCalledWith({ item, user });
  });

  it("is null when it can't be asked, or fails", async () => {
    await expect(stockItemCommands(item, user, { document } as unknown as Window)).resolves.toBeNull();
    const { win, menu } = fakeJellyfinWeb();
    menu.getCommands.mockRejectedValueOnce(new Error('offline'));
    await expect(stockItemCommands(item, user, win)).resolves.toBeNull();
  });
});

describe("refresh's dialog", () => {
  /** jellyfin-web's refresh dialog as dialogHelper shows it: a .dialog with the form, sending `close` once it's gone. */
  function showRefreshDialog() {
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.innerHTML =
      '<form><select id="selectMetadataRefreshMode"></select><button type="submit">Refresh</button></form>';
    document.body.appendChild(dialog);
    const close = () => {
      dialog.remove();
      dialog.dispatchEvent(new CustomEvent('close'));
    };
    return {
      submit: () => {
        dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        close();
      },
      cancel: close,
    };
  }

  it('resolves only once the dialog that opens after the menu has resolved closes, saying it was started', async () => {
    const { win } = fakeJellyfinWeb({ offers: ['refresh'] });
    let settled = false;
    const pending = openItemDialog(item, user, 'refresh', win).then((r) => {
      settled = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(settled).toBe(false); // jellyfin-web's menu has resolved; its dialog is still loading
    const dialog = showRefreshDialog();
    await new Promise((r) => setTimeout(r, 0));
    expect(settled).toBe(false);
    dialog.submit();
    await expect(pending).resolves.toEqual({ updated: false, deleted: false, refreshQueued: true });
  });

  it('says so when it was cancelled', async () => {
    const closed = whenRefreshDialogCloses(window);
    const dialog = showRefreshDialog();
    await new Promise((r) => setTimeout(r, 0));
    dialog.cancel();
    await expect(closed).resolves.toBe(false);
  });

  it("gives up on a dialog that doesn't open", async () => {
    await expect(whenRefreshDialogCloses(window, 10)).resolves.toBeNull();
  });
});
