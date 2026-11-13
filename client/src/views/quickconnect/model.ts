/**
 * Quick Connect's rules, apart from its screens so they can be tested on their own: the code a person types, what a
 * link may and may not do, what the server's answers mean, where the QR code points, and when the sign-in screen asks
 * for a new code or stops.
 */
import { QUICK_CONNECT } from '../../compat/registry';

/** Jellyfin's codes are six digits (QuickConnectManager: 100000 to 999999). */
export const CODE_LENGTH = 6;
const CODE = /^\d{6}$/;

/**
 * What the code field keeps of what was typed or pasted: digits only, at most six. So "123 456" (as the TV groups it),
 * "123-456" or a code with a stray space pastes whole; there's no maxlength, which would cut a pasted "123 456" to
 * "123 45" before this saw it.
 */
export function normalizeCode(raw: string): string {
  return raw.replace(/\D+/g, '').slice(0, CODE_LENGTH);
}

/**
 * What the field keeps after an edit turned `old` into `raw`, with the caret at `caret`. On a full code, what was just
 * typed or pasted starts a new one: after "That code isn't valid", the next code goes in without deleting the old one
 * first (the field's text sits invisible under the cells, so a caret or selection in it can't be seen).
 */
export function nextCode(old: string, raw: string, caret: number): string {
  const added = raw.length - old.length;
  return (
    (old.length === CODE_LENGTH && added > 0 && normalizeCode(raw.slice(caret - added, caret))) ||
    normalizeCode(raw)
  );
}

export function isCompleteCode(code: string): boolean {
  return CODE.test(code);
}

