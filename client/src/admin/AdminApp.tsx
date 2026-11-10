import { Icon } from '../components/icons';
import { LumenMark } from '../components/LumenMark';
import { newUuid } from '../util/uuid';
import type { AdminApi } from './adminApi';
import { DiagnosticsSettings } from './DiagnosticsSettings';
import { GeneralSettings } from './GeneralSettings';
import { HeroSettings } from './HeroSettings';
import { HomeSectionsSettings } from './HomeSectionsSettings';
import { RequestsSettings } from './RequestsSettings';
import { UpdatesSettings } from './UpdatesSettings';
import { wantsCheck } from './updatesLink';
import { isBusy, useAdminConfig } from './useAdminConfig';

interface AdminAppProps {
  api: AdminApi;
  newId?: () => string;
  confirm?: (message: string) => boolean;
  /** The page's URL hash: `?check=updates` (from Jellyfin's Plugins page) checks for updates on open. */
  hash?: string;
}

export function AdminApp({
  api,
  newId = newUuid,
  confirm = (m) => window.confirm(m),
  hash = window.location.hash,
}: AdminAppProps) {
  const admin = useAdminConfig(api);
  const { config, status, errors, warnings, dirty, update } = admin;
  const busy = isBusy(status);

  if (status === 'failed') return <p role="alert">{admin.failure}</p>;
  if (!config) return <p>Loading Lumen settings…</p>;

  const reset = (): void => {
    if (confirm('Reset all Lumen settings to their defaults?')) void admin.reset();
  };

  return (
    <form
      class="lmn-admin"
      style={{ '--a-accent': config.AccentColor } as Record<string, string>}
      onSubmit={(e) => {
        e.preventDefault();
        void admin.save();
      }}
    >
      <header class="lmn-admin__header">
        <LumenMark class="lmn-admin__logo" />
        <div>
          <h1>Lumen</h1>
          <p>Cinematic home and details pages, and catalog requests through Seerr.</p>
        </div>
      </header>

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
      {warnings.map((w) => (
        <div key={w} class="lmna-callout lmna-callout--warn" role="note" style={{ marginBottom: '16px' }}>
          <p>{w}</p>
        </div>
      ))}

      <UpdatesSettings api={api} autoCheck={wantsCheck(hash)} confirm={confirm} />
      <GeneralSettings config={config} update={update} />
      <HeroSettings config={config} lookups={admin.lookups} update={update} />
      <HomeSectionsSettings
        config={config}
        types={admin.types}
        lookups={admin.lookups}
        newId={newId}
        update={update}
      />
      <RequestsSettings api={api} config={config} savedUrl={admin.savedUrl} update={update} />
      <DiagnosticsSettings diagnostics={admin.diagnostics} />

      {/* Status reads as text on the left; the actions sit together on the right, Save last (the primary). */}
      <div class="lmna-savebar">
        {status === 'saved' ? (
          <p role="status" class="lmna-savebar__status lmna-savebar__status--ok">
            <Icon name="check" size={16} />
            Settings saved.
          </p>
        ) : (
          <p class={`lmna-savebar__status${dirty && !busy ? ' lmna-savebar__status--dirty' : ''}`}>
            {status === 'saving'
              ? 'Saving…'
              : status === 'resetting'
                ? 'Resetting…'
                : dirty
                  ? 'Unsaved changes'
                  : 'All changes saved'}
          </p>
        )}
        <button type="button" class="lmna-btn lmna-btn--ghost" disabled={busy} onClick={reset}>
          Reset to defaults
        </button>
        <button type="submit" class="lmna-btn lmna-btn--primary" disabled={busy}>
          Save
        </button>
      </div>
    </form>
  );
}
