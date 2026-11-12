import { Fragment } from 'preact';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import {
  appActions,
  HISTORY_HASH,
  isBackKey,
  PREFERENCES_HASH,
  selectServer,
  SETTINGS_HASHES,
  signOut,
} from '../../compat/jellyfin';
import { Icon, type IconName } from '../../components/icons';
import { onNavigate } from '../../takeover/navigation';
import { routeEnabled } from '../../takeover/takeover';
import { strings } from '../../strings';
import type { ViewContext } from '../context';
import { initials } from '../details/CastRow';
import type { SyncPlayState } from '../syncplay/syncPlayState';
import { openWatchTogether } from '../secondary/lazySecondary';
import { type Account, accountAccess, avatarUrl, loadAccount } from './account';

/**
 * Hovering opens the menu after a moment (so passing over the button on the way elsewhere doesn't), and leaving it
 * closes it after a moment (so the pointer can cross the gap between button and menu, or stray off the edge).
 */
export const HOVER_OPEN_MS = 150;
export const HOVER_CLOSE_MS = 300;

/** The avatar's CSS size in the menu's header. */
const AVATAR_PX = 40;

interface Item {
  key: string;
  label: string;
  icon: IconName;
  /** A link (it can open in a new tab), or an action. */
  href?: string;
  onSelect?: () => void;
  detail?: string;
  /** It opens a menu of its own (Watch together). */
  popup?: boolean;
}

/** The menu's entries, in groups (separated by lines): jellyfin-web's user menu, plus History and Watch together. */
export function accountItems(
  ctx: ViewContext,
  account: Account | null,
  syncPlay: SyncPlayState,
  onWatchTogether: () => void,
  win: Window = window,
): Item[][] {
  const access = accountAccess(account, win);
  const mine: Item[] = [];
  // Its link rides on home: where Lumen doesn't draw History, it would open jellyfin-web's home instead.
  if (routeEnabled('history', ctx.config))
    mine.push({ key: 'history', label: strings.history, icon: 'history', href: HISTORY_HASH });
  if (syncPlay.available)
    mine.push({
      key: 'watchTogether',
      label: strings.watchTogether,
      icon: 'watchTogether',
      detail: syncPlay.group ? strings.inGroup(syncPlay.group.GroupName) : undefined,
      onSelect: onWatchTogether,
      popup: true,
    });

  const settings: Item[] = [
    { key: 'settings', label: strings.settingsMenu, icon: 'settings', href: PREFERENCES_HASH },
    {
      key: 'profile',
      label: strings.settings.profile[0],
      icon: 'user',
      href: SETTINGS_HASHES.profile(ctx.userId),
    },
  ];
  if (access.quickConnect)
    settings.push({
      key: 'quickConnect',
      label: strings.settings.quickConnect[0],
      icon: 'key',
      href: SETTINGS_HASHES.quickConnect(ctx.userId),
    });
  if (access.clientSettings)
    settings.push({
      key: 'clientSettings',
      label: strings.clientSettings,
      icon: 'display',
      onSelect: () => appActions.clientSettings(win),
    });
  if (access.downloadManager)
    settings.push({
      key: 'downloadManager',
      label: strings.downloadManager,
      icon: 'download',
      onSelect: () => appActions.downloadManager(win),
    });

  const admin: Item[] = access.admin
    ? [
        {
          key: 'dashboard',
          label: strings.settings.dashboard[0],
          icon: 'shield',
          href: SETTINGS_HASHES.dashboard(),
        },
        {
          key: 'metadata',
          label: strings.settings.metadata[0],
          icon: 'edit',
          href: SETTINGS_HASHES.metadata(),
        },
      ]
    : [];

  const session: Item[] = [];
  if (access.selectServer)
    session.push({
      key: 'selectServer',
      label: strings.selectServer,
      icon: 'server',
      onSelect: () => selectServer(win),
    });
  if (access.signOut)
    session.push({ key: 'signOut', label: strings.signOut, icon: 'logout', onSelect: () => signOut(win) });
  if (access.exitApp)
    session.push({
      key: 'exitApp',
      label: strings.exitApp,
      icon: 'close',
      onSelect: () => appActions.exit(win),
    });

  return [mine, settings, admin, session].filter((group) => group.length > 0);
}

