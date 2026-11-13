import { useState } from 'preact/hooks';
import { defineIcons, Icon } from '../../components/icons';
import { formatDateTime } from '../../util/locale';
import type { LumenConfig } from '../adminApi';
import { Card } from '../controls';
import type { DeviceRow } from './devices';
import { resolveFix } from './fixes';
import { type HealthCheck, type HealthStatus, STATUS_TEXT } from './healthModel';
import { buildReport } from './report';
import type { HealthState } from './useHealth';

/** One per status, so each reads at a glance (a circled tick, a triangle, a circled cross, a skip arrow). */
const STATUS_ICONS = defineIcons({
  Ok: 'M2 12a10 10 0 1 0 20 0 10 10 0 1 0-20 0M8 12.5l2.5 2.5L16 9.5',
  Warning: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01',
  Problem: 'M2 12a10 10 0 1 0 20 0 10 10 0 1 0-20 0M15 9l-6 6M9 9l6 6',
  NotApplicable: 'M5 5l7 7-7 7M13 5l7 7-7 7',
});

/** The status: an icon (decorative) and the word, so neither colour nor shape alone carries it. */
function Status({ status }: { status: HealthStatus }) {
  return (
    <span class={`lmna-health__status lmna-health__status--${status}`}>
      <span aria-hidden="true">
        <Icon name={STATUS_ICONS[status]} size={18} />
      </span>
      <span class="lmna-health__word">{STATUS_TEXT[status]}</span>
    </span>
  );
}

/** A row's fix: one link or button, so one tab stop. */
function Fix({ check, onOpenSetting }: { check: HealthCheck; onOpenSetting: (card: string) => void }) {
  const target = check.Fix ? resolveFix(check.Fix) : null;
  if (!check.Fix || !target) return null;
  return target.kind === 'link' ? (
    <a
      class="lmna-btn lmna-health__fix"
      href={target.href}
      {...(target.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {check.Fix.Label}
      {target.external && <Icon name="external" size={14} />}
    </a>
  ) : (
    <button type="button" class="lmna-btn lmna-health__fix" onClick={() => onOpenSetting(target.card)}>
      {check.Fix.Label}
    </button>
  );
}

function CheckRow({ check, onOpenSetting }: { check: HealthCheck; onOpenSetting: (card: string) => void }) {
  return (
    <li class={`lmna-health__row lmna-health__row--${check.Status}`} data-check={check.Id}>
      <div class="lmna-health__head">
        <Status status={check.Status} />
        <h2 class="lmna-health__title">{check.Title}</h2>
      </div>
      <p class="lmna-health__message">{check.Message}</p>
      {check.Detail && <p class="lmna-health__detail">{check.Detail}</p>}
      <Fix check={check} onOpenSetting={onOpenSetting} />
    </li>
  );
}

function DeviceItem({ device }: { device: DeviceRow }) {
  return (
    <li class={`lmna-health__row lmna-health__row--${device.status}`} data-device>
      <div class="lmna-health__head">
        <Status status={device.status} />
        <h2 class="lmna-health__title">{device.title}</h2>
      </div>
      <dl class="lmna-health__facts">
        <dt>What broke</dt>
        <dd>{device.broke.join(' ')}</dd>
        <dt>What Lumen did</dt>
        <dd>{device.did.join(' ')}</dd>
        {device.advice && (
          <>
            <dt>Would an update help?</dt>
            <dd>{device.advice}</dd>
          </>
        )}
      </dl>
      <details class="lmna-health__ids">
        {/* "focusable": jellyfin-web's D-pad only moves to the controls it knows, and those with this class. */}
        <summary class="focusable">Technical details</summary>
        <p>
          Failed checks: <code>{device.ids.join(', ')}</code>
        </p>
        <p>
          Jellyfin {device.serverVersion}, last seen {formatDateTime(new Date(device.lastSeen))}
        </p>
      </details>
    </li>
  );
}

/** Copies text: the Clipboard API where the page is secure, else a selected textarea and the copy command. */
async function copyText(text: string, doc: Document = document): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused (no permission): try the old way.
  }
  const area = doc.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  doc.body.appendChild(area);
  area.select();
  let done: boolean;
  try {
    done = doc.execCommand('copy');
  } catch {
    done = false;
  }
  area.remove();
  return done;
}

/**
 * The Health tab: every check, grouped, each with what's wrong in plain words and a fix to go to; the devices where
 * Lumen's compatibility check failed; "Run checks again"; and "Copy report", a summary with no secrets for a bug report.
 */
