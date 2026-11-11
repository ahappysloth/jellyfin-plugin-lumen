import { render } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { restartServer, serverState, waitForRestart } from '../admin/restart';
import { Icon } from '../components/icons';
import type { JellyfinApiClient } from '../compat/jellyfin';
import { STOCK_SELECTORS } from '../compat/registry';
import { withTimeout } from '../util/withTimeout';

/**
 * The restart banner on jellyfin-web's admin pages (restartWatch.ts decides when): it slides down from under the app
 * bar and stays at the top of the content while the page scrolls, with Restart Jellyfin in it. A restart stops
 * everyone's playback, so Restart asks once more inline, with how many devices are playing; then the banner waits for
 * Jellyfin to come back and reloads the page, like Lumen's own Updates card (admin/restart.ts). Its own chunk: it loads
 * only when a restart is pending. Styled by dashboard.css, which is only on the page with Lumen's admin look.
 */

export const BANNER_ID = 'lmn-restart';
const LIVE_ID = 'lmn-restart-live';
/** On <html> while the banner shows: dashboard.css makes room for it and hides jellyfin-web's own restart notice. */
export const SHOWN_CLASS = 'lmn-restart-shown';
const SPACE_PROPERTY = '--lmn-restart-space';
const IN_CLASS = 'lmn-restart--in';
/** Matches the slide in dashboard.css. */
const SLIDE_MS = 250;
/** The gap under the app bar, and so the room the page makes beyond the banner's height. */
const GAP_PX = 8;
const DETAILS_TIMEOUT_MS = 5000;
/**
 * "Restart now" takes the place of "Restart Jellyfin", so the second click of a double-click, a repeated Enter or a
 * remote's OK pressed twice would land on it: clicks this soon after the question appears are ignored.
 */
const CONFIRM_GUARD_MS = 500;

export interface PluginChange {
  name: string;
  kind: 'install' | 'update' | 'remove';
}

interface PluginInfo {
  Name?: string;
  Id?: string;
  Version?: string;
  Status?: string;
}

/**
 * What the pending restart is for, from GET /Plugins: a plugin waiting for a restart (Status "Restart") is new, or an
 * update when another version of it is listed too; one marked "Deleted" is being removed, as is one uninstalled while
 * the page was open (Jellyfin 12.4 drops those from the list at once).
 */
export function pluginChanges(plugins: PluginInfo[], removed: string[]): PluginChange[] {
  const changes: PluginChange[] = [];
  const add = (name: string | undefined, kind: PluginChange['kind']): void => {
    if (name && !changes.some((c) => c.name === name)) changes.push({ name, kind });
  };
  for (const p of plugins) {
    if (p.Status === 'Restart') {
      // Another version of it listed too (12.4 may list the new one twice, so a different version, not just another entry).
      add(p.Name, plugins.some((o) => o.Id === p.Id && o.Version !== p.Version) ? 'update' : 'install');
    } else if (p.Status === 'Deleted') {
      add(p.Name, 'remove');
    }
  }
  const listed = plugins.filter((p) => p.Status !== 'Deleted').map((p) => p.Name);
  for (const name of removed) if (!listed.includes(name)) add(name, 'remove');
  return changes;
}

const VERBS: Record<PluginChange['kind'], string> = {
  install: 'installing',
  update: 'updating',
  remove: 'removing',
};

const list = (items: string[]): string =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/** "Restart Jellyfin to finish installing Webhook and removing Trakt." */
export function describeRestart(changes: PluginChange[]): string {
  if (changes.length === 0) return 'Jellyfin needs a restart to apply changes.';
  const kinds = (['install', 'update', 'remove'] as const).filter((k) => changes.some((c) => c.kind === k));
  if (changes.length > 3) {
    return kinds.length === 1
      ? `Restart Jellyfin to finish ${VERBS[kinds[0]!]} ${changes.length} plugins.`
      : `Restart Jellyfin to finish ${changes.length} plugin changes.`;
  }
  const parts = kinds.map(
    (k) => `${VERBS[k]} ${list(changes.filter((c) => c.kind === k).map((c) => c.name))}`,
  );
  return `Restart Jellyfin to finish ${list(parts)}.`;
}

