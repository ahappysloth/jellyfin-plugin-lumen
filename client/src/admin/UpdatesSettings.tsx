import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../components/icons';
import type { AdminApi, UpdateStatus } from './adminApi';
import { Card } from './controls';

type Step =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'checked'; status: UpdateStatus }
  | { kind: 'installing'; status: UpdateStatus }
  | { kind: 'restarting' }
  | { kind: 'failed'; message: string; status?: UpdateStatus };

/**
 * Check for updates: Lumen's manifest on GitHub and Jellyfin's plugin repositories, checked fresh by the server; then
 * Jellyfin's own installer, and a restart to load the new version.
 */
export function UpdatesSettings({
  api,
  autoCheck = false,
  confirm,
}: {
  api: AdminApi;
  autoCheck?: boolean;
  confirm: (message: string) => boolean;
}) {
  const [step, setStep] = useState<Step>({ kind: 'idle' });

  const check = async (): Promise<void> => {
    setStep({ kind: 'checking' });
    try {
      setStep({ kind: 'checked', status: await api.checkForUpdates() });
    } catch {
      setStep({ kind: 'failed', message: "Couldn't check for updates. Try again in a moment." });
    }
  };
  const install = async (status: UpdateStatus): Promise<void> => {
    setStep({ kind: 'installing', status });
    try {
      setStep({ kind: 'checked', status: await api.installUpdate(status.Latest!) });
    } catch {
      setStep({
        kind: 'failed',
        status,
        message: `Couldn't install Lumen ${status.Latest}. Try again in a moment.`,
      });
    }
  };
  const restart = async (): Promise<void> => {
    if (!confirm('Restart Jellyfin now? Anyone watching is disconnected for a moment.')) return;
    setStep({ kind: 'restarting' });
    try {
      await api.restartServer();
    } catch {
      setStep({
        kind: 'failed',
        message: "Couldn't restart Jellyfin. Restart it from the Dashboard instead.",
      });
    }
  };

  useEffect(() => {
    if (autoCheck) void check();
    // Once, on open.
  }, []);

  const busy = step.kind === 'checking' || step.kind === 'installing' || step.kind === 'restarting';
  const status = step.kind === 'checked' || step.kind === 'installing' ? step.status : null;

  return (
    <Card
      title="Updates"
      intro="Checks Lumen's releases on GitHub and asks Jellyfin to read its plugin repositories again."
    >
      <div class="lmn-admin__updates" aria-live="polite">
        <div class="lmn-admin__updates-text">
          {step.kind === 'idle' && <p>Check whether a newer version of Lumen is out.</p>}
          {step.kind === 'checking' && <p>Checking for updates…</p>}
          {step.kind === 'restarting' && <p>Restarting Jellyfin… this page reconnects when it's back.</p>}
          {step.kind === 'failed' && (
            <p role="alert" class="lmn-admin__updates-error">
              {step.message}
            </p>
          )}
          {status && <UpdateSummary status={status} installing={step.kind === 'installing'} />}
        </div>
        <div class="lmn-admin__updates-actions">
          {status?.RestartPending ? (
            <button
              type="button"
              class="lmna-btn lmna-btn--primary"
              disabled={busy}
              onClick={() => void restart()}
            >
              Restart now
            </button>
          ) : status?.UpdateAvailable ? (
            <button
              type="button"
              class="lmna-btn lmna-btn--primary"
              disabled={busy}
              onClick={() => void install(status)}
            >
              {step.kind === 'installing' ? 'Installing…' : 'Install update'}
            </button>
          ) : null}
          <button type="button" class="lmna-btn" disabled={busy} onClick={() => void check()}>
            {step.kind === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
        </div>
      </div>
    </Card>
  );
}

function UpdateSummary({ status, installing }: { status: UpdateStatus; installing: boolean }) {
  return (
    <>
      {status.RestartPending ? (
        <p class="lmn-admin__updates-ok">
          <Icon name="check" size={16} />
          Lumen {status.Latest} is installed. Restart Jellyfin to finish.
        </p>
      ) : status.UpdateAvailable ? (
        <p>
          <strong>Lumen {status.Latest} is available.</strong> You have {status.Installed}.
        </p>
      ) : status.Latest ? (
        <p class="lmn-admin__updates-ok">
          <Icon name="check" size={16} />
          Lumen {status.Installed} is the latest version.
        </p>
      ) : (
        <p>No Lumen release was found for this version of Jellyfin.</p>
      )}
      {installing && <p>Downloading and installing…</p>}
      {status.UpdateAvailable && status.Changelog && <ReleaseNotes text={status.Changelog} />}
      {!status.ManifestReachable && (
        <p class="lmna-card__intro">
          GitHub couldn't be reached; this used Jellyfin's plugin repositories only.
        </p>
      )}
      {status.ManifestReachable && !status.ListedByJellyfin && (
        <p class="lmna-card__intro">
          Jellyfin's plugin repositories don't include Lumen's, so it won't update Lumen by itself. Add the
          repository in Dashboard → Plugins → Manage Repositories.
        </p>
      )}
    </>
  );
}

interface NotesSection {
  heading: string | null;
  items: string[];
}

/**
 * A release's CHANGELOG entry (as the manifest carries it): `### Added` headings and `- ` items, hard-wrapped. Read
 * into headings and whole items rather than shown as raw Markdown.
 */
export function parseReleaseNotes(text: string): NotesSection[] {
  const sections: NotesSection[] = [];
  let section: NotesSection | null = null;
  let item: number | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      item = null;
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      section = { heading: heading[1]!, items: [] };
      sections.push(section);
      item = null;
      continue;
    }
    if (!section) {
      section = { heading: null, items: [] };
      sections.push(section);
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      item = section.items.push(bullet[1]!) - 1;
    } else if (item !== null) {
      section.items[item] += ` ${line}`;
    } else {
      item = section.items.push(line) - 1;
    }
  }
  return sections.filter((s) => s.items.length > 0);
}

function ReleaseNotes({ text }: { text: string }) {
  return (
    <div class="lmn-admin__updates-notes">
      {parseReleaseNotes(text).map((section, i) => (
        <section key={i}>
          {section.heading && <h4>{section.heading}</h4>}
          <ul>
            {section.items.map((entry, j) => (
              <li key={j}>{entry}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
