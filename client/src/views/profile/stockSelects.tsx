import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Dropdown } from '../../components/Dropdown';

/**
 * Lumen's dropdown over jellyfin-web's own `<select is="emby-select">` on the restyled settings pages. The native
 * select stays in the DOM, hidden, and remains the source of truth: picking an option sets its value and fires the
 * `change` event jellyfin-web listens for, and values jellyfin-web sets (when it loads saved settings) flow back into
 * the dropdown. MUI selects (the Display page) are restyled by CSS instead (stock-skin.css).
 */
const ENHANCED = 'data-lmn-enhanced';
const HIDDEN = 'lmn-hidden-select';
const SELECTOR = 'select.emby-select, select[is="emby-select"]';

type Listener = () => void;

/** Notifies when the select's value is set from script (no event fires for that) by wrapping its own setters. */
function watchValue(select: HTMLSelectElement, onChange: Listener): () => void {
  const restore: string[] = [];
  for (const prop of ['value', 'selectedIndex'] as const) {
    let proto: object | null = Object.getPrototypeOf(select);
    let descriptor: PropertyDescriptor | undefined;
    while (proto && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(proto, prop);
      proto = Object.getPrototypeOf(proto);
    }
    if (!descriptor?.get || !descriptor.set) continue;
    const { get, set } = descriptor;
    Object.defineProperty(select, prop, {
      configurable: true,
      get() {
        return get.call(this);
      },
      set(v: unknown) {
        set.call(this, v);
        onChange();
      },
    });
    restore.push(prop);
  }
  // Options added or removed, or option.selected toggled, also change what the dropdown shows.
  const observer = new MutationObserver(onChange);
  observer.observe(select, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['selected', 'disabled'],
  });
  select.addEventListener('change', onChange);
  return () => {
    observer.disconnect();
    select.removeEventListener('change', onChange);
    for (const prop of restore) Reflect.deleteProperty(select, prop);
  };
}

function labelFor(select: HTMLSelectElement): string {
  const byFor = select.id
    ? select.ownerDocument.querySelector(`label[for="${CSS.escape(select.id)}"]`)
    : null;
  return (
    byFor?.textContent ??
    select.getAttribute('label') ??
    select.getAttribute('aria-label') ??
    ''
  ).trim();
}

function StockSelect({ select }: { select: HTMLSelectElement }) {
  const [, bump] = useState(0);
  useEffect(() => watchValue(select, () => bump((n) => n + 1)), [select]);

  const options = Array.from(select.options)
    .filter((o) => !o.disabled || o.selected)
    .map((o) => ({ value: o.value, label: o.textContent?.trim() || o.value }));
  if (options.length === 0) return null;
  return (
    <Dropdown
      label={labelFor(select)}
      hideLabel
      // A disabled <select> (or one in a disabled fieldset) can't be changed through Lumen either.
      disabled={select.disabled || !!select.closest('fieldset:disabled')}
      value={select.value}
      options={options}
      onChange={(value) => {
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }}
    />
  );
}

/** Puts Lumen's dropdown over every stock select under `root`, now and as jellyfin-web renders more. Returns undo. */
export function enhanceStockSelects(root: HTMLElement): () => void {
  const hosts: { select: HTMLSelectElement; host: HTMLElement }[] = [];
  const enhance = (select: HTMLSelectElement): void => {
    if (select.hasAttribute(ENHANCED) || select.multiple) return;
    select.setAttribute(ENHANCED, '');
    select.classList.add(HIDDEN);
    const host = select.ownerDocument.createElement('div');
    host.className = 'lmn-stock-select';
    select.insertAdjacentElement('afterend', host);
    select.closest('.selectContainer')?.classList.add('lmn-has-dropdown');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    render(<StockSelect select={select} />, host);
    hosts.push({ select, host });
  };
  const scan = (): void => root.querySelectorAll<HTMLSelectElement>(SELECTOR).forEach(enhance);
  scan();
  const observer = new MutationObserver(scan);
  observer.observe(root, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    for (const { select, host } of hosts) {
      render(null, host);
      host.remove();
      select.removeAttribute(ENHANCED);
      select.classList.remove(HIDDEN);
      select.removeAttribute('tabindex');
      select.removeAttribute('aria-hidden');
      select.closest('.selectContainer')?.classList.remove('lmn-has-dropdown');
    }
  };
}