/** How the menu was opened: by hovering (closes when the pointer leaves), or on purpose (stays until dismissed). */
type OpenMode = 'hover' | 'pinned';
/** Where focus goes as the menu opens: the first or last item (keyboard), the menu itself (pointer), or nowhere. */
type InitialFocus = 'first' | 'last' | 'menu' | null;

/**
 * The nav's account button and its menu (a menu button): who's signed in, History, Watch together, the settings and
 * admin pages, and Sign out. A mouse opens it by hovering; a click, tap, Enter or the remote's OK opens it too (hover
 * is never the only way), and so does Down on a keyboard. Up/Down/Home/End move, Enter or Space choose, Escape or
 * Back close it and return to the button, Tab closes it and moves on.
 */
export function AccountMenu({
  ctx,
  syncPlay,
  current,
}: {
  ctx: ViewContext;
  syncPlay: SyncPlayState;
  /** One of its pages is showing (the settings menu, a settings page, History). */
  current: boolean;
}) {
  const [account, setAccount] = useState<Account | null>(null);
  const [open, setOpen] = useState<OpenMode | null>(null);
  const [initialFocus, setInitialFocus] = useState<InitialFocus>(null);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const id = useId();

  // Loaded with the nav, so the menu opens complete (admin entries, Quick Connect) instead of growing as it opens.
  useEffect(() => {
    let cancelled = false;
    loadAccount(ctx).then(
      (a) => !cancelled && setAccount(a),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [ctx.userId]);

  const clearTimer = (): void => window.clearTimeout(timer.current);
  useEffect(() => clearTimer, []);

  const show = (mode: OpenMode, focus: InitialFocus): void => {
    clearTimer();
    setActive(-1);
    setInitialFocus(focus);
    setOpen(mode);
  };
  const close = (refocus: boolean): void => {
    clearTimer();
    if (refocus) button.current?.focus({ preventScroll: true });
    setOpen(null);
  };

  const items = accountItems(ctx, account, syncPlay, () => {
    close(true);
    if (button.current) void openWatchTogether(ctx, syncPlay, button.current);
  });
  const flat = ([] as Item[]).concat(...items);
  const itemEls = (): HTMLElement[] =>
    Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  const focusItem = (index: number): void => {
    const els = itemEls();
    if (els.length === 0) return;
    const i = (index + els.length) % els.length;
    els[i]!.focus({ preventScroll: true });
    setActive(i);
  };

  useLayoutEffect(() => {
    if (!open || !initialFocus) return;
    if (initialFocus === 'menu') menu.current?.focus({ preventScroll: true });
    else focusItem(initialFocus === 'first' ? 0 : -1);
    setInitialFocus(null);
  }, [open, initialFocus]);

  // While open: Escape/Back close it wherever focus is (a hover-opened menu doesn't have it); a press outside closes
  // it; so does leaving the page.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (!isBackKey(e)) return;
      // Don't let jellyfin-web also go back a page.
      e.preventDefault();
      e.stopPropagation();
      close(!!root.current?.contains(document.activeElement));
    };
    const onPointer = (e: PointerEvent): void => {
      if (!root.current?.contains(e.target as Node)) close(false);
    };
    const onLeave = (): void => close(false);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('blur', onLeave);
    // jellyfin-web's pushState as well as a hash change (a remote's Home key, a "go home" from another device).
    const stopNavigation = onNavigate(onLeave);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('blur', onLeave);
      stopNavigation();
    };
  }, [open]);

  // Hover: only a mouse (touch and pens send pointer events too, then a click, which opens it on purpose).
  const onPointerEnter = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse') return;
    clearTimer();
    if (!open) timer.current = window.setTimeout(() => show('hover', null), HOVER_OPEN_MS);
  };
  const onPointerLeave = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse') return;
    clearTimer();
    // Only a menu still open from hovering: pressing a key in it meanwhile keeps it.
    if (open === 'hover')
      timer.current = window.setTimeout(() => setOpen((o) => (o === 'hover' ? null : o)), HOVER_CLOSE_MS);
  };

  const choose = (index: number): void => {
    // A link navigates (leaving the page closes the menu); click() follows it like a real click would.
    itemEls()[index]?.click();
  };

  const onMenuKey = (e: KeyboardEvent): void => {
    const last = flat.length - 1;
    const keys: Record<string, () => void> = {
      ArrowDown: () => focusItem(active >= last ? 0 : active + 1),
      ArrowUp: () => focusItem(active <= 0 ? last : active - 1),
      Home: () => focusItem(0),
      End: () => focusItem(last),
      Enter: () => active >= 0 && choose(active),
      ' ': () => active >= 0 && choose(active),
      // Nothing beside the items: kept here, or jellyfin-web's D-pad navigation would move focus out (to the nav's
      // links) and leave the menu open behind it.
      ArrowLeft: () => undefined,
      ArrowRight: () => undefined,
    };
    if (e.key === 'Tab') {
      // Focus moves on as usual (the menu is still there for the browser to step past), and the menu closes.
      close(false);
      return;
    }
    const action = keys[e.key];
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    if (open === 'hover') setOpen('pinned'); // using the keyboard in it: keep it open whatever the pointer does
    action();
  };

  const user = account?.user;
  const avatar = user ? avatarUrl(ctx, user, AVATAR_PX) : null;
  const group = syncPlay.group?.GroupName;

  return (
    <div
      ref={root}
      class={`lmn-account${open ? ' is-open' : ''}`}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onFocusOut={(e) => {
        // Focus went somewhere else on the page (a click, a remote's key Lumen doesn't handle): the menu goes too.
        // Not on a window blur (no relatedTarget), which closes it anyway; nor while the pointer still hovers it.
        const to = e.relatedTarget as Node | null;
        if (open && to && !root.current?.contains(to)) close(false);
      }}
    >
      <button
        ref={button}
        type="button"
        class={`lmn-nav__item lmn-nav__item--icon${current ? ' is-active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={!!open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-label={group ? strings.accountInGroup(group) : strings.account}
        onClick={(e) => {
          // detail is 0 for a click made by Enter or Space (and a remote's OK).
          const keyboard = e.detail === 0;
          if (open === 'pinned') close(true);
          else if (open === 'hover' && !keyboard) setOpen('pinned');
          else show('pinned', keyboard ? 'first' : 'menu');
        }}
        onKeyDown={(e) => {
          // Down opens it from a keyboard; on a TV Down leaves the nav for the page (OK opens it there).
          if (ctx.layout === 'tv') return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            if (open) {
              setOpen('pinned');
              focusItem(e.key === 'ArrowDown' ? 0 : -1);
            } else show('pinned', e.key === 'ArrowDown' ? 'first' : 'last');
          }
        }}
      >
        <Icon name="user" size={20} />
        {group && <span class="lmn-account__badge" aria-hidden="true" />}
      </button>
      {open && (
        <div class="lmn-menu lmn-account__panel">
          <div class="lmn-account__header">
            <span class="lmn-account__avatar" aria-hidden="true">
              {avatar ? (
                <img src={avatar} alt="" />
              ) : user ? (
                initials(user.Name)
              ) : (
                <Icon name="user" size={22} />
              )}
            </span>
            <span class="lmn-menu__text">
              <span class="lmn-menu__title">{user?.Name ?? ' '}</span>
              {user?.Policy?.IsAdministrator && (
                <span class="lmn-menu__subtitle">{strings.administrator}</span>
              )}
            </span>
          </div>
          <div
            ref={menu}
            id={`${id}-menu`}
            class="lmn-account__menu"
            role="menu"
            aria-label={strings.account}
            tabIndex={-1}
            onKeyDown={onMenuKey}
          >
            {items.map((group, g) => (
              <Fragment key={group[0]!.key}>
                {g > 0 && <div class="lmn-menu__separator" role="separator" />}
                {group.map((item) => {
                  const index = flat.indexOf(item);
                  const props = {
                    role: 'menuitem' as const,
                    tabIndex: -1,
                    class: `lmn-menu__item${item.detail ? ' lmn-menu__item--tall' : ''}${index === active ? ' is-active' : ''}`,
                    onFocus: () => setActive(index),
                    'aria-haspopup': item.popup ? ('menu' as const) : undefined,
                  };
                  const content = (
                    <>
                      <Icon name={item.icon} size={18} />
                      {item.detail ? (
                        <span class="lmn-menu__text">
                          {item.label}
                          <span class="lmn-menu__detail">{item.detail}</span>
                        </span>
                      ) : (
                        item.label
                      )}
                    </>
                  );
                  return item.href ? (
                    <a key={item.key} {...props} href={item.href} onClick={() => close(false)}>
                      {content}
                    </a>
                  ) : (
                    <button
                      key={item.key}
                      {...props}
                      type="button"
                      onClick={() => {
                        close(false);
                        item.onSelect?.();
                      }}
                    >
                      {content}
                    </button>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
