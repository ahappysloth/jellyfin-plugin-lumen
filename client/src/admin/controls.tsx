import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Dropdown } from '../components/Dropdown';
import { Icon } from '../components/icons';
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

/** How far a tooltip keeps from the window's edges, and from what it points at. */
export const TIP_MARGIN = 8;

/**
 * Puts a tooltip (.lmna-tip, positioned in `wrap`) over `anchor` and inside the window: shifted in from an edge (its
 * arrow still points at the anchor), and under it when there's no room above.
 */
export function placeTip(tip: HTMLElement, wrap: HTMLElement, anchor: DOMRect): void {
  const box = wrap.getBoundingClientRect();
  const width = tip.offsetWidth;
  const viewport = document.documentElement.clientWidth || window.innerWidth;
  const centre = (anchor.left + anchor.right) / 2;
  const left = Math.max(TIP_MARGIN, Math.min(centre - width / 2, viewport - TIP_MARGIN - width));
  tip.style.left = `${left - box.left}px`;
  tip.style.setProperty('--tip-arrow', `${Math.max(10, Math.min(width - 10, centre - left))}px`);
  tip.classList.toggle('is-below', anchor.top - tip.offsetHeight - TIP_MARGIN < 0);
}

let infoTipId = 0;

/**
 * An ⓘ button with a tooltip, as the Storage card's bars have: pointing at it shows the tooltip, tapping it on a touch
 * screen shows or hides it (tapping elsewhere hides it), and so does focusing it from the keyboard or a TV's D-pad
 * (Enter toggles it, Escape hides it). The text is the button's description, so a screen reader reads it either way.
 */
export function InfoTip({ label, text }: { label: string; text: string }) {
  const [id] = useState(() => `lmna-info-${++infoTipId}`);
  const [shown, setShown] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  // The pointer that last went down on it: a touch toggles the tooltip, a mouse only points.
  const pointer = useRef('');

  // Tapped elsewhere: hidden.
  useEffect(() => {
    if (!shown) return undefined;
    const onDown = (e: Event): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setShown(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [shown]);

  useLayoutEffect(() => {
    const tip = tipRef.current;
    const wrap = wrapRef.current;
    const button = buttonRef.current;
    if (shown && tip && wrap && button) placeTip(tip, wrap, button.getBoundingClientRect());
  }, [shown]);

  return (
    <span ref={wrapRef} class="lmna-info">
      <button
        ref={buttonRef}
        type="button"
        class="lmna-icon-btn lmna-info__button"
        aria-label={label}
        aria-describedby={id}
        onPointerDown={(e) => {
          pointer.current = e.pointerType;
        }}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') setShown(true);
        }}
        onPointerLeave={(e) => {
          // Shown from the keyboard, it stays up; only pointed at, it goes with the pointer.
          const fromKeys = document.activeElement === buttonRef.current && !pointer.current;
          if (e.pointerType === 'mouse' && !fromKeys) setShown(false);
        }}
        // A tap toggles on release: a swipe that starts on it turns into a scroll (pointercancel, no pointerup).
        onPointerUp={(e) => {
          if (e.pointerType !== 'mouse') setShown((s) => !s);
        }}
        // Enter, Space or a remote's OK (a click with no pointer behind it).
        onClick={(e) => {
          if (e.detail === 0 && !pointer.current) setShown((s) => !s);
        }}
        onFocus={() => {
          if (!pointer.current) setShown(true);
        }}
        onBlur={() => {
          pointer.current = '';
          setShown(false);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Escape' || !shown) return;
          // The tooltip goes, and Escape goes no further (a dialog round the page would close).
          e.preventDefault();
          e.stopPropagation();
          setShown(false);
        }}
      >
        <Icon name="info" size={16} />
      </button>
      <span ref={tipRef} id={id} role="tooltip" class="lmna-tip lmna-info__tip" hidden={!shown}>
        {text}
      </span>
    </span>
  );
}
