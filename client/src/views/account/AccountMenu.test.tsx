import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import { ContextMenuHost } from '../../components/ContextMenu';
import { resetMultiServer } from '../../compat/jellyfin';
import { WEB_PLUGIN_KEY } from '../../compat/webPlugin';
import { resetSessionCaches } from '../../util/sessionCaches';
import type { ViewContext } from '../context';
import { NO_SYNCPLAY, type SyncPlayState } from '../syncplay/syncPlayState';
import { AccountMenu, HOVER_CLOSE_MS, HOVER_OPEN_MS } from './AccountMenu';

const SAM = { Id: 'user1', Name: 'Sam', Policy: { IsAdministrator: false } };
const ROOT = { Id: 'user1', Name: 'Root', Policy: { IsAdministrator: true } };

function setup({
  user = SAM,
  quickConnect = false,
  syncPlay = NO_SYNCPLAY,
  layout = 'desktop',
}: {
  user?: object;
  quickConnect?: boolean;
  syncPlay?: SyncPlayState;
  layout?: ViewContext['layout'];
} = {}) {
  const ctx = makeContext(
    createFakeClient(
      routes({ 'Users/user1': user, 'QuickConnect/Enabled': quickConnect, 'SyncPlay/List': [] }),
    ),
    { layout },
  );
  render(
    <>
      <AccountMenu ctx={ctx} syncPlay={syncPlay} current={false} />
      <ContextMenuHost />
    </>,
  );
  return { ctx, button: screen.getByRole('button', { name: /^Account/ }) };
}

/** Opens the menu with a pointer click (detail 1; 0 is what Enter/Space produce) and waits for the account. */
async function openByClick(button: HTMLElement, name = 'Sam') {
  fireEvent.click(button, { detail: 1 });
  const menu = screen.getByRole('menu', { name: 'Account' });
  await screen.findByText(name);
  return menu;
}

const names = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole('menuitem')
    .map((i) => i.textContent);

