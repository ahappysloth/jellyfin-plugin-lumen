import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Dropdown } from '../components/Dropdown';
import { Icon, defineIcons } from '../components/icons';
import { getLayout } from '../compat/jellyfin';
import type { LumenConfig, SectionDef, SectionParamDef, SectionTypeDef } from './adminApi';
import { canAdd, getParam, moveSectionTo, newSection, removeSection, setParam } from './configModel';
import { Card, Field, InfoTip, OptionSelect, inputValue } from './controls';
import type { Lookups } from './useAdminConfig';

/** Only this card draws these: Lucide's grip-vertical, its dots as one path (a 1-unit circle each, stroked). */
const ICONS = defineIcons({
  grip: 'M9 4a1 1 0 1 0 0 2 1 1 0 1 0 0-2M9 11a1 1 0 1 0 0 2 1 1 0 1 0 0-2M9 18a1 1 0 1 0 0 2 1 1 0 1 0 0-2M15 4a1 1 0 1 0 0 2 1 1 0 1 0 0-2M15 11a1 1 0 1 0 0 2 1 1 0 1 0 0-2M15 18a1 1 0 1 0 0 2 1 1 0 1 0 0-2',
});

/** A drag only starts once the pointer has moved this far, so a click or tap on the handle stays one. */
const DRAG_THRESHOLD = 4;
/** While dragging, the page scrolls when the pointer is this close to the window's top or bottom edge… */
const EDGE = 72;
/** …by up to this much a frame, faster the closer it is. */
const EDGE_SPEED = 18;

const typeName = (section: SectionDef, type: SectionTypeDef | undefined): string =>
  type?.DisplayName ?? `Unknown type: ${section.Type}`;
const sectionLabel = (section: SectionDef, type: SectionTypeDef | undefined): string =>
  section.Title || typeName(section, type);

/** The keys that end a move as Escape does: a TV remote's Back (webOS 461, Tizen 10009) and its names elsewhere. */
const isBackKey = (e: KeyboardEvent): boolean =>
  e.key === 'Escape' ||
  e.key === 'GoBack' ||
  e.key === 'BrowserBack' ||
  e.keyCode === 461 ||
  e.keyCode === 10009;

/** A pointer drag in progress: which section, where it was picked up, and where it would land now. */
interface Drag {
  id: string;
  from: number;
  /** Its index in the list it would make, or `from` while it's over its own place. */
  to: number;
  /** Where the drop line is, from the top of the list. */
  line: number;
}

/** What gets focus after the next render (a moved row's handle, the row after a removed one). */
interface PendingFocus {
  id: string;
  control: 'handle' | 'up' | 'down' | 'rename';
}

let cardCount = 0;

/**
 * The home screen's rows as a compact list: one line per section (its handle, name, what it shows, and its switch,
 * settings and remove buttons), its parameters under it when opened.
 *
 * Order: drag a row by its handle (mouse, pen or touch: pointer events). From the keyboard or a TV remote, Enter on the
 * handle picks the row up; the up and down arrows (or the ↑ ↓ buttons that show, for a tap or a screen reader) move it,
 * Enter puts it down, Escape (or Back) puts it back where it was. Each step is announced. Every change goes through
 * `update`, so the save bar and Discard see a row dragged away and back again as no change at all. While a save is in
 * flight (`busy`) `update` takes no changes, so rows don't move then: their move controls say so (aria-disabled), and
 * a move tried is answered "try again".
 */
