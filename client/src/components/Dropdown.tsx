import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { getLayout, isBackKey } from '../compat/jellyfin';
import { Icon } from './icons';

/** Space kept between an open list and the edge of the screen. */
const VIEWPORT_MARGIN = 8;

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  /** Shown, but can't be picked: the arrows, Home/End and type-ahead pass over it (aria-disabled). */
  disabled?: boolean;
}

interface Props<T extends string> {
  /** Accessible name; also shown before the value unless `hideLabel`. */
  label: string;
  hideLabel?: boolean;
  value: T;
  options: readonly DropdownOption<T>[];
  onChange: (value: T) => void;
  class?: string;
  disabled?: boolean;
}

/**
 * A select replacement styled for Lumen: a pill button that opens a floating listbox. Keyboard: Up/Down/Home/End move,
 * Enter/Space pick, Escape (or a TV remote's Back)/Tab close, and typing jumps to the first option starting with those letters.
 * Disabled options are skipped by all of these, and a click on one does nothing.
 */
export function Dropdown<T extends string>({
  label,
  hideLabel,
  value,
  options,
  onChange,
  class: extra,
  disabled,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState<'down' | 'up'>('down');
  /** Which edge of the button the list lines up with: whichever keeps it on screen. */
  const [align, setAlign] = useState<'start' | 'end'>('start');
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const id = useId();
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const selected = options[selectedIndex];

  const openList = (): void => {
    if (disabled) return;
    setActive(selectedIndex);
    setOpen(true);
  };
  const close = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) button.current?.focus({ preventScroll: true });
  };
  const pick = (index: number): void => {
    const option = options[index];
    if (option?.disabled) return;
    close(true);
    if (option && option.value !== value) onChange(option.value);
  };

  // Open upward when there's no room below; keep the active option in view.
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const rect = button.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    setPlacement(below < 280 && rect.top > below ? 'up' : 'down');
    const width = list.current?.offsetWidth ?? 0;
    setAlign(
      rect.left + width > window.innerWidth - VIEWPORT_MARGIN && rect.right - width >= VIEWPORT_MARGIN
        ? 'end'
        : 'start',
    );
    list.current?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent): void => {
      if (!root.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onPointer, true);
    return () => document.removeEventListener('pointerdown', onPointer, true);
  }, [open]);

  /** The nearest option from `from` (itself included) that can be picked, stepping by `step`; or `fallback`. */
  const enabled = (from: number, step: 1 | -1, fallback: number): number => {
    for (let i = from; i >= 0 && i < options.length; i += step) if (!options[i]!.disabled) return i;
    return fallback;
  };
  const onListKey = (e: KeyboardEvent): void => {
    const last = options.length - 1;
    if (isBackKey(e)) {
      close(true);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        setActive((i) => enabled(i + 1, 1, i));
        break;
      case 'ArrowUp':
        setActive((i) => enabled(i - 1, -1, i));
        break;
      case 'Home':
        setActive((i) => enabled(0, 1, i));
        break;
      case 'End':
        setActive((i) => enabled(last, -1, i));
        break;
      case 'Enter':
      case ' ':
        pick(active);
        break;
      case 'Tab':
        close(false);
        return;
      default: {
        if (e.key.length !== 1) return;
        const now = Date.now();
        const text = (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase();
        typed.current = { text, at: now };
        const match = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(text));
        if (match >= 0) setActive(match);
      }
    }
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div ref={root} class={`lmn-dropdown${open ? ' is-open' : ''}${extra ? ` ${extra}` : ''}`}>
      <button
        ref={button}
        type="button"
        class="lmn-dropdown__button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        // Its name reads as it shows (WCAG 2.5.3): "Genre All genres", or "Season: Season 1" when only the value shows.
        aria-label={`${label}${hideLabel ? ':' : ''} ${selected?.label ?? ''}`}
        disabled={disabled}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={(e) => {
          // On a TV, Up and Down move between controls (OK opens the list): opening on them would trap the D-pad here.
          if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && getLayout(document) !== 'tv') {
            e.preventDefault();
            openList();
          }
        }}
      >
        {!hideLabel && <span class="lmn-dropdown__label">{label}</span>}
        {/* Reads "Genre All genres", not "GenreAll genres" (the flex layout ignores the space). */}{' '}
        <span class="lmn-dropdown__value">{selected?.label}</span>
        <Icon name="chevronDown" size={16} class="lmn-dropdown__chevron" />
      </button>
      {open && (
        <ul
          ref={list}
          id={`${id}-list`}
          class={`lmn-dropdown__list lmn-dropdown__list--${placement} lmn-dropdown__list--${align}`}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          aria-activedescendant={`${id}-${active}`}
          onKeyDown={onListKey}
        >
          {options.map((option, i) => (
            <li
              key={option.value}
              id={`${id}-${i}`}
              data-index={i}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              class={`lmn-dropdown__option${i === active ? ' is-active' : ''}`}
              onPointerMove={() => !option.disabled && setActive(i)}
              onClick={(e) => {
                // Inside a <label> (the admin page's fields), the click would also re-click the button.
                e.preventDefault();
                pick(i);
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <Icon name="check" size={18} class="lmn-dropdown__check" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