describe('AccountMenu', () => {
  beforeEach(() => {
    // No web config to read in tests: not multi-server.
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}')));
  });
  afterEach(() => {
    resetSessionCaches();
    resetMultiServer();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    for (const key of ['Dashboard', 'NativeShell', WEB_PLUGIN_KEY]) Reflect.deleteProperty(window, key);
  });

  it("is a closed menu button that shows the user's name, History, settings and sign out when opened", async () => {
    Object.assign(window, { Dashboard: { logout: vi.fn() } });
    const { button } = setup();
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();

    const menu = await openByClick(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls', menu.id);
    expect(names(menu)).toEqual(['History', 'Settings', 'Profile', 'Sign out']);
    expect(within(menu).getByRole('menuitem', { name: 'History' })).toHaveAttribute(
      'href',
      '#/home?lumen=history',
    );
    expect(within(menu).getByRole('menuitem', { name: 'Settings' })).toHaveAttribute(
      'href',
      '#/mypreferencesmenu',
    );
    expect(within(menu).getByRole('menuitem', { name: 'Profile' })).toHaveAttribute(
      'href',
      '#/userprofile?userId=user1',
    );
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Sign out' }));
    expect((window as unknown as { Dashboard: { logout: () => void } }).Dashboard.logout).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('adds the Dashboard and Metadata manager for administrators only', async () => {
    const { button } = setup({ user: ROOT });
    const menu = await openByClick(button, 'Root');
    expect(screen.getByText('Administrator')).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Dashboard' })).toHaveAttribute('href', '#/dashboard');
    expect(within(menu).getByRole('menuitem', { name: 'Metadata manager' })).toHaveAttribute(
      'href',
      '#/metadata',
    );
  });

  it('has no admin entries for other users', async () => {
    const { button } = setup();
    const menu = await openByClick(button);
    expect(within(menu).queryByRole('menuitem', { name: 'Dashboard' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Metadata manager' })).toBeNull();
    expect(screen.queryByText('Administrator')).toBeNull();
  });

  it('offers Quick Connect only when the server has it on', async () => {
    const { button } = setup({ quickConnect: true });
    const menu = await openByClick(button);
    expect(within(menu).getByRole('menuitem', { name: 'Quick Connect' })).toHaveAttribute(
      'href',
      '#/quickconnect?userId=user1',
    );
  });

  it("offers Select server when the web config allows several servers, and the app's own entries in an app", async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('{"multiserver":true}')));
    const selectServer = vi.fn();
    const exit = vi.fn();
    Object.assign(window, { Dashboard: { logout: vi.fn(), selectServer } });
    const { button } = setup();
    let menu = await openByClick(button);
    await waitFor(() => expect(names(menu)).toContain('Select server'));
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Select server' }));
    expect(selectServer).toHaveBeenCalled();

    // In an official app, it says what it supports.
    cleanup();
    resetSessionCaches();
    Object.assign(window, {
      NativeShell: {
        AppHost: { supports: (f: string) => ['exitmenu', 'clientsettings'].includes(f), exit },
        openClientSettings: vi.fn(),
      },
    });
    const app = setup();
    menu = await openByClick(app.button);
    expect(names(menu)).toEqual([
      'History',
      'Settings',
      'Profile',
      'Client settings',
      'Sign out',
      'Exit app',
    ]);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Exit app' }));
    expect(exit).toHaveBeenCalled();
  });

  it("asks jellyfin-web's appHost first, when Lumen's web plugin has it", async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    Object.assign(window, {
      Dashboard: { logout: vi.fn(), selectServer: vi.fn() },
      [WEB_PLUGIN_KEY]: { deps: { appHost: { supports: (f: string) => f === 'multiserver' } } },
    });
    const { button } = setup();
    const menu = await openByClick(button);
    await waitFor(() =>
      expect(names(menu)).toEqual(['History', 'Settings', 'Profile', 'Select server', 'Sign out']),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('opens Watch together from the menu, and the button says when the user is in a group', async () => {
    const syncPlay: SyncPlayState = { ...NO_SYNCPLAY, available: true, canCreate: true, self: 'Sam' };
    const { button } = setup({ syncPlay });
    const menu = await openByClick(button);
    const item = within(menu).getByRole('menuitem', { name: 'Watch together' });
    expect(item).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(item);
    expect(await screen.findByRole('menu', { name: 'Watch together' })).toBeInTheDocument();
    expect(screen.queryByRole('menu', { name: 'Account' })).toBeNull();

    cleanup();
    resetSessionCaches();
    const group = { GroupId: 'g', GroupName: "Sam's group", Participants: ['Sam'] };
    setup({ syncPlay: { ...syncPlay, group } });
    expect(screen.getByRole('button', { name: "Account: In Sam's group" })).toBeInTheDocument();
  });

  describe('keyboard', () => {
    it('opens on Enter with the first item focused; arrows, Home and End move; Escape closes back to the button', async () => {
      const { button } = setup({ user: ROOT });
      button.focus();
      fireEvent.click(button, { detail: 0 }); // what Enter or Space on a button sends
      const menu = screen.getByRole('menu', { name: 'Account' });
      await screen.findByText('Root');
      const items = within(menu).getAllByRole('menuitem');
      expect(items[0]).toHaveFocus();

      fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
      expect(items[1]).toHaveFocus();
      fireEvent.keyDown(document.activeElement!, { key: 'End' });
      expect(items[items.length - 1]).toHaveFocus();
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' }); // wraps
      expect(items[0]).toHaveFocus();
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
      expect(items[items.length - 1]).toHaveFocus();
      fireEvent.keyDown(document.activeElement!, { key: 'Home' });
      expect(items[0]).toHaveFocus();

      const escape = fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
      expect(escape).toBe(false); // jellyfin-web doesn't also go back a page
      expect(screen.queryByRole('menu')).toBeNull();
      expect(button).toHaveFocus();
      expect(button).toHaveAttribute('aria-expanded', 'false');
    });

    it('opens on Down (and on Up at the last item) from the button', async () => {
      const { button } = setup();
      fireEvent.keyDown(button, { key: 'ArrowDown' });
      await screen.findByText('Sam');
      expect(within(screen.getByRole('menu')).getAllByRole('menuitem')[0]).toHaveFocus();
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });

      fireEvent.keyDown(button, { key: 'ArrowUp' });
      const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
      expect(items[items.length - 1]).toHaveFocus();
    });

    it("leaves Down to the TV's D-pad navigation; OK opens it there", async () => {
      const { button } = setup({ layout: 'tv' });
      fireEvent.keyDown(button, { key: 'ArrowDown' });
      expect(screen.queryByRole('menu')).toBeNull();
      fireEvent.click(button, { detail: 0 });
      await screen.findByText('Sam');
      expect(within(screen.getByRole('menu')).getAllByRole('menuitem')[0]).toHaveFocus();
    });

    it("closes on a remote's Back", async () => {
      const { button } = setup();
      fireEvent.click(button, { detail: 0 });
      await screen.findByText('Sam');
      fireEvent.keyDown(document.activeElement!, { key: 'GoBack', keyCode: 461 });
      expect(screen.queryByRole('menu')).toBeNull();
      expect(button).toHaveFocus();
    });

    it('chooses with Enter or Space, and closes on Tab', async () => {
      const { button } = setup();
      fireEvent.click(button, { detail: 0 });
      await screen.findByText('Sam');
      const history = within(screen.getByRole('menu')).getByRole('menuitem', { name: 'History' });
      const followed = vi.fn((e: Event) => e.preventDefault());
      history.addEventListener('click', followed);
      fireEvent.keyDown(history, { key: ' ' });
      expect(followed).toHaveBeenCalled();
      expect(screen.queryByRole('menu')).toBeNull();

      fireEvent.click(button, { detail: 0 });
      fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
      expect(screen.queryByRole('menu')).toBeNull();
    });
  });

  describe('pointer', () => {
    it('a mouse opens it by hovering, after a moment, and it closes a moment after the mouse leaves', async () => {
      vi.useFakeTimers();
      const { button } = setup();
      const root = button.parentElement!;
      fireEvent.pointerEnter(root, { pointerType: 'mouse' });
      act(() => void vi.advanceTimersByTime(HOVER_OPEN_MS - 10));
      expect(screen.queryByRole('menu')).toBeNull(); // just passing over it
      act(() => void vi.advanceTimersByTime(20));
      expect(screen.getByRole('menu', { name: 'Account' })).toBeInTheDocument();
      // Hovering doesn't take focus from where it is.
      expect(document.activeElement).toBe(document.body);

      // Leaving and coming back (crossing the gap to the menu) keeps it open.
      fireEvent.pointerLeave(root, { pointerType: 'mouse' });
      act(() => void vi.advanceTimersByTime(HOVER_CLOSE_MS - 50));
      fireEvent.pointerEnter(root, { pointerType: 'mouse' });
      act(() => void vi.advanceTimersByTime(HOVER_CLOSE_MS * 2));
      expect(screen.getByRole('menu')).toBeInTheDocument();

      fireEvent.pointerLeave(root, { pointerType: 'mouse' });
      act(() => void vi.advanceTimersByTime(HOVER_CLOSE_MS - 10));
      expect(screen.getByRole('menu')).toBeInTheDocument();
      act(() => void vi.advanceTimersByTime(20));
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('stays open when a key is pressed in it after the mouse left', () => {
      vi.useFakeTimers();
      const { button } = setup();
      const root = button.parentElement!;
      fireEvent.pointerEnter(root, { pointerType: 'mouse' });
      act(() => void vi.advanceTimersByTime(HOVER_OPEN_MS + 10));
      fireEvent.pointerLeave(root, { pointerType: 'mouse' });
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
      act(() => void vi.advanceTimersByTime(HOVER_CLOSE_MS * 2));
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('a quick pass over the button never opens it', () => {
      vi.useFakeTimers();
      const { button } = setup();
      fireEvent.pointerEnter(button.parentElement!, { pointerType: 'mouse' });
      act(() => void vi.advanceTimersByTime(HOVER_OPEN_MS / 2));
      fireEvent.pointerLeave(button.parentElement!, { pointerType: 'mouse' });
      act(() => void vi.advanceTimersByTime(HOVER_OPEN_MS * 4));
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it("clicking while it's open from hovering keeps it open after the mouse leaves; clicking again closes it", () => {
      vi.useFakeTimers();
      const { button } = setup();
      const root = button.parentElement!;
      fireEvent.pointerEnter(root, { pointerType: 'mouse' });
      act(() => void vi.advanceTimersByTime(HOVER_OPEN_MS + 10));
      fireEvent.click(button, { detail: 1 });
      fireEvent.pointerLeave(root, { pointerType: 'mouse' });
      act(() => void vi.advanceTimersByTime(HOVER_CLOSE_MS * 2));
      expect(screen.getByRole('menu')).toBeInTheDocument();

      fireEvent.click(button, { detail: 1 });
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it("touch doesn't hover: a tap opens it, and a tap outside closes it", () => {
      vi.useFakeTimers();
      const { button } = setup();
      fireEvent.pointerEnter(button.parentElement!, { pointerType: 'touch' });
      act(() => void vi.advanceTimersByTime(HOVER_OPEN_MS * 2));
      expect(screen.queryByRole('menu')).toBeNull();

      fireEvent.click(button, { detail: 1 });
      expect(screen.getByRole('menu')).toBeInTheDocument();
      fireEvent.pointerDown(document.body);
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('closes when the page changes', () => {
      const { button } = setup();
      fireEvent.click(button, { detail: 1 });
      expect(screen.getByRole('menu')).toBeInTheDocument();
      act(() => {
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
      expect(screen.queryByRole('menu')).toBeNull();
    });
  });
});
