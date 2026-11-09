import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type {
  AdminApi,
  DiagnosticEntry,
  LumenConfig,
  Option,
  SectionDef,
  SectionParamDef,
  SectionTypeDef,
  SeerrTestResult,
  SeerrUsers,
} from './adminApi';
import { newUuid } from '../util/uuid';
import {
  HERO_LABELS,
  HERO_SOURCES,
  getParam,
  moveSection,
  newSection,
  normalizeConfig,
  normalizeId,
  removeSection,
  setParam,
} from './configModel';

type PickerKind = 'Library' | 'Collection' | 'Playlist';
type Lookups = Record<PickerKind, Option[]>;

const inputValue = (event: Event): string => (event.target as HTMLInputElement | HTMLSelectElement).value;
const sectionLabel = (section: SectionDef, types: SectionTypeDef[]): string =>
  section.Title || types.find((t) => t.Type === section.Type)?.DisplayName || section.Type;

interface AdminAppProps {
  api: AdminApi;
  newId?: () => string;
  confirm?: (message: string) => boolean;
}

export function AdminApp({ api, newId = newUuid, confirm = (m) => window.confirm(m) }: AdminAppProps) {
  const [config, setConfig] = useState<LumenConfig | null>(null);
  const [types, setTypes] = useState<SectionTypeDef[]>([]);
  const [lookups, setLookups] = useState<Lookups>({ Library: [], Collection: [], Playlist: [] });
  const [diagnostics, setDiagnostics] = useState<DiagnosticEntry[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'failed'>('loading');
  const [dirty, setDirty] = useState(false);

  const load = async (): Promise<void> => {
    try {
      const [c, t, libraries, collections, playlists, d] = await Promise.all([
        api.getConfig(),
        api.getSectionTypes(),
        api.getLibraries(),
        api.getCollections(),
        api.getPlaylists(),
        api.getDiagnostics(),
      ]);
      setConfig(normalizeConfig(c));
      setTypes(t);
      setLookups({ Library: libraries, Collection: collections, Playlist: playlists });
      setDiagnostics(d);
      setDirty(false);
      setStatus('ready');
    } catch {
      setStatus('failed');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (status === 'failed')
    return <p role="alert">Couldn't load Lumen settings. Reload the page to try again.</p>;
  if (!config) return <p>Loading Lumen settings…</p>;

  const update = (patch: Partial<LumenConfig>): void => {
    setConfig({ ...config, ...patch });
    setDirty(true);
    if (status === 'saved') setStatus('ready');
  };
  const updateSection = (index: number, section: SectionDef): void =>
    update({ Sections: config.Sections.map((s, i) => (i === index ? section : s)) });

  const save = async (event: Event): Promise<void> => {
    event.preventDefault();
    setStatus('saving');
    try {
      const result = await api.saveConfig(config);
      if (result.ok) {
        setErrors([]);
        setConfig(normalizeConfig(await api.getConfig()));
        setDirty(false);
        setStatus('saved');
      } else {
        setErrors(result.errors);
        setStatus('ready');
      }
    } catch {
      setErrors(['Saving failed. Check the server log.']);
      setStatus('ready');
    }
  };

  const reset = async (): Promise<void> => {
    if (!confirm('Reset all Lumen settings to their defaults?')) return;
    await api.reset();
    setErrors([]);
    await load();
  };

  return (
    <form
      class="lmn-admin"
      style={{ '--a-accent': config.AccentColor } as Record<string, string>}
      onSubmit={(e) => void save(e)}
    >
      <header class="lmn-admin__header">
        <span class="lmn-admin__logo" aria-hidden="true" />
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

      <Card title="General">
        <Switch
          label="Enable Lumen"
          hint="Off shows Jellyfin's own pages everywhere."
          checked={config.Enabled}
          onChange={(v) => update({ Enabled: v })}
        />
        <Switch
          label="Replace the home screen"
          checked={config.HomeTakeover}
          onChange={(v) => update({ HomeTakeover: v })}
        />
        <Switch
          label="Replace movie and series details pages"
          checked={config.DetailsTakeover}
          onChange={(v) => update({ DetailsTakeover: v })}
        />
        <Switch
          label="Replace the Movies, Shows, Favorites, Search and Settings pages"
          checked={config.LibraryTakeover}
          onChange={(v) => update({ LibraryTakeover: v })}
        />
        <Field label="Accent color" hint="Badges, ratings, progress bars and this page's buttons.">
          <input
            type="color"
            value={config.AccentColor}
            onInput={(e) => update({ AccentColor: inputValue(e) })}
          />
        </Field>
      </Card>

      <Card title="Hero banner" intro="The large rotating banner at the top of the home screen.">
        <div class="lmna-grid">
          <Field label="Source">
            <select value={String(config.HeroSource)} onChange={(e) => update({ HeroSource: inputValue(e) })}>
              {HERO_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {HERO_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
          {config.HeroSource === 'Collection' && (
            <Field label="Collection">
              <OptionSelect
                options={lookups.Collection}
                value={config.HeroCollectionId ?? ''}
                onChange={(v) => update({ HeroCollectionId: v || null })}
              />
            </Field>
          )}
          <NumberField
            label="Items"
            value={config.HeroCount}
            min={1}
            max={10}
            onChange={(v) => update({ HeroCount: v })}
          />
          <NumberField
            label="Seconds per slide"
            value={config.HeroIntervalSeconds}
            min={3}
            max={60}
            onChange={(v) => update({ HeroIntervalSeconds: v })}
          />
        </div>
        <div style={{ marginTop: '18px' }}>
          <Switch
            label="Play muted trailer previews"
            hint="Local trailers only. Also used behind details pages."
            checked={config.TrailerPreview}
            onChange={(v) => update({ TrailerPreview: v })}
          />
          {config.TrailerPreview && (
            <NumberField
              label="Seconds before the trailer starts"
              value={config.TrailerDelaySeconds}
              min={0}
              max={30}
              onChange={(v) => update({ TrailerDelaySeconds: v })}
            />
          )}
        </div>
      </Card>

      <Card
        title="Home sections"
        intro="Rows on the home screen, top to bottom. Each row adapts to the viewer."
      >
        <ol class="lmna-sections">
          {config.Sections.map((section, index) => {
            const label = sectionLabel(section, types);
            return (
              <li key={section.Id} class={`lmna-section${section.Enabled ? '' : ' is-disabled'}`}>
                <SectionEditor
                  section={section}
                  type={types.find((t) => t.Type === section.Type)}
                  lookups={lookups}
                  onChange={(s) => updateSection(index, s)}
                  actions={
                    <div class="lmna-section__actions">
                      <button
                        type="button"
                        class="lmna-icon-btn"
                        aria-label={`Move ${label} up`}
                        title="Move up"
                        disabled={index === 0}
                        onClick={() => update({ Sections: moveSection(config.Sections, index, -1) })}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        class="lmna-icon-btn"
                        aria-label={`Move ${label} down`}
                        title="Move down"
                        disabled={index === config.Sections.length - 1}
                        onClick={() => update({ Sections: moveSection(config.Sections, index, 1) })}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        class="lmna-icon-btn lmna-icon-btn--danger"
                        aria-label={`Remove ${label}`}
                        title="Remove"
                        onClick={() => update({ Sections: removeSection(config.Sections, index) })}
                      >
                        ✕
                      </button>
                    </div>
                  }
                />
              </li>
            );
          })}
        </ol>
        <AddSection
          types={types}
          onAdd={(type) => update({ Sections: [...config.Sections, newSection(type, newId())] })}
        />
      </Card>

      <RequestsSettings api={api} config={config} update={update} />

      <Card
        title="Diagnostics"
        intro="Clients where Lumen's compatibility check failed and Jellyfin's own pages were shown."
      >
        {diagnostics.length === 0 ? (
          <p class="lmna-empty">No compatibility problems reported.</p>
        ) : (
          <table class="lmna-table lmn-admin__diagnostics">
            <thead>
              <tr>
                <th>Client</th>
                <th>Server</th>
                <th>Failed checks</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {diagnostics.map((d) => (
                <tr key={`${d.Client}-${d.LastSeen}`}>
                  <td>{d.Client}</td>
                  <td>{d.ServerVersion}</td>
                  <td>{d.FailedChecks.join(', ')}</td>
                  <td>{new Date(d.LastSeen).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div class="lmna-savebar">
        <button type="submit" class="lmna-btn lmna-btn--primary" disabled={status === 'saving'}>
          Save
        </button>
        <button type="button" class="lmna-btn lmna-btn--ghost" onClick={() => void reset()}>
          Reset to defaults
        </button>
        {status === 'saved' ? (
          <p role="status" class="lmna-savebar__status lmna-savebar__status--ok" style={{ margin: 0 }}>
            Settings saved.
          </p>
        ) : (
          <p class="lmna-savebar__status" style={{ margin: 0 }}>
            {status === 'saving' ? 'Saving…' : dirty ? 'Unsaved changes' : ''}
          </p>
        )}
      </div>
    </form>
  );
}

/** Seerr connection for catalog browsing and requests. The API key is write-only: the server never sends it back. */
function RequestsSettings({
  api,
  config,
  update,
}: {
  api: AdminApi;
  config: LumenConfig;
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
            placeholder="http://seerr:5055"
            value={config.SeerrUrl ?? ''}
            onInput={(e) => update({ SeerrUrl: inputValue(e) })}
          />
        </Field>
        <Field label="Seerr API key" hint="Seerr → Settings → General">
          <input
            type="password"
            autoComplete="off"
            placeholder={config.SeerrApiKeySet ? 'Saved (leave blank to keep it)' : 'Paste the API key'}
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

function Card({ title, intro, children }: { title: string; intro?: string; children: ComponentChildren }) {
  return (
    <fieldset class="lmna-card">
      <legend>{title}</legend>
      {intro && <p class="lmna-card__intro">{intro}</p>}
      {!intro && <div style={{ height: '12px' }} />}
      {children}
    </fieldset>
  );
}

let fieldHintId = 0;

/** A labelled control. The hint sits outside the label so it is a description, not part of the accessible name. */
function Field({ label, hint, children }: { label: string; hint?: string; children: ComponentChildren }) {
  const [hintId] = useState(() => `lmn-hint-${++fieldHintId}`);
  const labelRef = useRef<HTMLLabelElement>(null);
  useEffect(() => {
    const control = labelRef.current?.querySelector('input, select');
    if (!control) return;
    if (hint) control.setAttribute('aria-describedby', hintId);
    else control.removeAttribute('aria-describedby');
  }, [hint, hintId]);
  return (
    <div class="lmna-field">
      <label ref={labelRef} class="lmna-field__control">
        <span class="lmna-field__label">{label}</span>
        {children}
      </label>
      {hint && (
        <span id={hintId} class="lmna-field__hint">
          {hint}
        </span>
      )}
    </div>
  );
}

function Switch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label class="lmna-switch">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
      />
      <span class="lmna-switch__text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

function NumberField(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={props.label}>
      <input
        type="number"
        min={props.min}
        max={props.max}
        value={props.value}
        onInput={(e) => props.onChange(Number.parseInt(inputValue(e), 10) || 0)}
      />
    </Field>
  );
}

function OptionSelect({
  options,
  value,
  onChange,
}: {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
}) {
  const selected = options.find((o) => normalizeId(o.id) === normalizeId(value))?.id ?? '';
  return (
    <select value={selected} onChange={(e) => onChange(inputValue(e))}>
      <option value="">(none)</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

function ParamInput(props: {
  param: SectionParamDef;
  value: string;
  lookups: Lookups;
  onChange: (value: string) => void;
}) {
  const { param, value, lookups, onChange } = props;
  if (param.Kind === 'Library' || param.Kind === 'Collection' || param.Kind === 'Playlist') {
    return <OptionSelect options={lookups[param.Kind]} value={value} onChange={onChange} />;
  }
  if (param.Kind === 'Integer') {
    return (
      <input
        type="number"
        min={param.Min ?? undefined}
        max={param.Max ?? undefined}
        value={value}
        onInput={(e) => onChange(inputValue(e))}
      />
    );
  }
  return <input type="text" value={value} onInput={(e) => onChange(inputValue(e))} />;
}

function SectionEditor(props: {
  section: SectionDef;
  type: SectionTypeDef | undefined;
  lookups: Lookups;
  onChange: (section: SectionDef) => void;
  actions: ComponentChildren;
}) {
  const { section, type, lookups, onChange } = props;
  const name = type?.DisplayName ?? `Unknown type: ${section.Type}`;
  return (
    <>
      <div class="lmna-section__head">
        <span class="lmna-section__name">
          {section.Title || name}
          {section.Title && <small>{name}</small>}
        </span>
        <label class="lmna-switch" title={section.Enabled ? 'Shown' : 'Hidden'}>
          <input
            type="checkbox"
            role="switch"
            aria-label={`Show ${section.Title || name}`}
            checked={section.Enabled}
            onChange={(e) => onChange({ ...section, Enabled: (e.target as HTMLInputElement).checked })}
          />
        </label>
        {props.actions}
      </div>
      <div class="lmna-section__body">
        <Field label="Title (optional)">
          <input
            type="text"
            placeholder={name}
            value={section.Title ?? ''}
            onInput={(e) => onChange({ ...section, Title: inputValue(e) || null })}
          />
        </Field>
        {type?.Parameters.map((p) => (
          <Field key={p.Name} label={p.Required ? `${p.Label} *` : p.Label}>
            <ParamInput
              param={p}
              value={getParam(section, p.Name)}
              lookups={lookups}
              onChange={(v) => onChange(setParam(section, p.Name, v))}
            />
          </Field>
        ))}
      </div>
    </>
  );
}

function AddSection({ types, onAdd }: { types: SectionTypeDef[]; onAdd: (type: SectionTypeDef) => void }) {
  const [choice, setChoice] = useState('');
  return (
    <div class="lmna-add">
      <select aria-label="Section type to add" value={choice} onChange={(e) => setChoice(inputValue(e))}>
        <option value="">Add a section…</option>
        {types.map((t) => (
          <option key={t.Type} value={t.Type}>
            {`Add ${t.DisplayName}`}
          </option>
        ))}
      </select>
      <button
        type="button"
        class="lmna-btn"
        disabled={!choice}
        onClick={() => {
          const type = types.find((t) => t.Type === choice);
          if (type) {
            onAdd(type);
            setChoice('');
          }
        }}
      >
        Add
      </button>
    </div>
  );
}