export function HomeSectionsSettings({
  config,
  types,
  lookups,
  newId,
  update,
  busy = false,
}: {
  config: LumenConfig;
  types: SectionTypeDef[];
  lookups: Lookups;
  newId: () => string;
  update: (patch: Partial<LumenConfig>) => void;
  busy?: boolean;
}) {
  const sections = config.Sections;
  const [ids] = useState(() => `lmna-sections-${++cardCount}`);
  // Rows start closed; a section just added opens, to be set up.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // The row picked up from the keyboard, and where it was then (Escape puts it back).
  const [moving, setMoving] = useState<{ id: string; from: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [message, setMessage] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<PendingFocus | null>(null);
  // The latest list and pick-up, for listeners set up once (a drag's, the card's tap-elsewhere).
  const latest = useRef(sections);
  latest.current = sections;
  const movingRef = useRef(moving);
  movingRef.current = moving;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  // The section whose handle a drag just ended on: the pointer's click that follows isn't a click on the handle.
  const dragged = useRef('');
  // The drag in progress (its pointer still down, moved or not): how to end it, and how to only take it down.
  const dragging = useRef<{ finish: (commit: boolean) => void; teardown: () => void } | null>(null);

  // Unmounted mid-drag (Discard remounts the card): its window listeners go, and with them any way for it to change
  // the list. Its list is from before; dropped now, it would bring back what was discarded.
  useEffect(
    () => () => {
      dragging.current?.teardown();
    },
    [],
  );

  const typeOf = (section: SectionDef): SectionTypeDef | undefined =>
    types.find((t) => t.Type === section.Type);
  const labelOf = (section: SectionDef): string => sectionLabel(section, typeOf(section));
  const position = (index: number): string => `position ${index + 1} of ${sections.length}`;

  // A row that moves is taken out of the page and put back, and loses focus on the way: give it back.
  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    pendingFocus.current = null;
    const row = wrapRef.current?.querySelector(`[data-section-id="${pending.id}"]`);
    const target =
      row?.querySelector<HTMLElement>(`[data-control="${pending.control}"]:not(:disabled)`) ??
      row?.querySelector<HTMLElement>('[data-control="handle"]') ??
      wrapRef.current?.closest('.lmna-card')?.querySelector<HTMLElement>('.lmna-add button');
    if (target && document.activeElement !== target) target.focus();
  });

  // A pick-up ends when a tap or click lands outside its row. (Focus leaving it ends it too: SectionRow.)
  useEffect(() => {
    if (!moving) return undefined;
    const onDown = (e: Event): void => {
      const row = wrapRef.current?.querySelector(`[data-section-id="${moving.id}"]`);
      if (!row?.contains(e.target as Node)) drop();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [moving?.id]);

  /**
   * Says `text`, again if it's what was said last: a live region reads out a change, so the same words a second time
   * get a no-break space on the end (or lose it).
   */
  const sayAgain = (text: string): void => setMessage((said) => (said === text ? `${text}\u00a0` : text));

  const moveTo = (id: string, to: number, focus: PendingFocus['control']): void => {
    // Saving: the move wouldn't happen. Said so, once a press (a held key's repeats are let go: SectionRow).
    if (busy) {
      sayAgain('Saving, try again in a moment.');
      return;
    }
    const from = sections.findIndex((s) => s.Id === id);
    if (from < 0) return;
    const section = sections[from]!;
    const target = Math.max(0, Math.min(sections.length - 1, to));
    if (target === from) {
      setMessage(
        `${labelOf(section)} is already ${target === 0 ? 'at the top' : 'at the bottom'}, ${position(from)}.`,
      );
      return;
    }
    pendingFocus.current = { id, control: focus };
    update({ Sections: moveSectionTo(sections, from, target) });
    setMessage(`${labelOf(section)} moved to ${position(target)}.`);
  };

  const pickUp = (index: number): void => {
    if (busy) return;
    const section = sections[index]!;
    setMoving({ id: section.Id, from: index });
    setMessage(
      `${labelOf(section)} picked up, ${position(index)}. ` +
        'Use the up and down arrows to move it, Enter to put it down, Escape to cancel.',
    );
  };

  /** Puts the picked-up row down where it is. */
  const drop = (): void => {
    const current = movingRef.current;
    if (!current) return;
    setMoving(null);
    const list = latest.current;
    const index = list.findIndex((s) => s.Id === current.id);
    const section = list[index];
    if (section) setMessage(`${labelOf(section)} put down at position ${index + 1} of ${list.length}.`);
  };

  /** Puts the picked-up row back where it was picked up. */
  const cancelMove = (): void => {
    if (!moving) return;
    const index = sections.findIndex((s) => s.Id === moving.id);
    const section = sections[index];
    setMoving(null);
    if (!section) return;
    // Saving, it can't go back: it's put down where it is (and saved there).
    if (busy) {
      setMessage(`${labelOf(section)} put down at ${position(index)}.`);
      return;
    }
    if (index !== moving.from) {
      pendingFocus.current = { id: section.Id, control: 'handle' };
      update({ Sections: moveSectionTo(sections, index, moving.from) });
    }
    setMessage(`Move cancelled. ${labelOf(section)} is back at ${position(moving.from)}.`);
  };

  /**
   * A pointer went down on a row's handle. Once it has moved a few pixels this is a drag: the row follows the pointer,
   * a line shows where it would land, and the page scrolls near the window's edges. Letting go puts it there; Escape, a
   * cancelled pointer (the browser taking over the gesture) or the window losing the pointer (a mouse button let go
   * elsewhere: another window, a context menu) leaves the list as it was.
   */
  const startDrag = (e: PointerEvent, id: string): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (busy) return;
    const wrap = wrapRef.current;
    const row = (e.currentTarget as HTMLElement).closest<HTMLElement>('.lmna-section');
    if (!wrap || !row) return;
    // One drag at a time: a second finger on another handle ends the first, as it was.
    dragging.current?.finish(false);
    const from = latest.current.findIndex((s) => s.Id === id);
    const startY = e.clientY;
    // Where on the row it was grabbed, so the row keeps that point under the pointer.
    const grab = e.clientY - row.getBoundingClientRect().top;
    let y = e.clientY;
    let started = false;
    let done = false;
    let current: Drag = { id, from, to: from, line: 0 };
    let frame = 0;

    /** Rows other than the dragged one, in order. Their offsetTop is from the list's wrapper. */
    const others = (): HTMLElement[] =>
      Array.from(wrap.querySelectorAll<HTMLElement>('.lmna-section')).filter((r) => r !== row);

    /**
     * The row under the pointer; the rows between its place and where it would land slide over by a row, opening that
     * place. Where it lands is worked out from where the rows are without the sliding (past the middle of a row, it
     * goes beyond it), so the sliding never changes the answer under a still pointer.
     */
    const layout = (): void => {
      const top = wrap.getBoundingClientRect().top;
      row.style.transform = `translateY(${y - grab - (top + row.offsetTop)}px)`;
      const rest = others();
      let to = 0;
      while (to < rest.length && y - top >= rest[to]!.offsetTop + rest[to]!.offsetHeight / 2) to++;
      // The space between two rows (the second row's margin; not measured across the dragged row's place).
      const second = wrap.querySelectorAll<HTMLElement>('.lmna-section')[1];
      const gap = second ? parseFloat(getComputedStyle(second).marginTop) || 0 : 0;
      const room = row.offsetHeight + gap;
      rest.forEach((r, i) => {
        // Rows after it (from on) and before where it lands move up; rows from where it lands to it move down.
        const shift = i >= from && i < to ? -room : i >= to && i < from ? room : 0;
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      });
      // The line marks the top of the opened place: below the rows before it, as they end up.
      let line = rest.length ? Math.min(rest[0]!.offsetTop, row.offsetTop) : 0;
      for (let i = 0; i < to; i++) line += rest[i]!.offsetHeight + gap;
      line -= gap / 2;
      if (to !== current.to || line !== current.line) {
        current = { id, from, to, line };
        setDrag(current);
      }
    };

    // Near an edge, the page scrolls, faster the closer the pointer is; the row stays under it.
    const tick = (): void => {
      frame = 0;
      const height = window.innerHeight || document.documentElement.clientHeight;
      const speed =
        y < EDGE
          ? -Math.ceil(((EDGE - y) / EDGE) * EDGE_SPEED)
          : y > height - EDGE
            ? Math.ceil(((y - (height - EDGE)) / EDGE) * EDGE_SPEED)
            : 0;
      if (!speed) return;
      const scroller = scrollParent(wrap);
      const before = scroller ? scroller.scrollTop : window.pageYOffset;
      if (scroller) scroller.scrollTop += speed;
      else window.scrollBy(0, speed);
      const after = scroller ? scroller.scrollTop : window.pageYOffset;
      layout();
      if (after !== before) frame = requestAnimationFrame(tick);
    };

    const onMove = (ev: PointerEvent): void => {
      if (ev.pointerId !== e.pointerId) return;
      // A mouse moving with no button down was let go where this window couldn't see it (alt-tab, a context menu
      // taking the release): the drag is over, as it was. Otherwise it would follow the pointer until the next click.
      if (ev.pointerType === 'mouse' && ev.buttons === 0) {
        finish(false);
        return;
      }
      y = ev.clientY;
      if (!started) {
        if (Math.abs(y - startY) < DRAG_THRESHOLD) return;
        started = true;
        setMoving(null);
        document.documentElement.classList.add('lmna-dragging');
      }
      ev.preventDefault();
      layout();
      if (!frame) frame = requestAnimationFrame(tick);
    };

    /** Takes the drag down without touching the list: its listeners, its frame, the rows' offsets. */
    const teardown = (): void => {
      if (done) return;
      done = true;
      if (dragging.current?.teardown === teardown) dragging.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onLost);
      window.removeEventListener('contextmenu', onLost);
      cancelAnimationFrame(frame);
      if (!started) return;
      document.documentElement.classList.remove('lmna-dragging');
      row.style.transform = '';
      for (const r of others()) r.style.transform = '';
    };

    /** Ends the drag: `commit`, it lands where the line is (unless a save has started since); otherwise as it was. */
    const finish = (commit: boolean, released = false): void => {
      if (done) return;
      teardown();
      if (!started) return;
      suppressClick(id, released ? null : e.pointerId);
      setDrag(null);
      const list = latest.current;
      const index = list.findIndex((s) => s.Id === id);
      const section = list[index];
      if (!section) return;
      const label = sectionLabel(
        section,
        types.find((t) => t.Type === section.Type),
      );
      // Saving, `update` would take no change: it's put back rather than said to have moved.
      if (commit && !busyRef.current && current.to !== index) {
        // Moved, the row is taken out of the page and put back: focus goes back to its handle, as from the keyboard.
        pendingFocus.current = { id, control: 'handle' };
        update({ Sections: moveSectionTo(list, index, current.to) });
        setMessage(`${label} moved to position ${current.to + 1} of ${list.length}.`);
      } else if (!commit || current.to !== index) {
        setMessage(`Move cancelled. ${label} is back at position ${index + 1} of ${list.length}.`);
      }
    };
    const onUp = (ev: PointerEvent): void => {
      if (ev.pointerId === e.pointerId) finish(true, true);
    };
    const onCancel = (ev: PointerEvent): void => {
      if (ev.pointerId === e.pointerId) finish(false, true);
    };
    const onLost = (): void => finish(false);
    const onKey = (ev: KeyboardEvent): void => {
      if (!started || !isBackKey(ev)) return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    };
    dragging.current = { finish, teardown };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    // The window losing focus (alt-tab) takes the pointer with it. So does a mouse's context menu; a long press of a
    // finger may bring one too, but there it's the drag's own gesture.
    window.addEventListener('blur', onLost);
    if (e.pointerType === 'mouse') window.addEventListener('contextmenu', onLost);
  };

  /**
   * After a drag (dropped or cancelled), the click its pointer ends with isn't a click on the handle: it would pick the
   * row up. `pointerId` null: the pointer is up already, and the click is dispatched straight after. Otherwise (Escape,
   * the window losing the pointer) a pointer's click is ignored until that pointer goes up, or another one goes down.
   * Only a pointer's: the window lost the drag, its pointer may never come back, and Enter or Space on the handle
   * (a click with `detail` 0) is always a click.
   */
  const suppressClick = (id: string, pointerId: number | null): void => {
    dragged.current = id;
    const clear = (): void => {
      setTimeout(() => {
        if (dragged.current === id) dragged.current = '';
      });
    };
    if (pointerId === null) {
      clear();
      return;
    }
    const onEnd = (ev: PointerEvent): void => {
      if (ev.type === 'pointerup' && ev.pointerId !== pointerId) return;
      window.removeEventListener('pointerup', onEnd, true);
      window.removeEventListener('pointerdown', onEnd, true);
      if (ev.type === 'pointerdown') dragged.current = '';
      else clear();
    };
    window.addEventListener('pointerup', onEnd, true);
    window.addEventListener('pointerdown', onEnd, true);
  };

  const remove = (index: number): void => {
    const section = sections[index]!;
    const next = sections[index + 1] ?? sections[index - 1];
    // Focus goes on to the next row (the previous one at the end, the Add control when it was the last).
    pendingFocus.current = next ? { id: next.Id, control: 'handle' } : { id: '', control: 'handle' };
    if (moving?.id === section.Id) setMoving(null);
    update({ Sections: removeSection(sections, index) });
    setMessage(`${labelOf(section)} removed.`);
  };

  return (
    <Card
      title="Home sections"
      intro="Rows on the home screen, top to bottom. Each row adapts to the viewer. Drag a row by its handle to move it."
    >
      <span id={`${ids}-move-hint`} class="lmna-sr-only">
        Enter picks the row up; then the up and down arrows move it, Enter puts it down and Escape cancels.
      </span>
      <div ref={wrapRef} class={`lmna-sections-wrap${drag ? ' is-dragging' : ''}`}>
        <ol class="lmna-sections" aria-label="Home sections, in order">
          {sections.map((section, index) => (
            <SectionRow
              key={section.Id}
              section={section}
              type={typeOf(section)}
              index={index}
              count={sections.length}
              lookups={lookups}
              hintId={`${ids}-move-hint`}
              bodyId={`${ids}-body-${section.Id}`}
              open={!!open[section.Id]}
              moving={moving?.id === section.Id}
              dragging={drag?.id === section.Id}
              busy={busy}
              onToggleOpen={() => setOpen((o) => ({ ...o, [section.Id]: !o[section.Id] }))}
              onChange={(s) => update({ Sections: sections.map((x) => (x.Id === s.Id ? s : x)) })}
              onRemove={() => remove(index)}
              onPointerDown={(e) => startDrag(e, section.Id)}
              onHandleClick={(e) => {
                // `detail` 0: from the keyboard (or a screen reader), not the pointer a drag ended with.
                if (e.detail !== 0 && dragged.current === section.Id) return;
                if (moving?.id === section.Id) drop();
                else pickUp(index);
              }}
              onMove={(to, focus) => moveTo(section.Id, to, focus)}
              onCancelMove={cancelMove}
              onLeave={() => {
                if (moving?.id === section.Id) drop();
              }}
            />
          ))}
        </ol>
        {drag && drag.to !== drag.from && (
          <div class="lmna-sections__drop" style={{ top: `${drag.line}px` }} aria-hidden="true" />
        )}
      </div>
      <div class="lmna-sr-only" aria-live="assertive">
        {message}
      </div>
      <AddSection
        types={types}
        sections={sections}
        onAdd={(type) => {
          const added = newSection(type, newId());
          // Opened, to be set up (if it has anything to set).
          setOpen((o) => ({ ...o, [added.Id]: true }));
          update({ Sections: [...sections, added] });
          setMessage(
            `${type.DisplayName} added at position ${sections.length + 1} of ${sections.length + 1}.`,
          );
        }}
      />
    </Card>
  );
}

