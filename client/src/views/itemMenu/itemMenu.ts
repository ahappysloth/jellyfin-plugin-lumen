/**
 * The item menu: jellyfin-web's ⋯ actions for a title (edit metadata, identify, images, subtitles, media info,
 * collections, playlists, refresh, delete, downloads), in Lumen's own menu. Loaded when a page first needs it
 * (./lazyItemMenu.ts): none of it is on the startup path.
 *
 * Who sees what is jellyfin-web's rule (./itemCommands.ts). The dialogs are jellyfin-web's own (compat/itemMenu.ts);
 * where Lumen can't open one, an administrator's edit goes to the metadata manager and the rest to the page's stock
 * version (a details page hands its route back to jellyfin-web, whose own ⋯ menu has the action). With neither, the
 * action isn't offered.
 */
import type { BaseItem, UserInfo } from '../../api/types';
import {
  canOpenItemDialogs,
  ItemDialogUnavailable,
  openItemDialog,
  stockItemCommands,
} from '../../compat/itemMenu';
import { metadataHash } from '../../compat/jellyfin';
import { type MenuEntry, openContextMenu } from '../../components/ContextMenu';
import type { IconRef } from '../../components/icons';
import { showToast } from '../../components/Toast';
import { strings } from '../../strings';
import { whenStockCss } from '../../veil/stockCss';
import type { ViewContext } from '../context';
import { downloadUrl, nativeDownload } from '../details/download';
import { loadTrailerInfo, settleMediaInfo } from '../trailerInfo/lazyTrailerInfo';
import { forgetItem, rememberEdit } from '../itemChanges';
import { COMMAND_GROUPS, type ItemCommand, itemCommands, type MenuItem } from './itemCommands';
import { ITEM_MENU_ICONS } from './itemMenuIcons';
import { itemMenuStrings } from './itemMenuStrings';

export interface ItemMenuOptions {
  /** `item` came from `GET /Items/{id}` (a details page's own): no need to fetch it again. */
  complete?: boolean;
  /** The page already shows Download for this item. */
  downloadButton?: boolean;
  /** The item changed (metadata saved, refreshed, images or subtitles edited, added to a collection). */
  onChanged?: () => void;
  /** The item was deleted (saved grids and the cached home have already forgotten it). */
  onDeleted?: () => void;
  /** The page's stock version, for actions Lumen can't open here (see the top of this file). */
  fallback?: () => void;
  /** Given the stop of a refresh's watch for the server's update, for the page to call when it closes. */
  track?: (stop: () => void) => void;
}

/** A menu ready to show: the full item, and what this user may do with it. */
export interface PreparedMenu {
  item: MenuItem;
  commands: ItemCommand[];
  /**
   * Whether jellyfin-web's item menu had loaded, to work out the commands with. Its chunk can come seconds after the
   * page (a slow TV): a menu prepared before then is prepared again as it opens, and useItemMenu prepares it again
   * once the chunk is in.
   */
  dialogs: boolean;
  /** Shows the menu at a point (a card's long-press) or under a button. */
  open(at: {
    x: number;
    y: number;
    returnFocus: HTMLElement | null;
    anchor?: HTMLElement;
    title?: string;
    /** Once the menu has closed (an entry picked or dismissed). */
    onClose?: () => void;
  }): void;
}

/** Each user's account, for their policy: fetched once per page load (a failure is asked again next time). */
const users = new Map<string, Promise<UserInfo>>();
function currentUser(ctx: ViewContext): Promise<UserInfo> {
  let user = users.get(ctx.userId);
  if (!user) {
    user = ctx.api.getCurrentUser();
    users.set(ctx.userId, user);
    user.catch(() => users.delete(ctx.userId));
  }
  return user;
}

/** Commands that are jellyfin-web dialogs (the downloads and Trailer info are Lumen's own). */
const isDialog = (command: ItemCommand): boolean =>
  command !== 'download' && command !== 'copy-stream' && command !== 'trailerinfo';
/** An administrator's editors, which the metadata manager also has (its own ⋯ menu has Identify, Refresh, …). */
const IN_METADATA_MANAGER: readonly ItemCommand[] = ['edit', 'editimages', 'identify', 'refresh'];

