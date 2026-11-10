import type { Locator, Page } from '@playwright/test';

/**
 * What jellyfin-web's D-pad navigation (focusManager.nav) can move focus to: its focusable query skips
 * [tabindex="-1"] and :disabled controls and range inputs.
 */
const FOCUSABLE =
  'a[href], button:not([tabindex="-1"]):not(:disabled), input:not([type="range"]):not([tabindex="-1"]):not(:disabled), ' +
  'select:not(:disabled), textarea:not(:disabled), [tabindex="0"], .focusable:not([tabindex="-1"])';
const KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const;

export interface Control {
  id: number;
  /** tag.class "label", for failure messages. */
  name: string;
  /** Its class attribute. */
  classes: string;
}

export interface DpadWalk {
  /** Every control Lumen shows on the page: visible, focusable and not inert. */
  controls: Control[];
  /** Those of them no sequence of arrow keys reaches from the start. */
  unreachable: Control[];
}

/** Numbers every focusable element in the page that hasn't one yet (data-dpad), so the walk can name where focus is. */
const tagFocusables = (page: Page) =>
  page.evaluate((query) => {
    const w = window as unknown as { __dpadNext?: number };
    for (const el of document.querySelectorAll(query)) {
      if (!el.hasAttribute('data-dpad')) el.setAttribute('data-dpad', String((w.__dpadNext = (w.__dpadNext ?? 0) + 1)));
    }
  }, FOCUSABLE);

const focusedId = (page: Page) =>
  page.evaluate(() => {
    const id = document.activeElement?.getAttribute('data-dpad');
    return id == null ? null : Number(id);
  });

/**
 * Walks jellyfin-web's TV-layout D-pad navigation from `start`: from every control reached so far, presses each arrow
 * key and records where focus lands, until nothing new turns up. Then lists Lumen's controls it never landed on.
 */
export async function walkDpad(page: Page, start: Locator): Promise<DpadWalk> {
  await start.focus();
  await tagFocusables(page);
  const first = await focusedId(page);
  if (first == null) throw new Error('the start control could not take focus');
  const url = page.url();

  const seen = new Set([first]);
  const queue = [first];
  while (queue.length) {
    const from = queue.shift()!;
    for (const key of KEYS) {
      const focused = await page.evaluate((id) => {
        const el = document.querySelector<HTMLElement>(`[data-dpad="${id}"]`);
        el?.focus();
        return !!el && document.activeElement === el;
      }, from);
      if (!focused) break; // gone, hidden or inert since it was reached
      await page.keyboard.press(key);
      // focusManager moves focus on keydown; give anything Lumen renders in response a couple of frames.
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      if (page.url() !== url) throw new Error(`${key} from control ${from} navigated to ${page.url()}`);
      await tagFocusables(page); // controls rendered since (lazy rows, an opened menu)
      const to = await focusedId(page);
      if (to != null && !seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }

  await tagFocusables(page);
  const controls = await page.evaluate((query) => {
    const root = document.querySelector('#lmn-root');
    return [...(root?.querySelectorAll<HTMLElement>(query) ?? [])]
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return (box.width > 0 || box.height > 0) && el.checkVisibility({ visibilityProperty: true }) && !el.closest('[inert]');
      })
      .map((el) => {
        const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
        const classes = el.getAttribute('class') ?? '';
        const name = `${el.tagName.toLowerCase()}.${classes.split(' ')[0]} "${label}"`;
        return { id: Number(el.getAttribute('data-dpad')), name, classes };
      });
  }, FOCUSABLE);
  return { controls, unreachable: controls.filter((c) => !seen.has(c.id)) };
}
