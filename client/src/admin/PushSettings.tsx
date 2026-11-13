import { useEffect, useState } from 'preact/hooks';
import { formatDateTime, formatNumber } from '../util/locale';
import type { AdminApi, PushAdminStatus, PushSendReport } from './adminApi';

const devices = (n: number): string => (n === 1 ? '1 device' : `${formatNumber(n)} devices`);
const users = (n: number): string => (n === 1 ? '1 user' : `${formatNumber(n)} users`);

/** "Delivered to 2 devices", or what kept it from arriving. */
export function describeSend(last: PushSendReport): { ok: boolean; text: string } {
  const what = last.Kind === 'test' ? 'A test' : 'A “ready to watch” notification';
  const when = formatDateTime(new Date(last.At));
  if (last.Sent > 0) {
    const missed = last.Gone + last.Rejected + last.Failed;
    return {
      ok: true,
      text: `${what} was sent to ${devices(last.Sent)} (${when})${missed ? `; ${devices(missed)} couldn't be reached` : ''}.`,
    };
  }
  const why =
    last.Gone > 0
      ? 'the device had turned notifications off, so it was removed'
      : last.Rejected > 0
        ? `the push service refused it${last.Status ? ` (${last.Status})` : ''}`
        : `the push service couldn't be reached${last.Status ? ` (${last.Status})` : ''}`;
  return { ok: false, text: `${what} wasn't delivered (${when}): ${why}.` };
}

/**
 * Push notifications, in the Requests card: how many devices have them on, how the last one sent went, what Seerr's
 * webhook needs for notifications at once, and replacing the keys (which drops every device's subscription).
 */
export function PushSettings({ api, confirm }: { api: AdminApi; confirm: (message: string) => boolean }) {
  const [status, setStatus] = useState<PushAdminStatus | null>(null);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .getPushStatus()
      .then((s) => !cancelled && setStatus(s))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // An older server, or the status couldn't load: nothing to show.
  if (!status) return null;

  const reset = async (): Promise<void> => {
    if (
      !confirm(
        'Reset the notification keys? Every device stops getting notifications until it next opens Lumen, and Seerr’s webhook needs the new secret.',
      )
    )
      return;
    setResetting(true);
    setError('');
    try {
      setStatus(await api.resetPushKeys());
    } catch {
      setError('The keys couldn’t be reset. Check the server log.');
    }
    setResetting(false);
  };

  const last = status.LastSend ? describeSend(status.LastSend) : null;
  return (
    <div class="lmna-callout lmn-admin__push" style={{ marginTop: '14px' }}>
      <h2>Notifications</h2>
      <p>
        Users can turn on a notification for when their requests are ready to watch, on each device (in My
        requests or their profile page). On an iPhone or iPad, that’s in the Home Screen app.
      </p>
      <p class="lmn-admin__push-count" style={{ marginTop: '8px' }}>
        {status.Devices === 0
          ? 'No device has notifications on yet.'
          : `${devices(status.Devices)} of ${users(status.Users)} ${status.Devices === 1 ? 'has' : 'have'} notifications on.`}
      </p>
      {!status.Running && (
        <p class="lmna-pill lmna-pill--error" role="status">
          The notification job isn’t running. Restart Jellyfin.
        </p>
      )}
      <p role="status" class={last && !last.ok ? 'lmna-pill lmna-pill--error' : undefined}>
        {last ? last.text : 'Nothing has been sent since Jellyfin started.'}
      </p>
      {status.WebhookSecret && (
        <details style={{ marginTop: '10px' }}>
          <summary>Notify at once, with Seerr’s webhook (optional)</summary>
          <p style={{ marginTop: '8px' }}>
            Lumen asks Seerr every 2 minutes for users with notifications on. For a notification the moment
            something is available, in Seerr go to Settings → Notifications → Webhook, tick “Request
            Available” under Notification Types, and enter:
          </p>
          <ul>
            <li>
              Webhook URL: <code>{api.serverUrl(status.WebhookPath)}</code> (with Jellyfin’s address as Seerr
              reaches it)
            </li>
            <li>
              Authorization Header: <code>{status.WebhookSecret}</code>
            </li>
          </ul>
        </details>
      )}
      <div class="lmna-row" style={{ margin: '12px 0 0' }}>
        <button type="button" class="lmna-btn" disabled={resetting} onClick={() => void reset()}>
          {resetting ? 'Resetting…' : 'Reset notification keys'}
        </button>
        {error && (
          <span role="alert" class="lmna-pill lmna-pill--error">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