/** "Restart Jellyfin now? …" for the inline confirmation; null playing = couldn't tell. */
export function confirmText(playing: number | null): string {
  const detail =
    playing === null
      ? 'Anyone watching is disconnected for a moment.'
      : playing === 0
        ? 'Nothing is playing right now.'
        : `Playback stops for a moment on ${playing} ${playing === 1 ? 'device' : 'devices'}.`;
  return `Restart Jellyfin now? ${detail}`;
}

async function playingCount(client: JellyfinApiClient): Promise<number | null> {
  try {
    const sessions = (await withTimeout(
      client.ajax({
        type: 'GET',
        url: client.getUrl('Sessions', { activeWithinSeconds: 960 }),
        dataType: 'json',
      }) as Promise<{ NowPlayingItem?: unknown }[]>,
      DETAILS_TIMEOUT_MS,
    )) as { NowPlayingItem?: unknown }[];
    return Array.isArray(sessions) ? sessions.filter((s) => s?.NowPlayingItem).length : null;
  } catch {
    return null;
  }
}

type Step =
  | { kind: 'pending' }
  | { kind: 'confirm'; playing: number | null }
  | { kind: 'restarting'; back: boolean }
  | { kind: 'failed'; message: string };

export interface BannerProps {
  client: JellyfinApiClient;
  message: string;
  onDismiss: () => void;
  /** After every render: the banner's height may have changed. */
  onLayout: () => void;
  onRestarting: (restarting: boolean) => void;
  announce: (text: string) => void;
  reload: () => void;
  /** For tests: how often and how long to wait for Jellyfin to come back. */
  pollMs?: number;
  timeoutMs?: number;
}

