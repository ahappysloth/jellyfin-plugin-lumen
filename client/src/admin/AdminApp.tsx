import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type {
  AdminApi,
  DiagnosticEntry,
  LumenConfig,
  Option,
  SectionDef,
  SectionParamDef,
  SectionTypeDef,
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
    <form class="lmn-admin" onSubmit={(e) => void save(e)}>
      {errors.length > 0 && (
        <div class="lmn-admin__errors" role="alert">
          <h3>Please fix these problems</h3>
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <fieldset>
        <legend>General</legend>
        <Checkbox label="Enable Lumen" checked={config.Enabled} onChange={(v) => update({ Enabled: v })} />
        <Checkbox
          label="Replace the home screen"
          checked={config.HomeTakeover}
          onChange={(v) => update({ HomeTakeover: v })}
        />
        <Checkbox
          label="Replace movie and series details pages"
          checked={config.DetailsTakeover}
          onChange={(v) => update({ DetailsTakeover: v })}
        />
        <Field label="Accent color">
          <input
            type="color"
            value={config.AccentColor}
            onInput={(e) => update({ AccentColor: inputValue(e) })}
          />
        </Field>
      </fieldset>

      <fieldset>
        <legend>Hero banner</legend>
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
        <Checkbox
          label="Play muted trailer previews (local trailers only)"
          checked={config.TrailerPreview}
          onChange={(v) => update({ TrailerPreview: v })}
        />
        <NumberField
          label="Seconds before the trailer starts"
          value={config.TrailerDelaySeconds}
          min={0}
          max={30}
          onChange={(v) => update({ TrailerDelaySeconds: v })}
        />
      </fieldset>

      <fieldset>
        <legend>Home sections</legend>
        <ol class="lmn-admin__sections">
          {config.Sections.map((section, index) => (
            <li key={section.Id} class="lmn-admin__section">
              <SectionEditor
                section={section}
                type={types.find((t) => t.Type === section.Type)}
                lookups={lookups}
                onChange={(s) => updateSection(index, s)}
              />
              <div class="lmn-admin__section-actions">
                <button
                  type="button"
                  class="emby-button"
                  aria-label={`Move ${sectionLabel(section, types)} up`}
                  disabled={index === 0}
                  onClick={() => update({ Sections: moveSection(config.Sections, index, -1) })}
                >
                  ↑
                </button>
                <button
                  type="button"
                  class="emby-button"
                  aria-label={`Move ${sectionLabel(section, types)} down`}
                  disabled={index === config.Sections.length - 1}
                  onClick={() => update({ Sections: moveSection(config.Sections, index, 1) })}
                >
                  ↓
                </button>
                <button
                  type="button"
                  class="emby-button"
                  aria-label={`Remove ${sectionLabel(section, types)}`}
                  onClick={() => update({ Sections: removeSection(config.Sections, index) })}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ol>
        <AddSection
          types={types}
          onAdd={(type) => update({ Sections: [...config.Sections, newSection(type, newId())] })}
        />
      </fieldset>

      <fieldset>
        <legend>Diagnostics</legend>
        {diagnostics.length === 0 ? (
          <p>No compatibility problems reported.</p>
        ) : (
          <table class="lmn-admin__diagnostics">
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
      </fieldset>

      <div class="lmn-admin__footer">
        <button type="submit" class="raised button-submit block emby-button" disabled={status === 'saving'}>
          Save
        </button>
        <button type="button" class="raised block emby-button" onClick={() => void reset()}>
          Reset to defaults
        </button>
        {status === 'saved' && <p role="status">Settings saved.</p>}
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <label class="inputContainer lmn-admin__field">
      <span class="inputLabel">{label}</span>
      {children}
    </label>
  );
}

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label class="checkboxContainer lmn-admin__checkbox">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
      />
      <span>{label}</span>
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
}) {
  const { section, type, lookups, onChange } = props;
  return (
    <div class="lmn-admin__section-body">
      <strong>{type?.DisplayName ?? `Unknown type: ${section.Type}`}</strong>
      <Checkbox
        label="Enabled"
        checked={section.Enabled}
        onChange={(v) => onChange({ ...section, Enabled: v })}
      />
      <Field label="Title (optional)">
        <input
          type="text"
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
  );
}

function AddSection({ types, onAdd }: { types: SectionTypeDef[]; onAdd: (type: SectionTypeDef) => void }) {
  const [choice, setChoice] = useState('');
  return (
    <div class="lmn-admin__add">
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
        class="emby-button"
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
