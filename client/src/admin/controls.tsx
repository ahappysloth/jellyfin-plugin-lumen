import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Dropdown } from '../components/Dropdown';
import type { Option } from './adminApi';
import { normalizeId } from './configModel';

/** Shared building blocks of the settings page: cards, labelled fields, switches and pickers. */

export const inputValue = (event: Event): string =>
  (event.target as HTMLInputElement | HTMLSelectElement).value;

export function Card({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ComponentChildren;
}) {
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
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ComponentChildren;
}) {
  const [hintId] = useState(() => `lmn-hint-${++fieldHintId}`);
  const labelRef = useRef<HTMLLabelElement>(null);
  useEffect(() => {
    const control = labelRef.current?.querySelector('input, select, button');
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

export function Switch({
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

export function NumberField(props: {
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

export function OptionSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
}) {
  const selected = options.find((o) => normalizeId(o.id) === normalizeId(value))?.id ?? '';
  return (
    <Dropdown
      label={label}
      hideLabel
      value={selected}
      options={[{ value: '', label: '(none)' }, ...options.map((o) => ({ value: o.id, label: o.name }))]}
      onChange={onChange}
    />
  );
}