/** The element that scrolls the page around `el` (jellyfin-web's pages may scroll a container), or null for the window. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight)
      return node;
  }
  return null;
}

function SectionRow(props: {
  section: SectionDef;
  type: SectionTypeDef | undefined;
  index: number;
  count: number;
  lookups: Lookups;
  hintId: string;
  bodyId: string;
  open: boolean;
  moving: boolean;
  dragging: boolean;
  /** A save is in flight: the row can't be moved (its move controls are aria-disabled, still focusable). */
  busy: boolean;
  onToggleOpen: () => void;
  onChange: (section: SectionDef) => void;
  onRemove: () => void;
  onPointerDown: (e: PointerEvent) => void;
  onHandleClick: (e: MouseEvent) => void;
  onMove: (to: number, focus: PendingFocus['control']) => void;
  onCancelMove: () => void;
  onLeave: () => void;
}) {
  const { section, type, index, count, lookups, moving } = props;
  const name = typeName(section, type);
  const label = section.Title || name;
  const params = type?.Parameters ?? [];
  // On a TV every control is a D-pad stop, so the pencil shows all the time rather than appearing under focus.
  const tv = getLayout() === 'tv';

  /** In a picked-up row, the arrows move it and Escape (or a remote's Back) puts it back. */
  const onMoveKey = (e: KeyboardEvent, focus: PendingFocus['control']): void => {
    if (!moving || e.altKey || e.ctrlKey || e.metaKey) return;
    const to =
      e.key === 'ArrowUp'
        ? index - 1
        : e.key === 'ArrowDown'
          ? index + 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? count - 1
              : null;
    if (to === null && !isBackKey(e)) return;
    // Not on to jellyfin-web's D-pad navigation (on a TV) or the page's scrolling.
    e.preventDefault();
    e.stopPropagation();
    // Saving, a move is answered "try again": once for a held key, not for each of its repeats.
    if (props.busy && e.repeat && to !== null) return;
    if (to === null) props.onCancelMove();
    else props.onMove(to, focus);
  };

  return (
    <li
      class={`lmna-section${section.Enabled ? '' : ' is-disabled'}${props.open ? ' is-open' : ''}${moving ? ' is-moving' : ''}${props.dragging ? ' is-dragging' : ''}`}
      data-section-id={section.Id}
      // Tabbing (or the D-pad) out of a picked-up row puts it down. Focus that goes nowhere is the row being moved, or
      // Safari not focusing a tapped button: a tap elsewhere is seen to by the card.
      onFocusOut={(e) => {
        const to = (e as FocusEvent).relatedTarget as Node | null;
        if (moving && to && !(e.currentTarget as HTMLElement).contains(to)) props.onLeave();
      }}
    >
      <div class="lmna-section__head">
        <button
          type="button"
          class="lmna-section__handle"
          data-control="handle"
          aria-label={`Move ${label}`}
          aria-describedby={props.hintId}
          aria-pressed={moving}
          aria-disabled={props.busy || undefined}
          title="Drag to move, or press Enter"
          onPointerDown={props.onPointerDown}
          onClick={props.onHandleClick}
          onKeyDown={(e) => onMoveKey(e, 'handle')}
        >
          <Icon name={ICONS.grip} size={18} />
        </button>
        {moving && (
          <span class="lmna-section__steps">
            <button
              type="button"
              class="lmna-icon-btn"
              data-control="up"
              aria-label={`Move ${label} up`}
              title="Move up"
              disabled={index === 0}
              aria-disabled={props.busy || undefined}
              onClick={() => props.onMove(index - 1, 'up')}
              onKeyDown={(e) => onMoveKey(e, 'up')}
            >
              ↑
            </button>
            <button
              type="button"
              class="lmna-icon-btn"
              data-control="down"
              aria-label={`Move ${label} down`}
              title="Move down"
              disabled={index === count - 1}
              aria-disabled={props.busy || undefined}
              onClick={() => props.onMove(index + 1, 'down')}
              onKeyDown={(e) => onMoveKey(e, 'down')}
            >
              ↓
            </button>
          </span>
        )}
        <SectionName
          section={section}
          name={name}
          label={label}
          tv={tv}
          description={type?.Description}
          onRename={(title) => props.onChange({ ...section, Title: title })}
        />
        <label class="lmna-switch" title={section.Enabled ? 'Shown' : 'Hidden'}>
          <input
            type="checkbox"
            role="switch"
            aria-label={`Show ${label}`}
            checked={section.Enabled}
            onChange={(e) => props.onChange({ ...section, Enabled: (e.target as HTMLInputElement).checked })}
          />
        </label>
        {params.length > 0 ? (
          <button
            type="button"
            class="lmna-icon-btn lmna-section__expand"
            aria-label={`${label} settings`}
            aria-expanded={props.open}
            aria-controls={props.bodyId}
            title={props.open ? 'Hide settings' : 'Settings'}
            onClick={props.onToggleOpen}
          >
            <Icon name="chevronDown" size={18} />
          </button>
        ) : (
          // Rows line up: the remove buttons stay in one column.
          <span class="lmna-section__expand-gap" aria-hidden="true" />
        )}
        <button
          type="button"
          class="lmna-icon-btn lmna-icon-btn--danger"
          aria-label={`Remove ${label}`}
          title="Remove"
          onClick={props.onRemove}
        >
          ✕
        </button>
      </div>
      {params.length > 0 && (
        <div id={props.bodyId} class="lmna-section__body" hidden={!props.open}>
          {params.map((p) => (
            <Field key={p.Name} label={p.Required ? `${p.Label} *` : p.Label}>
              <ParamInput
                param={p}
                value={getParam(section, p.Name)}
                lookups={lookups}
                onChange={(v) => props.onChange(setParam(section, p.Name, v))}
              />
            </Field>
          ))}
        </div>
      )}
    </li>
  );
}

