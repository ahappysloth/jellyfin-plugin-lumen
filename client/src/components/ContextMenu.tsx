import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { isBackKey } from '../compat/jellyfin';
import { Icon, type IconName } from './icons';

export interface MenuEntry {
  label: string;
  icon: IconName;
  onSelect: () => void;
  /** A second, quieter line (e.g. who is in a group). */
  detail?: string;
}

interface OpenMenu {
  entries: MenuEntry[];
  x: number;
  y: number;
  /** Where focus goes back to on close. */
  returnFocus: HTMLElement | null;
  /** For screen readers: what the menu is about. */
  label: string;
  /** Shown above the entries (not focusable). */
  title?: string;
  subtitle?: string;
}

type Listener = (menu: OpenMenu | null) => void;
let listener: Listener | null = null;

/** Shows the menu at a viewport point. One menu at a time; the host must be mounted (see App). */
export function openContextMenu(menu: OpenMenu): void {
  listener?.(menu);
}

export function closeContextMenu(): void {
  listener?.(null);
}

const MARGIN = 8;

/** Renders the open context menu. Closes on Escape or Back, an outside press, scroll, resize, or blur. */
export function ContextMenuHost() {
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listener = (next) => {
      setActive(0);
      setMenu(next);
    };
    return () => {
      listener = null;
    };
  }, []);

  const close = (refocus: boolean): void => {
    if (refocus) menu?.returnFocus?.focus({ preventScroll: true });
    setMenu(null);
  };

  // Keep the menu on screen: flip left/up when it would overflow.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!menu || !el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = menu.x + width + MARGIN > window.innerWidth ? Math.max(MARGIN, menu.x - width) : menu.x;
    const top = menu.y + height + MARGIN > window.innerHeight ? Math.max(MARGIN, menu.y - height) : menu.y;
    setPos({ left, top });
  }, [menu]);
  // Focus follows the highlighted item, so screen readers announce it.
  useEffect(() => {
    ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')[active]?.focus({ preventScroll: true });
  }, [menu, active]);

  useEffect(() => {
    if (!menu) return;
    const onPointer = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) close(false);
    };
    const onDismiss = (): void => close(false);
    document.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('scroll', onDismiss, { passive: true, capture: true });
    window.addEventListener('resize', onDismiss);
    window.addEventListener('blur', onDismiss);
    window.addEventListener('hashchange', onDismiss);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('scroll', onDismiss, { capture: true });
      window.removeEventListener('resize', onDismiss);
      window.removeEventListener('blur', onDismiss);
      window.removeEventListener('hashchange', onDismiss);
    };
  }, [menu]);

  if (!menu) return null;
  const last = menu.entries.length - 1;
  const choose = (entry: MenuEntry): void => {
    close(true);
    entry.onSelect();
  };

  return (
    <div
      ref={ref}
      class="lmn-menu"
      role="menu"
      aria-label={menu.label}
      tabIndex={-1}
      style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        const keys: Record<string, () => void> = {
          ArrowDown: () => setActive((i) => (i >= last ? 0 : i + 1)),
          ArrowUp: () => setActive((i) => (i <= 0 ? last : i - 1)),
          Home: () => setActive(0),
          End: () => setActive(last),
          Enter: () => choose(menu.entries[active]!),
          ' ': () => choose(menu.entries[active]!),
          Tab: () => close(true),
        };
        const action = isBackKey(e) ? () => close(true) : keys[e.key];
        if (!action) return;
        e.preventDefault();
        e.stopPropagation();
        action();
      }}
    >
      {menu.title && (
        <div class="lmn-menu__header">
          <span class="lmn-menu__title">{menu.title}</span>
          {menu.subtitle && <span class="lmn-menu__subtitle">{menu.subtitle}</span>}
        </div>
      )}
      {menu.entries.map((entry, i) => (
        <button
          key={`${i}:${entry.label}`}
          type="button"
          role="menuitem"
          tabIndex={-1}
          class={`lmn-menu__item${i === active ? ' is-active' : ''}`}
          onPointerMove={() => setActive(i)}
          onClick={() => choose(entry)}
        >
          <Icon name={entry.icon} size={16} />
          {entry.detail ? (
            <span class="lmn-menu__text">
              {entry.label}
              <span class="lmn-menu__detail">{entry.detail}</span>
            </span>
          ) : (
            entry.label
          )}
        </button>
      ))}
    </div>
  );
}
