import type { ComponentChildren } from 'preact';
import { formatNumber } from '../../util/locale';

export interface Option<T extends string> {
  value: T;
  label: string;
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
          class={`lmn-chip${o.value === value ? ' is-active lmn-autofocus' : ''}`}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined && <span class="lmn-chip__count">{formatNumber(o.count)}</span>}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({
  title,
  meta,
  tabs,
  children,
}: {
  title: string;
  meta?: string;
  /** A row of section links under the title (a library's tabs). */
  tabs?: ComponentChildren;
  children?: ComponentChildren;
}) {
  return (
    <header class="lmn-browse__header">
      <div class="lmn-browse__heading">
        <h1 class="lmn-browse__title">{title}</h1>
        {meta && <p class="lmn-browse__meta">{meta}</p>}
      </div>
      {tabs && <div class="lmn-browse__tabs">{tabs}</div>}
      {children && <div class="lmn-browse__toolbar">{children}</div>}
    </header>
  );
}