/**
 * A section's name (its own title, else its type's name, with the type under a title of its own), what the type shows
 * in an ⓘ tooltip, and a pencil to rename it in place. The pencil shows on hover or focus; on a touch screen (no
 * hover) once the name is tapped, so it takes no room from the names until then; on a TV, always. In the field, Enter or leaving it keeps the name, Escape drops the change, and an empty name
 * goes back to the type's.
 */
function SectionName(props: {
  section: SectionDef;
  name: string;
  label: string;
  tv: boolean;
  description: string | undefined;
  onRename: (title: string | null) => void;
}) {
  const { section, name, label } = props;
  const [editing, setEditing] = useState(false);
  // A touch screen's tap on the name: the pencil shows until a tap lands elsewhere.
  const [armed, setArmed] = useState(false);
  const [draft, setDraft] = useState('');
  const titleRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pencilRef = useRef<HTMLButtonElement>(null);
  // Set once Enter or Escape has settled the edit: the field's blur as it goes doesn't save again.
  const settled = useRef(false);
  const refocus = useRef(false);

  useLayoutEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (refocus.current) {
      refocus.current = false;
      pencilRef.current?.focus();
    }
  }, [editing]);

  useEffect(() => {
    if (!armed) return undefined;
    const onDown = (e: Event): void => {
      if (!titleRef.current?.contains(e.target as Node)) setArmed(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [armed]);

  const finish = (save: boolean, keepFocus: boolean): void => {
    if (settled.current) return;
    settled.current = true;
    if (save) {
      const title = draft.trim();
      props.onRename(title && title !== name ? title : null);
    }
    refocus.current = keepFocus;
    setArmed(false);
    setEditing(false);
  };

  if (editing) {
    return (
      <div class="lmna-section__title is-editing">
        <input
          ref={inputRef}
          type="text"
          class="lmna-section__rename-input"
          aria-label={`Name for ${name}`}
          placeholder={name}
          value={draft}
          onInput={(e) => setDraft(inputValue(e))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              finish(true, true);
            } else if (isBackKey(e)) {
              // The edit goes, and Escape goes no further.
              e.preventDefault();
              e.stopPropagation();
              finish(false, true);
            }
          }}
          onBlur={() => finish(true, false)}
        />
      </div>
    );
  }

  return (
    <div
      ref={titleRef}
      class={`lmna-section__title${props.tv ? ' is-tv' : ''}${armed ? ' is-armed' : ''}`}
      onPointerUp={(e) => {
        if (e.pointerType !== 'mouse' && !(e.target as Element).closest('button')) setArmed(true);
      }}
    >
      <span class="lmna-section__name">
        <span class="lmna-section__label">{label}</span>
        {section.Title && <small>{name}</small>}
      </span>
      {props.description && <InfoTip label={`About ${name}`} text={props.description} />}
      <button
        ref={pencilRef}
        type="button"
        class="lmna-icon-btn lmna-section__rename"
        data-control="rename"
        aria-label={`Rename ${label}`}
        title="Rename"
        onClick={() => {
          settled.current = false;
          setDraft(section.Title ?? '');
          setEditing(true);
        }}
      >
        <Icon name="edit" size={15} />
      </button>
    </div>
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

/**
 * Picks a section type to add. A type that's only useful once (see isRepeatable) shows as "(already added)" and can't
 * be picked while it's in the list. Configs saved with duplicates from before still load and edit as they are.
 */
function AddSection({
  types,
  sections,
  onAdd,
}: {
  types: SectionTypeDef[];
  sections: SectionDef[];
  onAdd: (type: SectionTypeDef) => void;
}) {
  const [picked, setPicked] = useState('');
  const pickedType = types.find((t) => t.Type === picked);
  // A pending choice of a type that's since come back into the list (Discard restoring it) no longer stands.
  const choice = pickedType && canAdd(pickedType, sections) ? picked : '';
  return (
    <div class="lmna-add">
      <Dropdown
        label="Section type to add"
        hideLabel
        value={choice}
        options={[
          { value: '', label: 'Choose a section to add…' },
          ...types.map((t) =>
            canAdd(t, sections)
              ? { value: t.Type, label: t.DisplayName }
              : { value: t.Type, label: `${t.DisplayName} (already added)`, disabled: true },
          ),
        ]}
        onChange={setPicked}
      />
      <button
        type="button"
        class="lmna-btn"
        disabled={!choice}
        onClick={() => {
          if (choice && pickedType) {
            onAdd(pickedType);
            setPicked('');
          }
        }}
      >
        <Icon name="plus" size={16} />
        Add
      </button>
      {choice && <p class="lmna-add__about">{pickedType?.Description}</p>}
    </div>
  );
}
