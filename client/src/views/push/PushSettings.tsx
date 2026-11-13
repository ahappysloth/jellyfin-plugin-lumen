// The notifications toggle and what's behind it, one file loaded where it shows (lazyPush.tsx).
import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../../components/icons';
import type { ViewContext } from '../context';
import { disablePush, enablePush, onPushChange, type PushState, readPushState, sendPushTest } from './push';
import { PUSH_ICONS } from './pushIcons';
import { pushStrings } from './pushStrings';

export { resumePush } from './push';

/**
 * "Notify me when requests are ready", for this device: a switch with its state (on, off, blocked by the browser), a
 * test button while it's on, and on an iPhone in Safari why it needs the Home Screen app. Renders nothing where
 * notifications can't work (no Push API, no request features). The browser's permission is asked for only by the
 * switch's tap.
 */
export function PushToggle({ ctx, titled }: { ctx: ViewContext; titled?: boolean }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState('');

  // Not in the TV layout: a TV's browser has no push service behind it, whatever APIs it shows.
  const tv = ctx.layout === 'tv';
  useEffect(() => {
    if (tv) return undefined;
    let cancelled = false;
    const read = (): void =>
      void readPushState(ctx).then(
        (s) => !cancelled && setState(s),
        () => !cancelled && setState('none'),
      );
    read();
    // The device's check on load may subscribe again (the server's keys were reset) after this has drawn "off".
    const stop = onPushChange(read);
    return () => {
      cancelled = true;
      stop();
    };
  }, [ctx.userId, tv]);

  if (tv || !state || state === 'none') return null;

  const on = state === 'on';
  const toggle = (): void => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    // Called straight from the tap: enablePush asks for the permission before anything asynchronous.
    (on ? disablePush(ctx) : enablePush(ctx))
      .then(setState, () => setMessage(on ? pushStrings.offFailed : pushStrings.onFailed))
      .then(() => setBusy(false));
  };
  const test = (): void => {
    setTesting(true);
    setMessage('');
    void sendPushTest(ctx).then((result) => {
      setTesting(false);
      setMessage(
        result.ok
          ? pushStrings.testSent
          : result.wait
            ? pushStrings.testWait
            : (result.error ?? pushStrings.testFailed),
      );
      // A subscription the push service says is gone was removed: show the switch as it now is.
      if (!result.ok && !result.wait) void readPushState(ctx).then(setState, () => undefined);
    });
  };

  const hint =
    state === 'homeScreen'
      ? pushStrings.homeScreenHint
      : state === 'blocked'
        ? pushStrings.blockedHint
        : on
          ? pushStrings.onHint
          : pushStrings.offHint;
  const card = (
    <div class={`lmn-push is-${state}`}>
      <div class="lmn-push__row">
        <span class="lmn-push__icon">
          <Icon name={PUSH_ICONS.bell} size={22} />
        </span>
        <span class="lmn-push__text">
          <span class="lmn-push__label" id="lmn-push-label">
            {pushStrings.label}
          </span>
          <span class="lmn-push__hint" id="lmn-push-hint">
            {hint}
          </span>
        </span>
        {state !== 'homeScreen' && (
          <button
            type="button"
            role="switch"
            class="lmn-push__switch"
            aria-checked={on}
            aria-labelledby="lmn-push-label"
            aria-describedby="lmn-push-hint"
            aria-busy={busy}
            disabled={state === 'blocked'}
            onClick={toggle}
          />
        )}
      </div>
      {(on || message) && (
        <div class="lmn-push__more">
          {on && (
            <button
              type="button"
              class="lmn-button lmn-button--secondary lmn-push__test"
              disabled={testing}
              onClick={test}
            >
              {testing ? pushStrings.testSending : pushStrings.test}
            </button>
          )}
          <span class="lmn-push__status" role="status">
            {message}
          </span>
        </div>
      )}
    </div>
  );
  return titled ? (
    <section class="lmn-profile__group" aria-label={pushStrings.heading}>
      <h2 class="lmn-profile__group-title">{pushStrings.heading}</h2>
      {card}
    </section>
  ) : (
    card
  );
}
