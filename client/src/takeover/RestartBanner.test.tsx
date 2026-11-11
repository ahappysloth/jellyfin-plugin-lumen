import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JellyfinApiClient } from '../compat/jellyfin';
import {
  BANNER_ID,
  confirmText,
  describeRestart,
  hideRestartBanner,
  pluginChanges,
  RestartBanner,
  SHOWN_CLASS,
  showRestartBanner,
} from './RestartBanner';

function fakeClient(routes: Record<string, (request: { type: string }) => unknown>) {
  const ajax = vi.fn(async (request: { type: string; url: string }) => {
    const route = routes[request.url];
    if (!route) throw new Error(`unexpected ${request.url}`);
    return route(request);
  });
  const client = {
    getCurrentUserId: () => 'u1',
    accessToken: () => 't',
    deviceId: () => 'd',
    getUrl: (path: string) => path,
    ajax,
  } as unknown as JellyfinApiClient;
  return { client, ajax };
}

describe('what the banner says', () => {
  it('names the plugins a restart finishes installing, updating and removing', () => {
    const plugins = [
      { Name: 'TMDb', Id: 'a', Version: '12.4.0.0', Status: 'Active' },
      { Name: 'Webhook', Id: 'b', Version: '22.0.0.0', Status: 'Restart' },
      { Name: 'Lumen', Id: 'c', Version: '0.3.8.0', Status: 'Restart' },
      { Name: 'Lumen', Id: 'c', Version: '0.3.7.0', Status: 'Superseded' },
      { Name: 'Trakt', Id: 'd', Version: '33.0.0.0', Status: 'Deleted' },
    ];
    const changes = pluginChanges(plugins, ['Session Cleaner', 'TMDb']);
    expect(changes).toEqual([
      { name: 'Webhook', kind: 'install' },
      { name: 'Lumen', kind: 'update' },
      { name: 'Trakt', kind: 'remove' },
      { name: 'Session Cleaner', kind: 'remove' },
    ]);
    expect(describeRestart(changes)).toBe('Restart Jellyfin to finish 4 plugin changes.');
    expect(describeRestart(changes.slice(0, 3))).toBe(
      'Restart Jellyfin to finish installing Webhook, updating Lumen and removing Trakt.',
    );
  });

  it.each([
    [[{ name: 'Webhook', kind: 'install' }], 'Restart Jellyfin to finish installing Webhook.'],
    [[{ name: 'Lumen', kind: 'update' }], 'Restart Jellyfin to finish updating Lumen.'],
    [
      [
        { name: 'A', kind: 'remove' },
        { name: 'B', kind: 'remove' },
      ],
      'Restart Jellyfin to finish removing A and B.',
    ],
    [
      ['A', 'B', 'C', 'D'].map((name) => ({ name, kind: 'install' })),
      'Restart Jellyfin to finish installing 4 plugins.',
    ],
    [[], 'Jellyfin needs a restart to apply changes.'],
  ] as const)('%j', (changes, text) => {
    expect(describeRestart([...changes])).toBe(text);
  });

  it('says how many devices a restart interrupts, when it can tell', () => {
    expect(confirmText(null)).toBe('Restart Jellyfin now? Anyone watching is disconnected for a moment.');
    expect(confirmText(0)).toBe('Restart Jellyfin now? Nothing is playing right now.');
    expect(confirmText(1)).toBe('Restart Jellyfin now? Playback stops for a moment on 1 device.');
    expect(confirmText(3)).toBe('Restart Jellyfin now? Playback stops for a moment on 3 devices.');
  });
});