/** "123456" as the screens show it: "123 456". */
export function groupCode(code: string): string {
  return code.length > 3 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/** `code=` in the hash's query: six digits, or nothing. */
const CODE_PARAM = /[?&]code=([^&]*)/;

/**
 * A code that came in the page's address (a QR code, or a link someone sent): only ever a prefill, never submitted on
 * its own. Anything but six digits is ignored. The address's `userId` never counts: the account is the signed-in
 * person's (or, for an administrator, whoever they pick on the page).
 */
export function codeFromHash(hash: string): string | null {
  const code = CODE_PARAM.exec(hash)?.[1] ?? '';
  return CODE.test(code) ? code : null;
}

/**
 * The page's address without its code, for the address bar once the page has read it (and so out of the history):
 * the bare route, as its other parameter, `userId`, is ignored too.
 */
export const APPROVE_HASH = `#${QUICK_CONNECT.route}`;

/** What the server's answer to an approval means (QuickConnectController.Authorize, 12.4). */
export type ApproveOutcome =
  'approved' | 'invalid' | 'used' | 'disabled' | 'signedOut' | 'offline' | 'failed';

/**
 * - 200: the device is signed in.
 * - 404: no request with that code (mistyped, or its 10 minutes ran out).
 * - 500: the code was already approved (the server throws on a second approval).
 * - 401: either Quick Connect is off (`enabled` false, asked afterwards) or this page's own sign-in has run out.
 * - no answer at all: the server couldn't be reached.
 */
export function approveOutcome(status: number | null, enabled?: boolean): ApproveOutcome {
  if (status === null) return 'offline';
  if (status >= 200 && status < 300) return 'approved';
  if (status === 404) return 'invalid';
  if (status === 500) return 'used';
  if (status === 401) return enabled === false ? 'disabled' : 'signedOut';
  return 'failed';
}

/** The HTTP status jellyfin-web's ajax rejected with (it rejects with the fetch Response), or null for no answer. */
export function statusOf(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status > 0 ? status : null;
}

const HTTP = /^https?:\/\/[^/?#]/i;

/**
 * The meta tag the server adds when the admin set "Public address for QR codes" (Injection/HtmlInjector.cs): checked
 * and normalized (no trailing slash, no jellyfin-web `/web` on the end) on save and again as the server puts it in the
 * page (util/publicAddress.ts and the server's ConfigValidator), so here only that it's http(s).
 */
export function publicAddressSetting(doc: Document): string | null {
  const meta = doc.querySelector<HTMLMetaElement>(`meta[name="${QUICK_CONNECT.addressMeta}"]`);
  return meta && HTTP.test(meta.content) ? meta.content : null;
}

/**
 * Where the QR code sends a phone: jellyfin-web's page under the public address the admin set (the server's address,
 * with its base URL if it has one), or, without one, the address this device itself uses (origin and path: no query or
 * hash), never the server's own idea of its address (`LocalAddress` is often a container's). Null when that isn't
 * http(s) (an app wrapper's own page): then the screen shows the code without a QR code.
 */
export function qrBase(
  setting: string | null,
  location: Pick<Location, 'href' | 'origin' | 'pathname'>,
): string | null {
  if (setting) return `${setting.replace(/\/+$/, '')}/web/`;
  return HTTP.test(location.href) ? location.origin + location.pathname : null;
}

/** The approve page with the code filled in: `<base>#/quickconnect?code=123456`. */
export function approveUrl(base: string, code: string): string {
  return `${base}#${QUICK_CONNECT.route}?${QUICK_CONNECT.codeParam}=${code}`;
}

// ---- The sign-in screen's request ---------------------------------------------------------------------------------

/** How often the screen asks whether its code was approved (jellyfin-web asks every 5 s). */
export const POLL_MS = 3000;
/**
 * New codes asked for on their own when one expires (each lasts 10 minutes): about half an hour in all, then the screen
 * stops and offers "Get a new code", so a TV left on its sign-in screen doesn't ask the server for codes all night.
 */
export const MAX_REFRESHES = 2;
/**
 * While the server can't be reached (or errs), each question waits twice as long as the last, up to MAX_POLL_MS, and
 * after MAX_FAILURES in a row (6 + 12 + 24 + 48 s, then a minute each: about 10 minutes, counted from the waits, not
 * the device's clock) the screen stops and offers "Get a new code" (its code has expired by then anyway).
 */
export const MAX_POLL_MS = 60_000;
export const MAX_FAILURES = 13;

export type SignInState =
  | { kind: 'starting' }
  | { kind: 'code'; code: string }
  /** Codes ran out (MAX_REFRESHES): "Get a new code". */
  | { kind: 'expired' }
  /** Quick Connect is off on the server. */
  | { kind: 'disabled' }
  /** The server couldn't be reached to start. */
  | { kind: 'failed' }
  | { kind: 'signingIn' }
  /** Approved, but trading it for a sign-in failed. */
  | { kind: 'signInFailed' };

export interface SignInApi {
  initiate(): Promise<{ Secret: string; Code: string }>;
  /** Whether the request with this secret has been approved. */
  connect(secret: string): Promise<{ Authenticated?: boolean }>;
}

export interface SignInFlowOptions {
  api: SignInApi;
  onState: (state: SignInState) => void;
  /**
   * The code was approved: sign in with the secret (ApiClient.quickConnect). `live` turns false once the flow is stopped
   * (the screen closed). Rejecting puts the screen in `signInFailed`.
   */
  onApproved: (secret: string, live: () => boolean) => Promise<void>;
}

/**
 * The sign-in screen's side of Quick Connect: asks for a code, then whether it's been approved, every POLL_MS while the
 * page is visible (a TV's browser in the background stops asking), and signs in once it has. The secret that trades the
 * approval for a sign-in stays in this closure: never on screen, in the QR code, the page or a log.
 *
 * The server is the only clock: a code is replaced when the server says it's gone (404), not by counting 10 minutes on
 * a TV whose clock may be wrong. `stop` ends it for good (the screen closed, or the page changed), and any answer
 * still on its way is ignored.
 */
export function createSignInFlow(options: SignInFlowOptions): { start: () => void; stop: () => void } {
  const { api, onState, onApproved } = options;
  const doc = document;
  let run = 0;
  let timer: number | undefined;
  let refreshes = 0;
  /** Questions in a row that got no answer (or a 5xx). */
  let failing = 0;
  let secret: string | null = null;
  let waitingForVisible = false;

  const onVisibility = (): void => {
    if (doc.hidden || !waitingForVisible) return;
    waitingForVisible = false;
    void poll(run);
  };

  const schedule = (current: number): void => {
    clearTimeout(timer);
    timer = window.setTimeout(
      () => {
        if (current !== run) return;
        if (doc.hidden) waitingForVisible = true;
        else void poll(current);
      },
      Math.min(POLL_MS * 2 ** failing, MAX_POLL_MS),
    );
  };

  const initiate = async (current: number): Promise<void> => {
    try {
      const request = await api.initiate();
      if (current !== run) return;
      secret = request.Secret;
      onState({ kind: 'code', code: request.Code });
      schedule(current);
    } catch (error) {
      if (current !== run) return;
      onState({ kind: statusOf(error) === 401 ? 'disabled' : 'failed' });
    }
  };

  const poll = async (current: number): Promise<void> => {
    if (!secret) return;
    let status: number | null = 200;
    let approved = false;
    try {
      approved = (await api.connect(secret)).Authenticated === true;
    } catch (error) {
      status = statusOf(error);
    }
    if (current !== run) return;
    if (approved) {
      onState({ kind: 'signingIn' });
      const approvedSecret = secret;
      secret = null;
      try {
        await onApproved(approvedSecret, () => current === run);
      } catch {
        if (current === run) onState({ kind: 'signInFailed' });
      }
      return;
    }
    // An answer: the server is there.
    if (status === 200 || status === 404) failing = 0;
    if (status === 404) {
      // The code expired (or the server restarted, which forgets every request): a new one, up to MAX_REFRESHES.
      secret = null;
      if (refreshes < MAX_REFRESHES) {
        refreshes++;
        onState({ kind: 'starting' });
        void initiate(current);
      } else onState({ kind: 'expired' });
      return;
    }
    if (status === 401) {
      secret = null;
      onState({ kind: 'disabled' });
      return;
    }
    // Not approved yet: ask again. No answer, or a 5xx: ask again later each time, and in the end stop.
    if (status !== 200 && ++failing > MAX_FAILURES) {
      secret = null;
      onState({ kind: 'expired' });
      return;
    }
    schedule(current);
  };

  return {
    /** Starts over with a new code (also "Get a new code" and "Try again"). */
    start() {
      const current = ++run;
      clearTimeout(timer);
      waitingForVisible = false;
      refreshes = 0;
      failing = 0;
      secret = null;
      doc.removeEventListener('visibilitychange', onVisibility);
      doc.addEventListener('visibilitychange', onVisibility);
      onState({ kind: 'starting' });
      void initiate(current);
    },
    stop() {
      run++;
      secret = null;
      clearTimeout(timer);
      doc.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
