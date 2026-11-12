import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { Dropdown } from '../components/Dropdown';
import { Icon } from '../components/icons';
import type { LumenConfig, SectionDef, SectionParamDef, SectionTypeDef } from './adminApi';
import { getParam, moveSection, newSection, removeSection, setParam } from './configModel';
import { Card, Field, OptionSelect, inputValue } from './controls';
import type { Lookups } from './useAdminConfig';

const sectionLabel = (section: SectionDef, types: SectionTypeDef[]): string =>
  section.Title || types.find((t) => t.Type === section.Type)?.DisplayName || section.Type;

export function HomeSectionsSettings({
  config,
  types,
  lookups,
  newId,
  update,
}: {
  config: LumenConfig;
  types: SectionTypeDef[];
  lookups: Lookups;
  newId: () => string;
  update: (patch: Partial<LumenConfig>) => void;
}) {
  const updateSection = (index: number, section: SectionDef): void =>
    update({ Sections: config.Sections.map((s, i) => (i === index ? section : s)) });
  return (
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
    return (
      <OptionSelect label={param.Label} options={lookups[param.Kind]} value={value} onChange={onChange} />
    );
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
      {type?.Description && (
        <p class="lmna-section__about">
          <Icon name="info" size={16} />
          {type.Description}
        </p>
      )}
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
      <Dropdown
        label="Section type to add"
        hideLabel
        value={choice}
        options={[
          { value: '', label: 'Choose a section to add…' },
          ...types.map((t) => ({ value: t.Type, label: t.DisplayName })),
        ]}
        onChange={setChoice}
      />
      {choice && <p class="lmna-add__about">{types.find((t) => t.Type === choice)?.Description}</p>}
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
