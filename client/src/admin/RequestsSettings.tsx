import { useEffect, useState } from 'preact/hooks';
import type { AdminApi, LumenConfig, SeerrTestResult, SeerrUsers } from './adminApi';
import { Card, Field, NumberField, Switch, inputValue } from './controls';

/**
 * Keeps browsers and password managers (1Password, LastPass, Bitwarden, Dashlane) from filling a Jellyfin login into
 * the Seerr fields. "new-password" is the one autocomplete value Chrome and Safari reliably respect on password inputs.
 */
export const NO_PASSWORD_MANAGER = {
  'data-1p-ignore': 'true',
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
} as const;

/** Seerr connection for catalog browsing and requests. The API key is write-only: the server never sends it back. */
/** Mirrors the server's rule (ConfigValidator.SameSeerr): the saved key is only reused for the saved address. */
function sameSeerrAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (u: string | null | undefined): string => (u ?? '').trim().replace(/\/+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

export function RequestsSettings({
  api,
  config,
  savedUrl,
  update,
}: {
  api: AdminApi;
  config: LumenConfig;
  /** The Seerr address as last saved (the stored key belongs to it). */
  savedUrl: string | null | undefined;
  update: (patch: Partial<LumenConfig>) => void;
}) {
  const [test, setTest] = useState<SeerrTestResult | 'testing' | null>(null);
  const [users, setUsers] = useState<SeerrUsers | null>(null);
  const savedAndEnabled = !!config.RequestsEnabled && !!config.SeerrApiKeySet && !config.SeerrApiKey;

  useEffect(() => {
    if (!savedAndEnabled) return setUsers(null);
    let cancelled = false;
    api
      .getSeerrUsers()
      .then((result) => !cancelled && setUsers(result))
      .catch(() => !cancelled && setUsers(null));
    return () => {
      cancelled = true;
    };
  }, [savedAndEnabled, config.SeerrUrl]);

  const runTest = async (): Promise<void> => {
    setTest('testing');
    try {
      setTest(await api.testSeerr(config.SeerrUrl ?? '', config.SeerrApiKey ?? ''));
    } catch {
      setTest({ Ok: false, Version: null, Error: 'The test request failed. Check the server log.' });
    }
  };

  // The test result is fresher than the saved-settings check, so prefer it.
  const tested = test && test !== 'testing' ? test : null;
  const sameServer = tested?.Ok ? tested.SameJellyfinServer : users?.SameJellyfinServer;
  const seerrServerName =
    (tested?.Ok ? tested.JellyfinServerName : users?.JellyfinServerName) ?? 'another server';

  return (
    <Card
      title="Requests"
      intro="Browse and request titles you don't have yet, through Seerr. Requests are filed as the signed-in user, so their Seerr permissions and quotas apply."
    >
      <Switch
        label="Enable catalog browsing and requests"
        checked={!!config.RequestsEnabled}
        onChange={(v) => update({ RequestsEnabled: v })}
      />
      <div class="lmna-grid" style={{ marginBottom: '16px' }}>
        <Field label="Seerr address" hint="As Jellyfin's server reaches it, e.g. http://seerr:5055">
          <input
            type="url"
            name="lumen-seerr-address"
            autoComplete="off"
            spellcheck={false}
            {...NO_PASSWORD_MANAGER}
            placeholder="http://seerr:5055"
            value={config.SeerrUrl ?? ''}
            onInput={(e) => update({ SeerrUrl: inputValue(e) })}
          />
        </Field>
        <Field label="Seerr API key" hint="Seerr → Settings → General">
          <input
            type="password"
            name="lumen-seerr-api-key"
            autoComplete="new-password"
            spellcheck={false}
            {...NO_PASSWORD_MANAGER}
            placeholder={
              !config.SeerrApiKeySet
                ? 'Paste the API key'
                : sameSeerrAddress(config.SeerrUrl, savedUrl)
                  ? 'Saved (leave blank to keep it)'
                  : 'Enter the key for this address'
            }
            value={config.SeerrApiKey ?? ''}
            onInput={(e) => update({ SeerrApiKey: inputValue(e) })}
          />
        </Field>
      </div>
      <div class="lmna-row">
        <button type="button" class="lmna-btn" disabled={test === 'testing'} onClick={() => void runTest()}>
          {test === 'testing' ? 'Testing…' : 'Test connection'}
        </button>
        {tested && (
          <span role="status" class={`lmna-pill ${tested.Ok ? 'lmna-pill--ok' : 'lmna-pill--error'}`}>
            {tested.Ok ? `Connected to Seerr ${tested.Version ?? ''}` : tested.Error}
          </span>
        )}
      </div>

      {sameServer === false ? (
        <div class="lmna-callout lmna-callout--warn" role="note">
          <h3>Seerr is linked to a different Jellyfin server</h3>
          <p>
            Seerr uses “{seerrServerName}”, not this server. Seerr accounts only match users of the Jellyfin
            server it's linked to, so nobody here will see the catalog. Install Lumen on that server instead.
          </p>
        </div>
      ) : (
        users &&
        users.Unmapped.length > 0 && (
          <div class="lmna-callout lmn-admin__unmapped">
            <h3>Users without a Seerr account</h3>
            <p>They won't see the catalog until they have one. In Seerr: Users → Import Jellyfin Users.</p>
            <ul class="lmna-chips">
              {users.Unmapped.map((u) => (
                <li key={u.Id}>{u.Name}</li>
              ))}
            </ul>
          </div>
        )
      )}

      <div style={{ marginTop: '18px' }}>
        <NumberField
          label="Artwork cache size (MB)"
          value={config.ImageCacheMb ?? 500}
          min={50}
          max={10000}
          onChange={(v) => update({ ImageCacheMb: v })}
        />
      </div>
    </Card>
  );
}
