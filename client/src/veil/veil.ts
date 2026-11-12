/**
 * The loading veil: a black screen with Lumen's mark and the server name that covers jellyfin-web's splash logo and
 * spinner on a cold load, then rises like a curtain once Lumen's page is ready. The inline guard (guard.ts, inlined
 * into index.html by the server) shows it; lumen.js lifts it. Keep this module free of Preact: it ships in the guard.
 */
import { parseRoute } from '../takeover/routes';

export const VEIL_ID = 'lmn-veil';
export const PENDING_CLASS = 'lmn-pending';
/**
 * The guard's safety timer id, on window, for lumen.js to clear (runGuard.ts). Here rather than there, so the core
 * doesn't import the guard's own code.
 */
export const SAFETY_TIMER_KEY = '__lmnVeilSafety';
const NAME_KEY = 'lmn-server-name';
const LIFT_MS = 900;
/**
 * The most the veil waits for Lumen's fonts once the page is ready (liftVeil): Inter on a cold load over a slow
 * connection. After that the page shows in the stand-in font and swaps to Inter when it's in.
 */
export const FONT_WAIT_MS = 800;
/** On the veil while liftVeil waits for the fonts: on the element, as the guard and lumen.js each have this module. */
const FONT_WAIT_ATTR = 'data-lmn-font-wait';
/**
 * How long the veil waits before saying it's slow and offering Try again (the server may be down). Just past the
 * guard's SAFETY_MS (runGuard.ts): if lumen.js never loads, the guard lifts the veil first and the message never
 * flashes (or takes focus) on the way out; once lumen.js runs, it clears that timer and the message can show.
 */
export const SLOW_MS = 8500;
/**
 * The veil ships in the inline guard, before Lumen's strings (and any network) are there, so these two are inline.
 * Keep them in step with strings.ts's tone.
 */
const SLOW_TEXT = 'This is taking longer than usual.';
const RETRY_TEXT = 'Try again';

/**
 * Routes Lumen may own, plus the bare app URL (jellyfin-web's hash router redirects it to home). An empty hash counts
 * only at the app's root (`/web/`, `/web/index.html`): anywhere else (`/web/home`) jellyfin-web isn't hash-routed, so
 * Lumen won't take the page over and there's nothing to wait for.
 */
export function shouldVeil(hash: string, path = '/'): boolean {
  if (/^#?!?\/?$/.test(hash)) return /\/(index\.html)?$/i.test(path);
  const kind = parseRoute(hash).kind;
  // A reload on the player lands wherever jellyfin-web sends it; nothing of Lumen's to wait for.
  return kind !== 'other' && kind !== 'player';
}

export function rememberVeilName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // storage blocked: the veil falls back to "Jellyfin"
  }
}

/** The server name remembered from the last visit (the veil and sign-in page show it before anyone signs in). */
export function veilName(): string {
  try {
    return localStorage.getItem(NAME_KEY) || 'Jellyfin';
  } catch {
    return 'Jellyfin';
  }
}

export function showVeil(doc: Document, markSvg: string): HTMLElement {
  const existing = doc.getElementById(VEIL_ID);
  if (existing) return existing;
  const veil = doc.createElement('div');
  veil.id = VEIL_ID;
  veil.setAttribute('aria-hidden', 'true');
  // Inline basics so it covers the page, centred, even before lumen.css applies (or if it never does: the server went
  // down). The mark's size is set on the SVG too, or a page without the stylesheet draws it full screen.
  veil.style.cssText =
    'position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;align-content:center;background:#000;color:#fff';
  veil.innerHTML = `<div class="lmn-veil__brand"><span class="lmn-veil__mark">${markSvg}</span><span class="lmn-veil__name"></span></div>`;
  veil.querySelector('.lmn-veil__name')!.textContent = veilName();
  const mark = veil.querySelector('svg');
  mark?.setAttribute('width', '56');
  mark?.setAttribute('height', '56');
  (doc.body ?? doc.documentElement).appendChild(veil);
  setTimeout(() => showSlow(doc, veil), SLOW_MS);
  return veil;
}

/**
 * Still veiled after SLOW_MS: say so and offer Try again (a reload), rather than a silent screen until a safety timer
 * hands the page to jellyfin-web.
 */
