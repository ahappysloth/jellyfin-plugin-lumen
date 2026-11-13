import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { getLayout } from '../compat/jellyfin';
import { Icon } from '../components/icons';
import { LumenMark } from '../components/LumenMark';
import { newUuid } from '../util/uuid';
import type { AdminApi } from './adminApi';
import { ADMIN_TABS, type AdminTab, initialTab, rememberTab, TAB_LABELS } from './adminTabs';
import { GeneralSettings } from './GeneralSettings';
import { HealthTab } from './health/HealthTab';
import { useHealth } from './health/useHealth';
import { HeroSettings } from './HeroSettings';
import { HomeSectionsSettings } from './HomeSectionsSettings';
import { RequestsSettings } from './RequestsSettings';
import { StorageSettings } from './StorageSettings';
import { Top10Settings } from './Top10Settings';
import { UpdatesSettings } from './UpdatesSettings';
import { wantsCheck } from './updatesLink';
import { isBusy, RESET_FAILED, useAdminConfig } from './useAdminConfig';

interface AdminAppProps {
  api: AdminApi;
  newId?: () => string;
  confirm?: (message: string) => boolean;
  /**
   * The page's URL hash: `?check=updates` (from Jellyfin's Plugins page) checks for updates on open, and `?tab=storage`
   * opens the Storage tab.
   */
  hash?: string;
  /** Keeps the open tab across a reload (in the URL). */
  onTab?: (tab: AdminTab) => void;
  /** Reloads the page once Jellyfin is back from a restart. */
  reload?: () => void;
  /** How long "Settings saved." shows before the save bar slides away. */
  savedFor?: number;
}

/** Each copy of the page (jellyfin-web keeps the ones it has left) gets its own ids for its tabs and panels. */
let pageCount = 0;

/** Where the settings column is on screen: the save bar is fixed to the viewport but lines up with it. */
interface Column {
  left: number;
  width: number;
}