export function HealthTab({
  health,
  config,
  savedUrl,
  onOpenSetting,
  onUpFromTop,
  copy = copyText,
}: {
  health: HealthState;
  config: LumenConfig;
  /** Seerr's address as saved: kept out of the report along with the one being edited. */
  savedUrl?: string | null;
  onOpenSetting: (card: string) => void;
  /** Up from the tab's top buttons: back to the tab strip (a D-pad can't leave the tab upwards otherwise). */
  onUpFromTop?: () => void;
  copy?: (text: string) => Promise<boolean>;
}) {
  const { report, groups, devices, running, failed } = health;
  const [copied, setCopied] = useState<'copied' | 'failed' | null>(null);
  const [manual, setManual] = useState<string | null>(null);

  const all = ([] as HealthStatus[]).concat(
    ...groups.map((g) => g.checks.map((c) => c.Status)),
    devices.map((d) => d.status),
  );
  const count = (status: HealthStatus): number => all.filter((s) => s === status).length;
  const summary = report
    ? [
        [count('Problem'), 'problem', 'problems'],
        [count('Warning'), 'warning', 'warnings'],
      ]
        .filter(([n]) => (n as number) > 0)
        .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
        .join(', ')
    : '';

  const onCopy = async (): Promise<void> => {
    if (!report) return;
    const text = buildReport({
      checkedAt: new Date(report.CheckedAt),
      lumenVersion: report.LumenVersion,
      jellyfinVersion: report.JellyfinVersion,
      groups,
      devices,
      settings: {
        requestsEnabled: !!config.RequestsEnabled,
        seerrAddressSet: !!(savedUrl ?? config.SeerrUrl),
        seerrKeySet: !!config.SeerrApiKeySet,
        traktKeySet: !!config.TraktClientIdSet,
        quickConnectAddressSet: !!report.QuickConnectAddress,
      },
      secrets: [
        config.SeerrUrl ?? '',
        savedUrl ?? '',
        report.QuickConnectAddress,
        config.QuickConnectAddress ?? '',
        window.location.origin,
        window.location.host,
      ],
    });
    const ok = await copy(text);
    setCopied(ok ? 'copied' : 'failed');
    setManual(ok ? null : text);
  };

  return (
    // A TV's D-pad stays in the tab going up and down (focuscontainer-y): between rows' fixes it would otherwise jump to the
    // Dashboard's drawer, which can be nearer than the next fix past a row's text. Up from the top buttons leaves for
    // the tab strip.
    <div
      class="lmna-health focuscontainer-y"
      onKeyDown={(e) => {
        if (e.key !== 'ArrowUp' || !onUpFromTop) return;
        if (!(e.target as HTMLElement).closest('.lmna-health__actions')) return;
        e.preventDefault();
        e.stopPropagation();
        onUpFromTop();
      }}
    >
      <Card title="Health check" intro="Whether Lumen is set up and working, and what to do where it isn't.">
        <div class="lmna-health__bar">
          <p class="lmna-health__summary" role="status">
            {running
              ? 'Checking…'
              : failed
                ? failed
                : report
                  ? `${summary ? `${summary[0]!.toUpperCase()}${summary.slice(1)}.` : 'Everything checked is fine.'} Checked ${formatDateTime(new Date(report.CheckedAt))}.`
                  : ''}
          </p>
          <div class="lmna-health__actions">
            <button type="button" class="lmna-btn" disabled={running} onClick={health.rerun}>
              {running ? 'Checking…' : 'Run checks again'}
            </button>
            <button type="button" class="lmna-btn" disabled={!report} onClick={() => void onCopy()}>
              Copy report
            </button>
          </div>
        </div>
        <p class="lmna-health__copied" role="status">
          {copied === 'copied'
            ? 'Report copied. It has no keys or addresses (only the names of libraries a check mentions), so it can go in a bug report as it is.'
            : copied === 'failed'
              ? "Couldn't copy here. Select the report below and copy it."
              : ''}
        </p>
        {manual && (
          <textarea class="lmna-health__manual" readOnly value={manual} aria-label="Health report" rows={8} />
        )}
      </Card>

      {groups.map((group) => (
        <Card key={group.id} title={group.label}>
          <ul class="lmna-health__list">
            {group.checks.map((check) => (
              <CheckRow key={check.Id} check={check} onOpenSetting={onOpenSetting} />
            ))}
          </ul>
        </Card>
      ))}

      {report && (
        <Card
          title="Devices"
          intro="Browsers and apps where Lumen's compatibility check failed since Jellyfin started, newest first."
        >
          {devices.length === 0 ? (
            <p class="lmna-empty">No compatibility problems reported.</p>
          ) : (
            <ul class="lmna-health__list">
              {devices.map((device) => (
                <DeviceItem key={`${device.title}-${device.lastSeen}-${device.ids.join()}`} device={device} />
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