function showSlow(doc: Document, veil: HTMLElement): void {
  // Lumen's page is ready and the veil only waits for its fonts: not slow.
  if (!veil.isConnected || veil.classList.contains('is-lifting') || veil.hasAttribute(FONT_WAIT_ATTR)) return;
  veil.removeAttribute('aria-hidden');
  const slow = doc.createElement('div');
  slow.className = 'lmn-veil__slow';
  slow.setAttribute('role', 'alert');
  slow.innerHTML = '<p></p><button type="button" class="lmn-button lmn-button--secondary"></button>';
  slow.querySelector('p')!.textContent = SLOW_TEXT;
  const retry = slow.querySelector('button')!;
  retry.textContent = RETRY_TEXT;
  retry.addEventListener('click', () => {
    if (!veil.classList.contains('is-lifting')) doc.defaultView?.location.reload();
  });
  veil.appendChild(slow);
  // A TV remote needs something focused to press.
  retry.focus();
}

/** styles/fonts.css's family name for Inter. */
const LUMEN_FONT = 'Lumen Inter';

/**
 * Lumen's page is ready: lifts the veil once Lumen's own font (Inter, styles/fonts.css) is in, if the page is loading
 * it, so the page shows in Inter rather than swapping to it as the veil rises, but never more than FONT_WAIT_MS later.
 * It waits only for 'Lumen Inter' faces already loading, never starts one, and not for other fonts (jellyfin-web's
 * hidden chrome fetches its own on every page, Apple devices included): a device that doesn't use Inter (Apple's keep
 * San Francisco), or a repeat visit with Inter cached, lifts at once. Browsers without `document.fonts` lift at once.
 * Safe to call more than once or with no veil: a second call while it waits changes nothing, and liftVeilNow (the
 * safety timers) doesn't wait for it.
 */
export function liftVeil(doc: Document = document): void {
  const veil = doc.getElementById(VEIL_ID);
  // Optional: TV browsers and old ones may not have it (lib.dom says they all do).
  const fonts = veil ? (doc.fonts as FontFaceSet | undefined) : undefined;
  if (!veil || !fonts) {
    liftVeilNow(doc);
    return;
  }
  // The stock chrome may show now (Lumen's page or the stock page is up under the veil) and start its fonts too.
  doc.documentElement.classList.remove(PENDING_CLASS);
  if (veil.hasAttribute(FONT_WAIT_ATTR) || veil.classList.contains('is-lifting')) return;
  const pending: Promise<unknown>[] = [];
  try {
    // Lay the page out first, so the faces its text needs have started loading.
    void doc.documentElement.offsetHeight;
    fonts.forEach((face) => {
      // WebKit reports a swap face still downloading as 'error' once its block period ends (its `loaded` still
      // settles when the file arrives): only 'unloaded' (never needed) and 'loaded' are settled.
      if (
        face.family.replace(/["']/g, '') === LUMEN_FONT &&
        face.status !== 'unloaded' &&
        face.status !== 'loaded'
      )
        pending.push(face.loaded);
    });
  } catch {
    // A partial FontFaceSet: lift now.
  }
  if (!pending.length) {
    liftVeilNow(doc);
    return;
  }
  veil.setAttribute(FONT_WAIT_ATTR, '');
  let settled = false;
  // Once: a late callback after the cap mustn't lift again, or take off lmn-pending something else has set since.
  const done = (): void => {
    if (settled) return;
    settled = true;
    clearTimeout(cap);
    liftVeilNow(doc);
  };
  const cap = setTimeout(done, FONT_WAIT_MS);
  Promise.all(pending).then(done, done);
}

/**
 * Raises the veil (or fades it, for reduced motion) and removes it, now. Safe to call more than once or with no veil.
 * The safety timers use it: they never wait for fonts.
 */
export function liftVeilNow(doc: Document = document): void {
  doc.documentElement.classList.remove(PENDING_CLASS);
  const veil = doc.getElementById(VEIL_ID);
  if (!veil || veil.classList.contains('is-lifting')) return;
  veil.classList.add('is-lifting');
  // Lumen's page is ready: a remote's OK while the veil rises mustn't press its Try again and reload. Disabled and
  // blurred rather than `inert`, which TV browsers don't know.
  veil.setAttribute('aria-hidden', 'true');
  const retry = veil.querySelector('button');
  if (retry) {
    retry.disabled = true;
    retry.blur();
  }
  const remove = (): void => veil.remove();
  veil.addEventListener('transitionend', remove, { once: true });
  setTimeout(remove, LIFT_MS + 200);
}
