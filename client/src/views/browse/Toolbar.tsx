import type { ComponentChildren } from 'preact';
import { Icon } from '../../components/icons';

export interface Option<T extends string> {
  value: T;
  label: string;
}

/** A native select (best on phones and TVs) dressed as a pill. */
export function SelectPill<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <label class="lmn-select">
      <span class="lmn-select__label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.currentTarget.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={14} class="lmn-select__chevron" />
    </label>
  );
}

/** Mutually exclusive chips, e.g. All / Unwatched / Watched. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (Option<T> & { count?: number })[];
  onChange: (value: T) => void;
}) {
  return (
    <div class="lmn-segmented focuscontainer-x" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          class={`lmn-chip${o.value === value ? ' is-active' : ''}`}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined && <span class="lmn-chip__count">{o.count.toLocaleString()}</span>}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children?: ComponentChildren;
}) {
  return (
    <header class="lmn-browse__header">
      <div class="lmn-browse__heading">
        <h1 class="lmn-browse__title">{title}</h1>
        {meta && <p class="lmn-browse__meta">{meta}</p>}
      </div>
      {children && <div class="lmn-browse__toolbar">{children}</div>}
    </header>
  );
}
