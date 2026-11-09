import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './icons';

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  /** Accessible name; also shown before the value unless `hideLabel`. */
  label: string;
  hideLabel?: boolean;
  value: T;
  options: readonly DropdownOption<T>[];
  onChange: (value: T) => void;
  class?: string;
}

/**
 * A select replacement styled for Lumen: a pill button that opens a floating listbox. Keyboard: Up/Down/Home/End move,
 * Enter/Space pick, Escape/Tab close, and typing jumps to the first option starting with those letters.
 */
export function Dropdown<T extends string>({
  label,
  hideLabel,
  value,
  options,
  onChange,
  class: extra,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState<'down' | 'up'>('down');
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
    setActive(selectedIndex);
    setOpen(true);
  };
  const close = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) button.current?.focus({ preventScroll: true });
  };
  const pick = (index: number): void => {
    const option = options[index];
    close(true);
    if (option && option.value !== value) onChange(option.value);
  };

  // Open upward when there's no room below; keep the active option in view.
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const rect = button.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    setPlacement(below < 280 && rect.top > below ? 'up' : 'down');
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

  const onListKey = (e: KeyboardEvent): void => {
    const last = options.length - 1;
    switch (e.key) {
      case 'ArrowDown':
        setActive((i) => Math.min(last, i + 1));
        break;
      case 'ArrowUp':
        setActive((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        setActive(0);
        break;
      case 'End':
        setActive(last);
        break;
      case 'Enter':
      case ' ':
        pick(active);
        break;
      case 'Escape':
        close(true);
        break;
      case 'Tab':
        close(false);
        return;
      default: {
        if (e.key.length !== 1) return;
        const now = Date.now();
        const text = (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase();
        typed.current = { text, at: now };
        const match = options.findIndex((o) => o.label.toLowerCase().startsWith(text));
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
        aria-label={`${label}: ${selected?.label ?? ''}`}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            openList();
          }
        }}
      >
        {!hideLabel && <span class="lmn-dropdown__label">{label}</span>}
        <span class="lmn-dropdown__value">{selected?.label}</span>
        <Icon name="chevronDown" size={14} class="lmn-dropdown__chevron" />
      </button>
      {open && (
        <ul
          ref={list}
          id={`${id}-list`}
          class={`lmn-dropdown__list lmn-dropdown__list--${placement}`}
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
              class={`lmn-dropdown__option${i === active ? ' is-active' : ''}`}
              onPointerMove={() => setActive(i)}
              onClick={(e) => {
                // Inside a <label> (the admin page's fields), the click would also re-click the button.
                e.preventDefault();
                pick(i);
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <Icon name="check" size={16} class="lmn-dropdown__check" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