export function RestartBanner({
  client,
  message,
  onDismiss,
  onLayout,
  onRestarting,
  announce,
  reload,
  pollMs,
  timeoutMs,
}: BannerProps) {
  const [step, setStep] = useState<Step>({ kind: 'pending' });
  const root = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);

  const text =
    step.kind === 'pending'
      ? message
      : step.kind === 'confirm'
        ? confirmText(step.playing)
        : step.kind === 'restarting'
          ? step.back
            ? 'Jellyfin is back. Reloading…'
            : "Restarting Jellyfin… this page reloads when it's back."
          : step.message;

  useLayoutEffect(onLayout);
  useEffect(() => announce(text), [text]);
  // The buttons change with the step: when focus was on one, it moves to the new main button rather than to the page.
  const hadFocus = useRef(false);
  hadFocus.current = !!root.current?.contains(document.activeElement);
  useEffect(() => {
    if (hadFocus.current || root.current?.contains(document.activeElement)) primary.current?.focus();
  }, [step.kind]);

  // Unmounted (the page left the admin pages, or the banner was dismissed): a restart in progress doesn't reload
  // whatever page is showing by then.
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const askedAt = useRef(0);
  // Focus was in the banner when Restart now was pressed: if the restart fails, it goes back to the main button.
  const restartFocus = useRef(false);
  useEffect(() => {
    if (step.kind === 'failed' && restartFocus.current) primary.current?.focus();
  }, [step.kind]);

  const ask = (): void => {
    askedAt.current = Date.now();
    setStep({ kind: 'confirm', playing: null });
    void playingCount(client).then((playing) =>
      setStep((s) => (s.kind === 'confirm' ? { kind: 'confirm', playing } : s)),
    );
  };
  const cancel = (): void => setStep({ kind: 'pending' });
  const restart = async (): Promise<void> => {
    if (Date.now() - askedAt.current < CONFIRM_GUARD_MS) return;
    restartFocus.current = !!root.current?.contains(document.activeElement);
    setStep({ kind: 'restarting', back: false });
    onRestarting(true);
    try {
      await restartServer(client);
    } catch {
      onRestarting(false);
      setStep({ kind: 'failed', message: "Couldn't restart Jellyfin. Try again in a moment." });
      return;
    }
    // Gone: answer "down" without asking, so the wait stops polling Jellyfin and ends with false at its deadline.
    const state = (): ReturnType<typeof serverState> =>
      alive.current ? serverState(client) : Promise.resolve({ up: false as const });
    const back = await waitForRestart({ serverState: state }, pollMs, timeoutMs);
    if (!alive.current) return;
    if (back) {
      setStep({ kind: 'restarting', back: true });
      reload();
    } else {
      onRestarting(false);
      setStep({
        kind: 'failed',
        message: "Jellyfin hasn't come back after 3 minutes. Reload this page once it's running again.",
      });
    }
  };

  const busy = step.kind === 'restarting';
  return (
    <div ref={root} class="lmn-restart__card" role="region" aria-label="Restart needed" data-step={step.kind}>
      {busy ? (
        <span class="lmn-restart__spinner" aria-hidden="true" />
      ) : (
        <Icon name="replay" size={20} class="lmn-restart__icon" />
      )}
      <p class="lmn-restart__text">{text}</p>
      {!busy && (
        <div class="lmn-restart__actions">
          {/* Keyed apart, so the confirm step gets new buttons rather than the same ones with new handlers. */}
          {step.kind === 'confirm' ? (
            <>
              <button
                key="restart-now"
                ref={primary}
                type="button"
                class="lmn-restart__btn lmn-restart__btn--primary"
                onClick={() => void restart()}
              >
                Restart now
              </button>
              <button key="cancel" type="button" class="lmn-restart__btn" onClick={cancel}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                key="restart"
                ref={primary}
                type="button"
                class="lmn-restart__btn lmn-restart__btn--primary"
                onClick={ask}
              >
                Restart Jellyfin
              </button>
              <button
                key="dismiss"
                type="button"
                class="lmn-restart__close"
                aria-label="Dismiss"
                title="Dismiss"
                onClick={onDismiss}
              >
                <Icon name="close" size={18} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Mounting: one banner per page, a fixed element first in <body> so it comes first in the tab order. ----------

let restarting = false;
/** Bumped by every show and hide, so a show still waiting for its details doesn't undo a later hide. */
let token = 0;
let removeTimer: ReturnType<typeof setTimeout> | undefined;
let detach: (() => void) | null = null;

const reducedMotion = (win: Window): boolean =>
  !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Lines the banner up with the content: under jellyfin-web's app bar and across the same width (on a desktop the app
 * bar starts after the drawer; on a phone it's the full width). Without an app bar it sits at the top of the window.
 */
function place(doc: Document, win: Window, el: HTMLElement): void {
  const bar = Array.from(doc.querySelectorAll(STOCK_SELECTORS.modernAppBar.selector))
    .map((e) => e.getBoundingClientRect())
    .find((r) => r.width > 0 && r.height > 0);
  el.classList.toggle('lmn-restart--top', !bar);
  el.style.setProperty('--lmn-restart-top', `${bar ? Math.max(0, Math.round(bar.bottom)) : 0}px`);
  el.style.setProperty('--lmn-restart-left', `${bar ? Math.max(0, Math.round(bar.left)) : 0}px`);
  el.style.setProperty(
    '--lmn-restart-right',
    `${bar ? Math.max(0, Math.round(doc.documentElement.clientWidth - bar.right)) : 0}px`,
  );
  const card = el.firstElementChild as HTMLElement | null;
  doc.documentElement.style.setProperty(SPACE_PROPERTY, `${(card?.offsetHeight ?? 0) + GAP_PX}px`);
}

function liveRegion(doc: Document): HTMLElement {
  let live = doc.getElementById(LIVE_ID);
  if (!live) {
    // Already in the page before anything is said in it, so screen readers announce what is.
    live = doc.createElement('div');
    live.id = LIVE_ID;
    live.className = 'lmn-visually-hidden';
    live.setAttribute('aria-live', 'polite');
    doc.body.appendChild(live);
  }
  return live;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

function firstFocusable(doc: Document, outside: Element): HTMLElement | undefined {
  return Array.from(doc.querySelectorAll<HTMLElement>(FOCUSABLE)).find(
    (e) => !outside.contains(e) && e.getClientRects().length > 0,
  );
}

export interface ShowOptions {
  doc: Document;
  win: Window;
  client: JellyfinApiClient;
  /** Plugins uninstalled while the page was open (restartWatch.ts hears of them on the websocket). */
  removed: string[];
  onDismiss: () => void;
}

/** Shows the banner, or updates its message; leaves it alone while it's restarting. */
export async function showRestartBanner({
  doc,
  win,
  client,
  removed,
  onDismiss,
}: ShowOptions): Promise<void> {
  if (restarting) return;
  const mine = ++token;
  const live = liveRegion(doc);
  const plugins = await withTimeout(
    client.ajax({ type: 'GET', url: client.getUrl('Plugins'), dataType: 'json' }) as Promise<PluginInfo[]>,
    DETAILS_TIMEOUT_MS,
  ).catch(() => []);
  if (mine !== token || restarting) return;
  const message = describeRestart(pluginChanges(Array.isArray(plugins) ? plugins : [], removed));

  clearTimeout(removeTimer);
  let el = doc.getElementById(BANNER_ID);
  const fresh = !el;
  if (!el) {
    el = doc.createElement('div');
    el.id = BANNER_ID;
    el.className = 'lmn-restart';
    doc.body.insertBefore(el, doc.body.firstChild);
  }
  const banner = el;
  const relayout = (): void => place(doc, win, banner);
  detach?.();
  win.addEventListener('resize', relayout);
  detach = () => win.removeEventListener('resize', relayout);

  render(
    <RestartBanner
      client={client}
      message={message}
      onDismiss={() => {
        const focused = banner.contains(doc.activeElement);
        onDismiss();
        hideRestartBanner(doc);
        // Keyboard and remote users keep their place: the page's first control rather than <body>.
        if (focused) firstFocusable(doc, banner)?.focus();
      }}
      onLayout={relayout}
      onRestarting={(on) => {
        restarting = on;
      }}
      announce={(text) => {
        // A moment later, so a region that just appeared has been noticed first.
        setTimeout(() => {
          live.textContent = text;
        }, 100);
      }}
      reload={() => win.location.reload()}
    />,
    banner,
  );
  doc.documentElement.classList.add(SHOWN_CLASS);
  if (fresh) {
    // Start above, then slide down: the next frame, so the starting position has been drawn.
    win.requestAnimationFrame(() => win.requestAnimationFrame(() => banner.classList.add(IN_CLASS)));
  } else {
    banner.classList.add(IN_CLASS);
  }
}

/** Slides the banner away. `force` also takes it away while it's restarting (the page left the admin pages). */
export function hideRestartBanner(doc: Document, force = false): void {
  if (restarting && !force) return;
  restarting = false;
  token++;
  const el = doc.getElementById(BANNER_ID);
  if (!el) return;
  detach?.();
  detach = null;
  doc.documentElement.classList.remove(SHOWN_CLASS);
  doc.documentElement.style.removeProperty(SPACE_PROPERTY);
  const live = doc.getElementById(LIVE_ID);
  if (live) live.textContent = '';
  el.classList.remove(IN_CLASS);
  const win = doc.defaultView;
  const remove = (): void => {
    render(null, el);
    el.remove();
  };
  clearTimeout(removeTimer);
  // Leaving the admin pages takes the page's admin look (and so the banner's styles) away at once: no slide-out, or
  // the unstyled banner would push the next page down for a moment.
  if (win && !force && !reducedMotion(win)) removeTimer = setTimeout(remove, SLIDE_MS);
  else remove();
}