const LABELS: Record<ItemCommand, (item: MenuItem) => string> = {
  addtoplaylist: () => itemMenuStrings.addToPlaylist,
  addtocollection: () => itemMenuStrings.addToCollection,
  download: () => strings.download,
  downloadall: () => itemMenuStrings.downloadAll,
  'copy-stream': () => itemMenuStrings.copyStreamUrl,
  moremediainfo: () => itemMenuStrings.mediaInfo,
  trailerinfo: () => itemMenuStrings.trailerInfo,
  edit: () => itemMenuStrings.editMetadata,
  editimages: () => itemMenuStrings.editImages,
  editsubtitles: () => itemMenuStrings.editSubtitles,
  identify: () => itemMenuStrings.identify,
  refresh: () => itemMenuStrings.refreshMetadata,
  delete: (item) => itemMenuStrings.deleteItem(item.Type),
};
const ICONS: Record<ItemCommand, IconRef> = {
  addtoplaylist: ITEM_MENU_ICONS.playlistAdd,
  addtocollection: ITEM_MENU_ICONS.collection,
  download: 'download',
  downloadall: 'download',
  'copy-stream': ITEM_MENU_ICONS.copy,
  moremediainfo: 'info',
  trailerinfo: 'film',
  edit: 'edit',
  editimages: ITEM_MENU_ICONS.image,
  editsubtitles: ITEM_MENU_ICONS.closedCaption,
  identify: 'search',
  refresh: ITEM_MENU_ICONS.refresh,
  delete: ITEM_MENU_ICONS.trash,
};

/**
 * Puts text on the clipboard. The async clipboard needs a secure context, which a server reached over plain http on
 * the LAN isn't; there the old copy command still works from a user's click.
 */
async function copyText(text: string, doc: Document = document): Promise<void> {
  if (navigator.clipboard?.writeText && window.isSecureContext) return navigator.clipboard.writeText(text);
  const field = doc.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  doc.body.appendChild(field);
  field.select();
  try {
    if (!doc.execCommand('copy')) throw new Error('copy refused');
  } finally {
    field.remove();
  }
}

