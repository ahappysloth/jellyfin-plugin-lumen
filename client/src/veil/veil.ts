/**
 * The loading veil: a black screen with Lumen's mark and the server name that covers jellyfin-web's splash logo and
 * spinner on a cold load, then rises like a curtain once Lumen's page is ready. The inline guard (guard.ts, inlined
 * into index.html by the server) shows it; lumen.js lifts it. Keep this module free of Preact: it ships in the guard.
 */
import { parseRoute } from '../takeover/routes';

export const VEIL_ID = 'lmn-veil';
export const PENDING_CLASS = 'lmn-pending';
const NAME_KEY = 'lmn-server-name';
const LIFT_MS = 900;
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
  if (!veil.isConnected || veil.classList.contains('is-lifting')) return;
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

/** Raises the veil (or fades it, for reduced motion) and removes it. Safe to call more than once or with no veil. */
export function liftVeil(doc: Document = document): void {
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
