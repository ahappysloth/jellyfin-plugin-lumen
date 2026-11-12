import type { Locator, Page } from '@playwright/test';

/**
 * What jellyfin-web's D-pad navigation (focusManager.nav) can move focus to: its focusable query skips
 * [tabindex="-1"] and :disabled controls, range and file inputs.
 */
const FOCUSABLE =
  'a[href]:not([tabindex="-1"]), button:not([tabindex="-1"]):not(:disabled), ' +
  'input:not([type="range"]):not([type="file"]):not([tabindex="-1"]):not(:disabled), ' +
  'select:not([tabindex="-1"]):not(:disabled), textarea:not(:disabled), [tabindex="0"], .focusable:not([tabindex="-1"])';
const KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const;
/** Rounds of exploring at most (see walkDpad): a page whose controls keep changing under the walk stops somewhere. */
const MAX_ROUNDS = 4;

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

/**
 * Numbers every focusable element in the page that hasn't one yet (data-dpad), so the walk can name where focus is, and
 * says where focus is. `settle`: first gives anything Lumen renders after a key press a couple of frames (the controls
 * it numbers then include those rendered since: lazy rows, an opened menu). One trip to the page, as the walk makes one
 * per press.
 */
const tagFocusables = (page: Page, settle = false) =>
  page.evaluate(
    async ([query, wait]) => {
      if (wait) await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const w = window as unknown as { __dpadNext?: number };
      for (const el of document.querySelectorAll(query)) {
        if (!el.hasAttribute('data-dpad')) el.setAttribute('data-dpad', String((w.__dpadNext = (w.__dpadNext ?? 0) + 1)));
      }
      const id = document.activeElement?.getAttribute('data-dpad');
      return id == null ? null : Number(id);
    },
    [FOCUSABLE, settle] as const,
  );

/**
 * Walks jellyfin-web's TV-layout D-pad navigation from `start`: from every control reached so far, presses each arrow
 * key and records where focus lands, until nothing new turns up (going round again while that finds more). Then lists
 * Lumen's controls it never landed on: those in `root` (a selector; Lumen's pages by default, the settings page's
 * `#lmn-admin-root` or a part of it there).
 */
export async function walkDpad(page: Page, start: Locator, root = '#lmn-root'): Promise<DpadWalk> {
  await start.focus();
  const first = await tagFocusables(page);
  if (first == null) throw new Error('the start control could not take focus');
  const url = page.url();

  const seen = new Set([first]);
  // A press can change what's on the page after the controls leading to the new ones were explored: the hero's pager
  // changes the slide, whose buttons are new elements. So go round again from every control reached so far, until a
  // round finds nothing new.
  let found = true;
  for (let round = 0; found && round < MAX_ROUNDS; round++) {
    found = false;
    const queue = round === 0 ? [first] : [...seen];
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
        // focusManager moves focus on keydown.
        const to = await tagFocusables(page, true).catch((error: unknown) => {
          if (page.url() !== url) return null; // a page load: said below
          throw error;
        });
        if (page.url() !== url) throw new Error(`${key} from control ${from} navigated to ${page.url()}`);
        if (to != null && !seen.has(to)) {
          seen.add(to);
          queue.push(to);
          found = true;
        }
      }
    }
  }

  await tagFocusables(page);
  const controls = await page.evaluate(([query, within]) => {
    // jellyfin-web keeps pages it has left: the one showing.
    const scope = [...document.querySelectorAll<HTMLElement>(within)].find((el) => el.getClientRects().length > 0);
    return [...(scope?.querySelectorAll<HTMLElement>(query) ?? [])]
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
  }, [FOCUSABLE, root] as const);
  return { controls, unreachable: controls.filter((c) => !seen.has(c.id)) };
}