/** Starts the file's download the way the page's Download link does. */
function download(ctx: ViewContext, item: MenuItem): void {
  const url = downloadUrl(ctx.client, item.Id);
  if (nativeDownload(item, url)) return;
  const link = document.createElement('a');
  link.href = url;
  link.download = '';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Ten minutes: a metadata refresh of a big series can take a while; after that the page is left as it is. */
const REFRESH_WATCH_MS = 10 * 60 * 1000;
/**
 * Calls back once the server reports the item updated (its LibraryChanged message, as jellyfin-web's own pages
 * listen for): a refresh runs on the server after the dialog has closed. Returns the stop, or null without the web
 * socket API.
 */
function whenUpdated(ctx: ViewContext, itemId: string, onUpdated: () => void): (() => void) | null {
  const client = ctx.client;
  if (typeof client.subscribe !== 'function') return null;
  let off: unknown;
  const stop = (): void => {
    clearTimeout(timer);
    if (typeof off === 'function') (off as () => void)();
    off = undefined;
  };
  const timer = setTimeout(stop, REFRESH_WATCH_MS);
  off = client.subscribe(['LibraryChanged'], ({ Data }) => {
    const updated = (Data as { ItemsUpdated?: string[] } | undefined)?.ItemsUpdated ?? [];
    if (!updated.includes(itemId)) return;
    stop();
    onUpdated();
  });
  if (typeof off === 'function') return stop;
  clearTimeout(timer);
  return null;
}

/**
 * Where focus goes once a deleted title's card has gone, as `from` (its card, or its ⋯ button) did with it: the card
 * after it in its list, or the one before if it was the last; with none left, the page's first control below the nav.
 * Without this a TV remote is left on the page's body, from where the next press jumps to the header. Taken before the
 * card goes, as an id: a list may reuse the card's element for its neighbour.
 */
function focusAfterDelete(from: Element | null): () => void {
  const cell = from?.closest('.lmn-card-cell');
  // A grid's card is in a list item of its own; a row's is right in the row.
  const unit = cell?.parentElement?.getAttribute('role') === 'listitem' ? cell.parentElement : cell;
  const list = unit?.parentElement;
  const units = list ? [...list.children].filter((c) => c.querySelector('[data-item-id]')) : [];
  const i = unit ? units.indexOf(unit) : -1;
  const id = (units[i + 1] ?? units[i - 1])?.querySelector('[data-item-id]')?.getAttribute('data-item-id');
  const control = from?.classList.contains('lmn-card__more') ? '.lmn-card__more' : '.lmn-card';
  return () => {
    const active = document.activeElement;
    if (!cell || (active && active !== document.body && active.isConnected)) return;
    const card = list?.isConnected
      ? [...list.querySelectorAll('[data-item-id]')].find((c) => c.getAttribute('data-item-id') === id)
      : undefined;
    const target = card
      ? (card.closest('.lmn-card-cell')!.querySelector<HTMLElement>(control) ?? (card as HTMLElement))
      : document.querySelector<HTMLElement>('.lmn-main button, .lmn-main a[href]');
    target?.focus();
  };
}

async function run(
  ctx: ViewContext,
  item: MenuItem,
  user: UserInfo,
  command: ItemCommand,
  options: ItemMenuOptions,
): Promise<void> {
  if (command === 'download') return download(ctx, item);
  if (command === 'copy-stream')
    return copyText(downloadUrl(ctx.client, item.Id)).then(
      () => showToast(itemMenuStrings.streamUrlCopied),
      () => showToast(itemMenuStrings.copyFailed),
    );
  const target = { key: item.Id, of: `Items/${item.Id}`, name: item.Name };
  if (command === 'trailerinfo') {
    const from = document.activeElement;
    return loadTrailerInfo().then(
      (module) => module.openTrailerInfoDialog(ctx, target, from),
      () => showToast(strings.itemMenuFailed),
    );
  }
  // A movie's Media info gets the Trailer section once it shows: its own file, so the dialog opens as it would without
  // (and stays as jellyfin-web has it should that file fail).
  if (command === 'moremediainfo' && item.Type === 'Movie')
    void loadTrailerInfo().then(
      (module) => module.attachToMediaInfo(ctx, target),
      () => undefined,
    );
  try {
    // What had focus as the menu closed (its button or card), for when the dialog closes: jellyfin-web puts focus back
    // only in the TV layout, and not always. (Refresh resolves once its dialog has closed: compat/itemMenu.ts.)
    const from = document.activeElement;
    // The dialog is jellyfin-web's, restyled by lumen-stock.css, which loads beside Lumen's pages without holding them
    // up (on a slow network, after them): have it in first (up to a few seconds) rather than restyle the dialog as it
    // shows.
    await whenStockCss();
    const opening = openItemDialog(item, user, command);
    if (command === 'moremediainfo') opening.then(settleMediaInfo, settleMediaInfo);
    const result = await opening;
    if ((!document.activeElement || document.activeElement === document.body) && from instanceof HTMLElement)
      from.focus({ preventScroll: true });
    if (result.deleted) {
      const refocus = focusAfterDelete(from);
      forgetItem(ctx.userId, item.Id);
      options.onDeleted?.();
      // Once the list has dropped the card.
      setTimeout(refocus);
    } else if (result.updated) options.onChanged?.();
    else if (command === 'refresh' && result.refreshQueued !== false && options.onChanged) {
      const stop = whenUpdated(ctx, item.Id, options.onChanged);
      if (stop) options.track?.(stop);
    }
  } catch (error) {
    if (!(error instanceof ItemDialogUnavailable)) return; // jellyfin-web reported the failure itself
    if (IN_METADATA_MANAGER.includes(command) && user.Policy?.IsAdministrator)
      ctx.navigate(metadataHash(item.Id));
    else if (options.fallback) options.fallback();
    else showToast(strings.itemMenuFailed);
  }
}

/** The menu's entries, grouped as COMMAND_GROUPS with a line between groups. */
export function menuEntries(
  ctx: ViewContext,
  item: MenuItem,
  user: UserInfo,
  commands: ItemCommand[],
  options: ItemMenuOptions,
): MenuEntry[] {
  const groupOf = (command: ItemCommand): number => COMMAND_GROUPS.findIndex((g) => g.includes(command));
  return commands.map((command, i) => ({
    label: LABELS[command](item),
    icon: ICONS[command],
    separated: i > 0 && groupOf(command) !== groupOf(commands[i - 1]!),
    onSelect: () => void run(ctx, item, user, command, options),
  }));
}

/**
 * Fetches what the menu needs (the full item when `item` lacks the per-user fields list endpoints leave out, and the
 * user's policy) and works out its commands. Actions Lumen couldn't carry out here are left out.
 */
export async function prepareItemMenu(
  ctx: ViewContext,
  item: BaseItem,
  options: ItemMenuOptions = {},
): Promise<PreparedMenu> {
  const [full, user] = await Promise.all([
    options.complete || 'CanDelete' in item
      ? (item as MenuItem)
      : (ctx.api.getItem(item.Id) as Promise<MenuItem>),
    currentUser(ctx),
  ]);
  const dialogs = canOpenItemDialogs();
  // jellyfin-web's own answer, where it can be asked; Lumen's port of its rules (with the layout standing in for its
  // TV and file-saving checks) otherwise.
  const stock = dialogs ? await stockItemCommands(full, user) : null;
  const commands = itemCommands(full, user.Policy ?? {}, {
    tv: ctx.layout === 'tv',
    downloadButton: options.downloadButton,
    trailerInfo: ctx.config.TrailerPreview,
  }).filter(
    (command) =>
      // Lumen's own: jellyfin-web's menu has no such command.
      command === 'trailerinfo' ||
      (stock
        ? stock.includes(command)
        : dialogs ||
          !isDialog(command) ||
          !!options.fallback ||
          (IN_METADATA_MANAGER.includes(command) && !!user.Policy?.IsAdministrator)),
  );
  return {
    item: full,
    commands,
    dialogs,
    open: (at) => {
      if (!dialogs && canOpenItemDialogs())
        return void prepareItemMenu(ctx, full, { ...options, complete: true }).then((fresh) => {
          if (fresh.commands.length) fresh.open(at);
          else {
            showToast(itemMenuStrings.noMoreActions);
            at.onClose?.();
          }
        }, at.onClose);
      openContextMenu({
        entries: menuEntries(ctx, full, user, commands, options),
        x: at.x,
        y: at.y,
        returnFocus: at.returnFocus,
        anchor: at.anchor,
        label: strings.moreActionsFor(full.Name),
        title: at.title,
        onClose: at.onClose,
      });
    },
  };
}

/** Calls `then` once jellyfin-web's item menu has loaded (checked each second, for `seconds`). Returns the stop. */
export function whenItemDialogsLoad(then: () => void, seconds = 30): () => void {
  const timer = setInterval(() => {
    const loaded = canOpenItemDialogs();
    if (loaded || --seconds <= 0) clearInterval(timer);
    if (loaded) then();
  }, 1000);
  return () => clearInterval(timer);
}

/** What a card's list wants to hear about, and where the card leads (cardMenu.ts). */
export interface CardMenuHooks {
  onDeleted?: (item: BaseItem) => void;
  /** With the item as the server now has it. */
  onChanged?: (fresh: BaseItem) => void;
  /** Opens the title's details page. */
  openDetails?: () => void;
}

/**
 * For a card's "More actions…": fetches, then shows the menu where the card's menu was (or says there's nothing).
 * Where jellyfin-web hasn't loaded its item menu (a TV browser's home: compat/registry.ts ITEM_MENU_MARKERS), it opens
 * the title's details page instead, whose stock page underneath loads it, and whose own More button has the actions.
 */
export async function openItemMenuAt(
  ctx: ViewContext,
  item: BaseItem,
  at: { x: number; y: number; returnFocus: HTMLElement | null },
  card: CardMenuHooks = {},
): Promise<void> {
  if (card.openDetails && !canOpenItemDialogs()) return card.openDetails();
  const menu = await prepareItemMenu(ctx, item, {
    onDeleted: () => card.onDeleted?.(item),
    // The card shows the title as it is now, and so do saved grids.
    onChanged: () =>
      void ctx.api.getItem(item.Id).then(
        (fresh) => {
          rememberEdit(ctx.userId, fresh);
          card.onChanged?.(fresh);
        },
        () => undefined,
      ),
  });
  if (menu.commands.length === 0) showToast(itemMenuStrings.noMoreActions);
  else menu.open({ ...at, title: menu.item.Name });
}

/** For tests. */
export function resetItemMenuUsers(): void {
  users.clear();
}
