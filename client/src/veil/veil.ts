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

/** Routes Lumen may own, plus the bare app URL (jellyfin-web redirects it to home). */
export function shouldVeil(hash: string): boolean {
  if (/^#?!?\/?$/.test(hash)) return true;
  return parseRoute(hash).kind !== 'other';
}

export function rememberVeilName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // storage blocked: the veil falls back to "Jellyfin"
  }
}

function veilName(): string {
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
  // Inline basics so it covers the page even before lumen.css applies.
  veil.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#000';
  veil.innerHTML = `<div class="lmn-veil__brand"><span class="lmn-veil__mark">${markSvg}</span><span class="lmn-veil__name"></span></div>`;
  veil.querySelector('.lmn-veil__name')!.textContent = veilName();
  (doc.body ?? doc.documentElement).appendChild(veil);
  return veil;
}

/** Raises the veil (or fades it, for reduced motion) and removes it. Safe to call more than once or with no veil. */
export function liftVeil(doc: Document = document): void {
  doc.documentElement.classList.remove(PENDING_CLASS);
  const veil = doc.getElementById(VEIL_ID);
  if (!veil || veil.classList.contains('is-lifting')) return;
  veil.classList.add('is-lifting');
  const remove = (): void => veil.remove();
  veil.addEventListener('transitionend', remove, { once: true });
  setTimeout(remove, LIFT_MS + 200);
}
