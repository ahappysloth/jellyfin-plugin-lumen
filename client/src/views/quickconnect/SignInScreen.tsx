import { render } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { isBackKey, type JellyfinApiClient } from '../../compat/jellyfin';
import { onNavigate } from '../../takeover/navigation';
import { signInApi } from './api';
import {
  approveUrl,
  createSignInFlow,
  groupCode,
  publicAddressSetting,
  qrBase,
  type SignInState,
} from './model';
import { QrImage } from './parts';
import { qrCode } from './qr';
import { strings } from '../../strings';
import { qcStrings } from './strings';

/** What jellyfin-web's sign-in page lends the screen (checked before it opens: takeover/quickConnectSignIn.ts). */
export interface SignInDeps {
  client: JellyfinApiClient & {
    quickConnect(secret: string): Promise<{ User: { Id: string }; AccessToken: string }>;
  };
  dashboard: {
    onServerChanged(userId: string, accessToken: string, client: unknown): void;
    navigate(url: string): unknown;
  };
  /** Where to go once signed in (the sign-in page's `url`, or home: model.ts signInTarget). */
  target: string;
  /** "Use Quick Connect", which gets focus back when the screen closes without signing in. */
  returnFocus: HTMLElement | null;
}

/**
 * Opens Lumen's Quick Connect screen over jellyfin-web's sign-in page. Returns its close. It closes itself on Cancel,
 * Escape or a remote's Back, and when the page changes; closing stops the requests for good.
 */
export function openSignInScreen(deps: SignInDeps): () => void {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let open = true;
  const close = (refocus = true): void => {
    if (!open) return;
    open = false;
    render(null, host);
    host.remove();
    if (refocus) deps.returnFocus?.focus();
  };
  render(<SignInScreen deps={deps} onClose={close} />, host);
  return () => close();
}

function SignInScreen({ deps, onClose }: { deps: SignInDeps; onClose: (refocus?: boolean) => void }) {
  const [state, setState] = useState<SignInState>({ kind: 'starting' });
  const panel = useRef<HTMLDivElement>(null);
  // Once a code is approved the sign-in can't be taken back (jellyfin-web keeps the account as the request returns), so
  // from then on the screen can't be closed: Cancel goes, and Back or Escape do nothing until it lands.
  const signingIn = useRef(false);
  signingIn.current = state.kind === 'signingIn';
  const flow = useMemo(
    () =>
      createSignInFlow({
        api: signInApi(deps.client),
        onState: setState,
        // As jellyfin-web's own dialog does once a code is approved (registry.ts QUICK_CONNECT). The flow only gets here
        // while the screen is open; if it closes (Cancel, Back, the page changing) while the sign-in is on its way, it
        // doesn't take the page anywhere.
        onApproved: async (secret, live) => {
          const result = await deps.client.quickConnect(secret);
          if (!live()) return;
          deps.dashboard.onServerChanged(result.User.Id, result.AccessToken, deps.client);
          onClose(false);
          deps.dashboard.navigate(deps.target);
        },
      }),
    [],
  );
  const base = useMemo(() => qrBase(publicAddressSetting(document), window.location), []);

  useEffect(() => {
    flow.start();
    // Back and Escape close the screen wherever focus is, before jellyfin-web sees them: in the TV layout it would go
    // back a page. Any page change closes it too (stopping its requests).
    const onKey = (e: KeyboardEvent): void => {
      if (!isBackKey(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (!signingIn.current) onClose();
    };
    document.addEventListener('keydown', onKey, true);
    const stopNavigation = onNavigate(() => onClose(false));
    return () => {
      flow.stop();
      document.removeEventListener('keydown', onKey, true);
      stopNavigation();
    };
  }, []);

  // The first button has focus whenever the buttons change (Cancel, or Get a new code once codes ran out).
  useLayoutEffect(() => {
    panel.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }, [state.kind]);

  // Every arrow and Tab stay among the screen's buttons: jellyfin-web's remote navigation would move focus to the
  // sign-in form behind it.
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!/^Arrow|^Tab$/.test(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    // One or two buttons: any of these keys moves to the other.
    const [first, second] = Array.from(panel.current!.querySelectorAll('button'));
    (document.activeElement === first ? second || first : first)?.focus();
  };

  const code = state.kind === 'code' ? state.code : null;
  // No QR code where the address is too long for it (or isn't http(s)): the code alone, typed in.
  const qr = useMemo(() => (code && base ? qrCode(approveUrl(base, code)) : null), [code]);
  const status = code ? null : qcStrings.state[state.kind as Exclude<SignInState['kind'], 'code'>];
  // Codes ran out, or something failed: start again.
  const retry = /^(expired|failed|signInFailed)$/.test(state.kind);

  return (
    <div class="lmn-qc-signin">
      <div
        ref={panel}
        class="focuscontainer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lmn-qc-title"
        onKeyDown={onKeyDown}
      >
        <div>
          <h2 id="lmn-qc-title">{qcStrings.signInTitle}</h2>
          {code && (
            <>
              <p class="lmn-qc-signin__code">
                <span class="lmn-visually-hidden">{qcStrings.codeLabel(code)}</span>
                <span aria-hidden="true">{groupCode(code)}</span>
              </p>
              <p>
                {qcStrings.steps}
                {qr && <span class="lmn-qc-signin__scan">{qcStrings.orScan}</span>}.
              </p>
            </>
          )}
          <p role="status">{status}</p>
          {retry && (
            <button type="button" class="lmn-button lmn-button--primary" onClick={() => flow.start()}>
              {state.kind === 'expired' ? qcStrings.newCode : strings.retry}
            </button>
          )}
          {!signingIn.current && (
            <button type="button" class="lmn-button" onClick={() => onClose()}>
              {strings.cancel}
            </button>
          )}
        </div>
        {qr && <QrImage code={qr} label={qcStrings.qrLabel} />}
      </div>
    </div>
  );
}