export function AdminApp({
  api,
  newId = newUuid,
  confirm = (m) => window.confirm(m),
  hash = window.location.hash,
  onTab = rememberTab,
  reload,
  savedFor = 2000,
}: AdminAppProps) {
  const admin = useAdminConfig(api);
  // Run when the page opens, so the Health tab can show a badge for problems before it's opened.
  const health = useHealth(api, () => ({
    fetch: api.fetch,
    location: window.location,
    url: api.url,
    now: Date.now,
  }));
  const { config, status, errors, warnings, dirty, update } = admin;
  const busy = isBusy(status);
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Settings, Storage or Health. Storage starts measuring only once its tab is first opened (it can take a while on a big
  // library, and most visits are for a setting), then stays mounted, so going back to it doesn't measure again.
  const [tab, setTab] = useState<AdminTab>(() => initialTab(hash));
  const [storageOpened, setStorageOpened] = useState(tab === 'storage');
  const [ids] = useState(() => `lmna-page-${++pageCount}`);
  const tabRefs = useRef<Partial<Record<AdminTab, HTMLButtonElement | null>>>({});
  const choose = (next: AdminTab): void => {
    if (next === 'storage') setStorageOpened(true);
    if (next === tab) return;
    setTab(next);
    onTab(next);
  };
  // A tablist's keys: arrows (round from either end), Home and End pick a tab and focus it. On a TV a D-pad isn't kept
  // in here past either end; jellyfin-web's own navigation has those keys (and keeps focus in the strip, a
  // focuscontainer-x, as it would anywhere).
  const onTabKey = (e: KeyboardEvent): void => {
    const at = ADMIN_TABS.indexOf(tab);
    const count = ADMIN_TABS.length;
    let next =
      e.key === 'ArrowRight'
        ? at + 1
        : e.key === 'ArrowLeft'
          ? at - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? count - 1
              : null;
    if (next === null || e.altKey || e.ctrlKey || e.metaKey) return;
    if (next < 0 || next >= count) {
      if (getLayout() === 'tv') return;
      next = (next + count) % count;
    }
    e.preventDefault();
    const target = ADMIN_TABS[next]!;
    choose(target);
    tabRefs.current[target]?.focus();
  };

  // A Health fix that opens a settings card: the Settings tab, scrolled to the card, focus on its first control (a D-pad
  // goes on from there). After the render that shows the tab.
  const [openCard, setOpenCard] = useState<string | null>(null);
  const openSetting = (card: string): void => {
    choose('settings');
    setOpenCard(card);
  };
  useEffect(() => {
    if (!openCard || tab !== 'settings') return;
    setOpenCard(null);
    const card = formRef.current?.querySelector<HTMLElement>(`[data-card="${openCard}"]`);
    if (!card) return;
    // Optional: not in every test DOM.
    card.scrollIntoView?.({ block: 'start' });
    card
      .querySelector<HTMLElement>('input, select, textarea, button, a[href]')
      ?.focus({ preventScroll: true });
  }, [openCard, tab]);

  // "Settings saved." shows for a moment, then the bar slides away. Reset on every status change, so the next save
  // shows it again.
  const [savedOver, setSavedOver] = useState(false);
  useEffect(() => {
    setSavedOver(false);
    if (status !== 'saved') return undefined;
    const timer = setTimeout(() => setSavedOver(true), savedFor);
    return () => clearTimeout(timer);
  }, [status]);
  // The bar is up while there's something to save (a failed save leaves the changes unsaved, so its problem stays in the
  // bar too), a save in flight, or a save just done. A failed reset with nothing changed is shown next to Reset instead:
  // the bar would only offer Save, which isn't the answer to it.
  const shown = dirty || status === 'saving' || (status === 'saved' && !savedOver);

  // Jellyfin's dashboard scrolls the whole page, and an overflow: hidden wrapper stops position: sticky, so the bar is
  // fixed to the viewport. It lines up with the settings column (not over the dashboard's drawer) by measuring it.
  const [column, setColumn] = useState<Column | null>(null);
  useLayoutEffect(() => {
    if (!shown) return undefined;
    const measure = (): void => {
      // jellyfin-web drops pages it has left without unmounting the app: stop listening once this copy is gone.
      if (!formRef.current?.isConnected) {
        window.removeEventListener('resize', measure);
        return;
      }
      const rect = formRef.current.getBoundingClientRect();
      if (!rect || !rect.width) return;
      setColumn((c) =>
        c && c.left === rect.left && c.width === rect.width ? c : { left: rect.left, width: rect.width },
      );
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [shown]);

  // Saved or discarded from the bar's buttons with focus on one: when the bar slides away, focus would drop to the end
  // of the page, so it goes to the page's heading instead, without scrolling. (Only then: Safari doesn't focus a tapped
  // button, and before 15 it scrolls to whatever is focused.)
  const leftFromBar = useRef(false);
  useEffect(() => {
    if (shown || !leftFromBar.current) return;
    leftFromBar.current = false;
    const active = document.activeElement;
    // Disabling Save while it saves can drop focus to the body.
    if (!active || active === document.body || barRef.current?.contains(active)) {
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [shown]);

  // Ctrl+S / Cmd+S saves, while this copy of the page is the one showing (jellyfin-web keeps pages it has left).
  const latest = useRef({ dirty, busy, save: admin.save });
  latest.current = { dirty, busy, save: admin.save };
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Pages jellyfin-web has dropped are never unmounted; a gone copy removes its own listener.
      if (!formRef.current?.isConnected) {
        document.removeEventListener('keydown', onKey);
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey || (e.key !== 's' && e.key !== 'S')) return;
      if (!formRef.current?.offsetParent) return;
      e.preventDefault();
      if (latest.current.dirty && !latest.current.busy) void latest.current.save();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (status === 'failed') return <p role="alert">{admin.failure}</p>;
  if (!config) return <p>Loading Lumen settings…</p>;

  // What the save bar says. A failed save (or reset) keeps its message until the next one works.
  const failed = errors.length > 0 && !busy;
  const statusText =
    status === 'saving'
      ? 'Saving…'
      : status === 'resetting'
        ? 'Resetting…'
        : failed
          ? errors.length === 1
            ? errors[0]
            : `${errors.length} problems need fixing. They're listed at the top of the page.`
          : status === 'saved'
            ? 'Settings saved.'
            : dirty
              ? // Not lost on the Storage tab: kept, and the bar says where they are.
                tab === 'settings'
                ? 'Unsaved changes'
                : 'Unsaved changes on the Settings tab'
              : '';
  // A failed reset leaves the status as it was, which may still be 'saved': the failure comes first.
  const tone = failed ? 'error' : status === 'saved' ? 'ok' : dirty && !busy ? 'dirty' : '';
  const resetFailed = !shown && !busy && errors.includes(RESET_FAILED);

  const reset = (): void => {
    if (confirm('Reset all Lumen settings to their defaults?')) void admin.reset();
  };
  // Remounted on Discard (useAdminConfig's revision): sections keeping state of their own start again from the
  // restored settings. Updates, Storage and Health hold nothing that Discard puts back, and remounting them would
  // check for updates and measure storage again.
  const revision = admin.revision;

  return (
    <form
      ref={formRef}
      class={`lmn-admin${shown ? ' has-savebar' : ''}`}
      style={{ '--a-accent': config.AccentColor } as Record<string, string>}
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        leftFromBar.current = !!barRef.current?.contains(document.activeElement);
        void admin.save();
      }}
    >
      <header class="lmn-admin__header">
        <LumenMark class="lmn-admin__logo" />
        <div>
          <h1 ref={headingRef} tabIndex={-1}>
            Lumen
          </h1>
          <p>Cinematic home and details pages, and catalog requests through Seerr.</p>
        </div>
      </header>

      {/* Settings, and Storage and Health on tabs of their own. The save bar and Reset belong to Settings, but unsaved
          changes aren't lost on the way to another tab: they stay, and so does the bar, saying where they are. */}
      <div class="lmna-tabs focuscontainer-x" role="tablist" aria-label="Lumen" onKeyDown={onTabKey}>
        {ADMIN_TABS.map((t) => (
          <button
            key={t}
            ref={(el) => {
              tabRefs.current[t] = el;
            }}
            type="button"
            role="tab"
            id={`${ids}-tab-${t}`}
            aria-controls={`${ids}-panel-${t}`}
            aria-selected={t === tab}
            // Roving focus: Tab reaches the open tab, arrows the other.
            tabIndex={t === tab ? 0 : -1}
            class={`lmna-tab${t === tab ? ' is-active' : ''}`}
            onClick={() => choose(t)}
          >
            {TAB_LABELS[t]}
            {/* The count shows; its words are for screen readers, so the tab reads "Health 2 problems" (with the
                visible text in its name, as voice control expects). */}
            {t === 'health' && health.problems > 0 && (
              <span class="lmna-tab__badge">
                {health.problems}
                <span class="lmna-sr-only">{health.problems === 1 ? ' problem' : ' problems'}</span>
              </span>
            )}
          </button>
        ))}
      </div>

      {/* A failed save's problems show on either tab: Save is in the bar on both. */}
      {errors.length > 0 && (
        <div
          class="lmna-callout lmna-callout--error lmn-admin__errors"
          role="alert"
          style={{ marginBottom: '16px' }}
        >
          <h3>Please fix these problems</h3>
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div
        role="tabpanel"
        id={`${ids}-panel-settings`}
        aria-labelledby={`${ids}-tab-settings`}
        class="lmna-tabpanel"
        hidden={tab !== 'settings'}
      >
        {warnings.map((w) => (
          <div key={w} class="lmna-callout lmna-callout--warn" role="note" style={{ marginBottom: '16px' }}>
            <p>{w}</p>
          </div>
        ))}

        <UpdatesSettings api={api} autoCheck={wantsCheck(hash)} confirm={confirm} reload={reload} />
        <GeneralSettings key={`general-${revision}`} config={config} update={update} />
        <HeroSettings key={`hero-${revision}`} config={config} lookups={admin.lookups} update={update} />
        <HomeSectionsSettings
          key={`sections-${revision}`}
          config={config}
          types={admin.types}
          lookups={admin.lookups}
          newId={newId}
          update={update}
          busy={busy}
        />
        <RequestsSettings
          key={`requests-${revision}`}
          api={api}
          config={config}
          savedUrl={admin.savedUrl}
          update={update}
          confirm={confirm}
        />
        <Top10Settings key={`top10-${revision}`} api={api} config={config} update={update} />

        {/* Reset isn't in the save bar: it doesn't depend on unsaved changes, so it has to be there while the bar is
            hidden, and it's kept away from Save. */}
        <div class="lmna-reset">
          <button type="button" class="lmna-btn" disabled={busy} onClick={reset}>
            {status === 'resetting' ? 'Resetting…' : 'Reset to defaults'}
          </button>
          {resetFailed && <p class="lmna-reset__error">{RESET_FAILED}</p>}
        </div>
      </div>

      <div
        role="tabpanel"
        id={`${ids}-panel-storage`}
        aria-labelledby={`${ids}-tab-storage`}
        class="lmna-tabpanel"
        hidden={tab !== 'storage'}
      >
        {storageOpened && <StorageSettings api={api} />}
      </div>

      <div
        role="tabpanel"
        id={`${ids}-panel-health`}
        aria-labelledby={`${ids}-tab-health`}
        class="lmna-tabpanel"
        hidden={tab !== 'health'}
      >
        <HealthTab
          health={health}
          config={config}
          savedUrl={admin.savedUrl}
          onOpenSetting={openSetting}
          onUpFromTop={() => tabRefs.current.health?.focus()}
        />
      </div>

      {/* The save bar's polite live region, outside the bar: a live region that appears together with its text (the
          bar is hidden from screen readers while down) usually isn't read. So "Unsaved changes" is read once (not on
          every keystroke), then "Saving…" and "Settings saved.". Not errors: the list at the top is an alert. */}
      <span role="status" class="lmna-sr-only">
        {failed ? '' : statusText}
      </span>

      {/* Slides up from the bottom of the window while there's something to say; status on the left, Discard and Save
          on the right. Hidden, it's out of the tab order and the accessibility tree (visibility: hidden in admin.css). */}
      <div
        ref={barRef}
        class={`lmna-savebar${shown ? ' is-shown' : ''}`}
        aria-hidden={shown ? undefined : 'true'}
        style={column ? { left: `${column.left}px`, width: `${column.width}px` } : undefined}
      >
        <p class={`lmna-savebar__status${tone ? ` lmna-savebar__status--${tone}` : ''}`}>
          {tone === 'ok' && <Icon name="check" size={18} />}
          {/* Read out by the live region above, except errors (the alert at the top reads those). */}
          <span aria-hidden={failed ? undefined : 'true'}>{statusText}</span>
        </p>
        {/* Drops the unsaved changes, with no confirmation: nothing saved is lost. Only while there are some (not while
            "Settings saved." shows). */}
        {dirty && (
          <button
            type="button"
            class="lmna-btn"
            disabled={busy}
            onClick={() => {
              leftFromBar.current = !!barRef.current?.contains(document.activeElement);
              admin.discard();
            }}
          >
            Discard
          </button>
        )}
        {/* Out of the TV layout's D-pad while hidden: jellyfin-web's arrow-key navigation counts any button with a
            box, and this one waits just below the window, so Down from a control above it would pick it and go
            nowhere. */}
        <button
          type="submit"
          class="lmna-btn lmna-btn--primary"
          disabled={busy}
          tabIndex={shown ? undefined : -1}
        >
          Save
        </button>
      </div>
    </form>
  );
}