describe('the restart banner', () => {
  const props = (client: JellyfinApiClient) => ({
    client,
    message: 'Restart Jellyfin to finish installing Webhook.',
    onDismiss: vi.fn(),
    onLayout: vi.fn(),
    onRestarting: vi.fn(),
    announce: vi.fn(),
    reload: vi.fn(),
    pollMs: 1,
    timeoutMs: 2000,
  });

  it('asks once more, restarts Jellyfin, waits for it and reloads the page', async () => {
    let state = 0;
    const { client, ajax } = fakeClient({
      Sessions: () => [{ NowPlayingItem: { Id: '1' } }, {}, { NowPlayingItem: { Id: '2' } }],
      'System/Restart': () => undefined,
      // Still up for a moment, then down, then back.
      'System/Info': () => {
        state++;
        if (state === 2) throw new Error('down');
        return { HasPendingRestart: state === 1 };
      },
    });
    const p = props(client);
    render(<RestartBanner {...p} />);
    expect(screen.getByRole('region', { name: 'Restart needed' })).toHaveTextContent(p.message);
    expect(p.announce).toHaveBeenCalledWith(p.message);

    const restart = screen.getByRole('button', { name: 'Restart Jellyfin' });
    restart.focus();
    fireEvent.click(restart);
    expect(await screen.findByText(confirmText(2))).toBeInTheDocument();
    const now = screen.getByRole('button', { name: 'Restart now' });
    // Focus follows from the button it replaced.
    expect(now).toHaveFocus();
    expect(ajax).not.toHaveBeenCalledWith(expect.objectContaining({ url: 'System/Restart' }));

    fireEvent.click(now);
    expect(
      await screen.findByText("Restarting Jellyfin… this page reloads when it's back."),
    ).toBeInTheDocument();
    expect(p.onRestarting).toHaveBeenCalledWith(true);
    expect(ajax).toHaveBeenCalledWith(expect.objectContaining({ type: 'POST', url: 'System/Restart' }));
    await waitFor(() => expect(p.reload).toHaveBeenCalled());
    expect(screen.getByText('Jellyfin is back. Reloading…')).toBeInTheDocument();
  });

  it('cancels back to Restart Jellyfin', async () => {
    const { client } = fakeClient({ Sessions: () => [] });
    render(<RestartBanner {...props(client)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Restart Jellyfin' }));
    expect(await screen.findByText(confirmText(0))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Restart Jellyfin' })).toBeInTheDocument();
  });

  it("says so when Jellyfin won't restart, and lets the admin try again", async () => {
    const { client } = fakeClient({
      Sessions: () => {
        throw new Error('no');
      },
      'System/Restart': () => {
        throw new Error('403');
      },
    });
    const p = props(client);
    render(<RestartBanner {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Restart Jellyfin' }));
    expect(await screen.findByText(confirmText(null))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    expect(await screen.findByText("Couldn't restart Jellyfin. Try again in a moment.")).toBeInTheDocument();
    expect(p.onRestarting).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('button', { name: 'Restart Jellyfin' })).toBeInTheDocument();
    expect(p.reload).not.toHaveBeenCalled();
  });

  it('can be dismissed', () => {
    const { client } = fakeClient({});
    const p = props(client);
    render(<RestartBanner {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(p.onDismiss).toHaveBeenCalled();
  });
});

describe('showing and hiding the banner', () => {
  afterEach(() => {
    hideRestartBanner(document, true);
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  const show = (client: JellyfinApiClient, removed: string[] = [], onDismiss = vi.fn()) =>
    showRestartBanner({ doc: document, win: window, client, removed, onDismiss });

  it('goes first in the page, says why, and makes room for itself', async () => {
    document.body.innerHTML = '<div id="reactRoot"><header class="MuiAppBar-root"></header></div>';
    const { client } = fakeClient({ Plugins: () => [{ Name: 'Webhook', Id: 'b', Status: 'Restart' }] });
    await show(client);
    const banner = document.getElementById(BANNER_ID)!;
    expect(document.body.firstElementChild).toBe(banner);
    expect(banner).toHaveTextContent('Restart Jellyfin to finish installing Webhook.');
    expect(document.documentElement).toHaveClass(SHOWN_CLASS);
    expect(document.documentElement.style.getPropertyValue('--lmn-restart-space')).toMatch(/px$/);
    // The polite live region was in the page first; it says the message a moment later.
    const live = document.getElementById('lmn-restart-live')!;
    expect(live).toHaveAttribute('aria-live', 'polite');
    await waitFor(() => expect(live).toHaveTextContent('Restart Jellyfin to finish installing Webhook.'));
  });

  it('says it generically when it can’t tell why', async () => {
    const { client } = fakeClient({});
    await show(client, ['Trakt']);
    expect(document.getElementById(BANNER_ID)).toHaveTextContent(
      'Restart Jellyfin to finish removing Trakt.',
    );
    hideRestartBanner(document, true);
    await show(client);
    expect(document.getElementById(BANNER_ID)).toHaveTextContent(
      'Jellyfin needs a restart to apply changes.',
    );
  });

  it('slides away when hidden, and a later show brings it back', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { client } = fakeClient({ Plugins: () => [] });
    await show(client);
    hideRestartBanner(document);
    expect(document.documentElement).not.toHaveClass(SHOWN_CLASS);
    expect(document.getElementById(BANNER_ID)).not.toBeNull(); // still sliding
    vi.advanceTimersByTime(300);
    expect(document.getElementById(BANNER_ID)).toBeNull();
  });

  it("doesn't show if hidden while it was still finding out why", async () => {
    let answer: (v: unknown) => void = () => undefined;
    const { client, ajax } = fakeClient({});
    ajax.mockImplementation(() => new Promise((r) => (answer = r)));
    const shown = show(client);
    hideRestartBanner(document);
    answer([]);
    await shown;
    expect(document.getElementById(BANNER_ID)).toBeNull();
  });

  it('stays while Jellyfin restarts, unless the page leaves the admin pages', async () => {
    const { client } = fakeClient({
      Plugins: () => [],
      Sessions: () => [],
      'System/Restart': () => undefined,
      'System/Info': () => new Promise(() => undefined),
    });
    await show(client);
    fireEvent.click(screen.getByRole('button', { name: 'Restart Jellyfin' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restart now' }));
    await screen.findByText(/Restarting Jellyfin/);
    hideRestartBanner(document);
    expect(document.documentElement).toHaveClass(SHOWN_CLASS);
    hideRestartBanner(document, true);
    expect(document.documentElement).not.toHaveClass(SHOWN_CLASS);
  });

  it('dismisses: tells the watch, and slides away', async () => {
    const { client } = fakeClient({ Plugins: () => [] });
    const onDismiss = vi.fn();
    await show(client, [], onDismiss);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalled();
    expect(document.documentElement).not.toHaveClass(SHOWN_CLASS);
  });
});
