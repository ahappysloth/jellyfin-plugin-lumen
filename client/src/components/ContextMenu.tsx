import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { isBackKey } from '../compat/jellyfin';
import { onNavigate } from '../takeover/navigation';
import { Icon, type IconRef } from './icons';

export interface MenuEntry {
  label: string;
  icon: IconRef;
  onSelect: () => void;
  /** A second, quieter line (e.g. who is in a group). */
  detail?: string;
  /** Starts a new group: a line above it. */
  separated?: boolean;
}

interface OpenMenu {
  entries: MenuEntry[];
  x: number;
  y: number;
  /** Where focus goes back to on close. */
  returnFocus: HTMLElement | null;
  /**
   * The button it opened from, if any. The menu then opens under it, or above it, or ending at its right edge, when it
   * wouldn't fit, rather than over it, and follows it if the page scrolls (in the TV layout jellyfin-web scrolls a
   * button that's clicked into view, just as the menu opens), where a menu opened at a point closes.
   */
  anchor?: HTMLElement;
  /** For screen readers: what the menu is about. */
  label: string;
  /** Shown above the entries (not focusable). */
  title?: string;
  subtitle?: string;
  /** Once it has closed, however that happened (including another menu opening in its place). */
  onClose?: () => void;
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
/** Between a button and the menu it opened. */
const ANCHOR_GAP = 6;

/** Renders the open context menu. Closes on Escape or Back, an outside press, scroll, resize, blur, or a page change. */
export function ContextMenuHost() {
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const shown = useRef<OpenMenu | null>(null);
  const show = (next: OpenMenu | null): void => {
    const previous = shown.current;
    shown.current = next;
    setActive(0);
    setMenu(next);
    if (previous && previous !== next) previous.onClose?.();
  };
  useEffect(() => {
    listener = show;
    return () => {
      listener = null;
    };
  }, []);

  const close = (refocus: boolean): void => {
    if (refocus) menu?.returnFocus?.focus({ preventScroll: true });
    show(null);
  };

  // Keep the menu on screen: flip left/up when it would overflow.
  const place = (): void => {
    const el = ref.current;
    if (!menu || !el) return;
    const { width, height } = el.getBoundingClientRect();
    const box = menu.anchor?.getBoundingClientRect();
    const x = box ? box.left : menu.x;
    const y = box ? box.bottom + ANCHOR_GAP : menu.y;
    const left = x + width + MARGIN > window.innerWidth ? Math.max(MARGIN, (box ? box.right : x) - width) : x;
    const top =
      y + height + MARGIN > window.innerHeight
        ? Math.max(MARGIN, (box ? box.top - ANCHOR_GAP : y) - height)
        : y;
    setPos({ left, top });
  };
  useLayoutEffect(place, [menu]);
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
    const onScroll = (e: Event): void => {
      if (e.target instanceof Node && ref.current?.contains(e.target)) return; // a long menu scrolling its items
      if (menu.anchor) place();
      else close(false);
    };
    document.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', onDismiss);
    window.addEventListener('blur', onDismiss);
    // jellyfin-web's pushState as well as a hash change: an entry chosen after the page changed would act on a title
    // that is gone.
    const stopNavigation = onNavigate(onDismiss);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', onDismiss);
      window.removeEventListener('blur', onDismiss);
      stopNavigation();
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
          class={`lmn-menu__item${i === active ? ' is-active' : ''}${entry.separated && i > 0 ? ' lmn-menu__item--separated' : ''}`}
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
