import { useEffect, useRef, useState } from 'preact/hooks';
import { detailsHash, getLayout } from '../compat/jellyfin';
import { formatDateTime, formatNumber } from '../util/locale';
import type { AdminApi, StorageBreakdown, StorageBucket, StorageReport, StorageStatus } from './adminApi';
import { Card } from './controls';
import {
  codecLabel,
  codecMix,
  fileCodecLabel,
  formatBitrate,
  formatBytes,
  formatFiles,
  resolutionLabel,
  shares,
} from './storageFormat';

/** How often the card asks again while the server is still scanning. */
export const POLL_MS = 2000;

/**
 * Storage: where the space goes, by library, video codec and resolution, and the biggest titles. Read-only. The server
 * scans in the background and keeps the result for 10 minutes; the card asks for it once it's (nearly) on screen, and
 * again every couple of seconds while a scan runs and the page is visible.
 */
export function StorageSettings({ api, pollMs = POLL_MS }: { api: AdminApi; pollMs?: number }) {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [requestFailed, setRequestFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const live = useRef(true);
  // A poll that came due while the page was hidden (another tab, the TV's home screen): asked once it's shown again.
  const pollDue = useRef(false);

  const poll = (): void => {
    // jellyfin-web keeps pages it has left without unmounting them: a copy that's gone stops asking.
    if (!rootRef.current?.isConnected) return;
    if (document.hidden) {
      pollDue.current = true;
      return;
    }
    void load(false);
  };

  const load = async (refresh: boolean): Promise<void> => {
    clearTimeout(timer.current);
    setLoading(true);
    try {
      const next = await (refresh ? api.refreshStorage() : api.getStorage());
      if (!live.current) return;
      setStatus(next);
      setRequestFailed(false);
      if (next.State === 'Computing') timer.current = setTimeout(poll, pollMs);
    } catch {
      if (live.current) setRequestFailed(true);
    } finally {
      if (live.current) setLoading(false);
    }
  };

  // Asked for once the card comes near the screen: opening the settings page for something else doesn't start a scan.
  useEffect(() => {
    live.current = true;
    const root = rootRef.current;
    let observer: IntersectionObserver | undefined;
    if (root && typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          observer?.disconnect();
          void load(false);
        },
        { rootMargin: '400px 0px' },
      );
      observer.observe(root);
    } else {
      void load(false);
    }
    const onVisibility = (): void => {
      if (document.hidden || !pollDue.current) return;
      pollDue.current = false;
      poll();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      live.current = false;
      observer?.disconnect();
      clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const computing = status?.State === 'Computing';
  const report = status?.Report ?? null;
  // Only on a TV are the numbers stops of their own; elsewhere Tab goes from Refresh straight to the titles.
  const tv = getLayout() === 'tv';

  return (
    <Card
      title="Storage"
      intro="Where the space goes: video files by library, codec and resolution, and the biggest titles. It only reads Jellyfin's library; trailers and extras aren't counted."
    >
      <div ref={rootRef} class="lmna-storage" aria-busy={loading || computing ? 'true' : undefined}>
        <div class="lmna-storage__head">
          <div class="lmna-storage__summary">
            {report && report.Totals.Files > 0 && (
              <p class="lmna-storage__total">
                <strong>{formatBytes(report.Totals.Size)}</strong>{' '}
                <span>in {formatFiles(report.Totals.Files)}</span>
              </p>
            )}
            {report && (
              <p class="lmna-storage__when">
                Computed {formatDateTime(new Date(report.ComputedAt))}
                {report.Seconds >= 1 ? ` in ${Math.round(report.Seconds)} s` : ''}
              </p>
            )}
          </div>
          <button
            type="button"
            class="lmna-btn"
            disabled={loading || computing}
            onClick={() => void load(true)}
          >
            {computing ? 'Computing…' : 'Refresh'}
          </button>
        </div>

        <div aria-live="polite">
          {!status && !requestFailed && <p class="lmna-empty">Loading storage…</p>}
          {computing && (
            <p class="lmna-storage__note">
              <span class="lmn-admin__spinner" aria-hidden="true" />
              {report
                ? 'Updating… these numbers are from the last scan.'
                : 'Computing… on a big library this takes a minute or two.'}
            </p>
          )}
          {/* Ready without a report: the scan was stopped (Jellyfin shutting down) before it finished. */}
          {status?.State === 'Ready' && !report && !requestFailed && (
            <p class="lmna-empty">No storage report yet. Refresh to compute one.</p>
          )}
        </div>
        {/* Errors are alerts of their own, outside the polite region, so they're announced once. */}
        {requestFailed && (
          <p role="alert" class="lmn-admin__updates-error">
            Couldn't load the storage report. Try Refresh in a moment.
          </p>
        )}
        {status?.State === 'Failed' && !requestFailed && (
          <p role="alert" class="lmn-admin__updates-error">
            {status.Error ?? "Couldn't read the libraries."}
          </p>
        )}

        {report &&
          (report.Totals.Files === 0 ? (
            <p class="lmna-empty">No video files in your libraries yet.</p>
          ) : (
            <Report report={report} tv={tv} />
          ))}
      </div>
    </Card>
  );
}

function Report({ report, tv }: { report: StorageReport; tv: boolean }) {
  const { Totals: totals } = report;
  return (
    <>
      <dl class="lmna-storage__tiles">
        <div class="lmna-storage__tile lmna-storage__tile--pool">
          <dt>H.264 at 1080p and above</dt>
          <dd>
            <strong>{formatBytes(totals.H264AtLeast1080p.Size)}</strong> in{' '}
            {formatFiles(totals.H264AtLeast1080p.Files)}
          </dd>
          <dd class="lmna-storage__hint">The usual re-encode candidates.</dd>
        </div>
        <div class="lmna-storage__tile">
          <dt>HDR</dt>
          <dd>
            <strong>{formatBytes(totals.Hdr.Size)}</strong> in {formatFiles(totals.Hdr.Files)}
          </dd>
          <dd class="lmna-storage__hint">HDR10, HDR10+, Dolby Vision and HLG.</dd>
        </div>
        {totals.UnknownSizeFiles > 0 && (
          <div class="lmna-storage__tile">
            <dt>Size unknown</dt>
            <dd>
              <strong>{formatFiles(totals.UnknownSizeFiles)}</strong>
            </dd>
            <dd class="lmna-storage__hint">
              .strm, remote and not yet measured files, counted without a size.
            </dd>
          </div>
        )}
      </dl>

      <div class="lmna-storage__split">
        <BucketTable title="By codec" buckets={totals.Codecs} label={codecLabel} kind="codec" tv={tv} />
        <BucketTable
          title="By resolution"
          buckets={totals.Resolutions}
          label={resolutionLabel}
          kind="res"
          tv={tv}
        />
      </div>

      {report.Libraries.length > 0 && (
        <section class="lmna-storage__section" aria-label="Libraries">
          <h3>Libraries</h3>
          {report.Libraries.map((library) => (
            <Library key={library.Id} name={library.Name} storage={library.Storage} tv={tv} />
          ))}
        </section>
      )}

      {report.BiggestMovies.length > 0 && (
        <section class="lmna-storage__section" aria-label="Biggest movies">
          <h3>Biggest movies</h3>
          <ol class="lmna-top">
            {report.BiggestMovies.map((m) => (
              <li key={m.Id} class="lmna-top__item">
                <a class="lmna-top__title" href={detailsHash(m.Id)}>
                  {m.Name}
                  {m.Year ? ` ` : null}
                  {m.Year ? <span class="lmna-top__year">({m.Year})</span> : null}
                </a>
                <span class="lmna-top__size">{formatBytes(m.Size)}</span>
                <span class="lmna-top__meta">
                  {[
                    fileCodecLabel(m.Codec, m.CodecName),
                    resolutionLabel(m.Resolution),
                    m.Bitrate ? formatBitrate(m.Bitrate) : null,
                    m.Hdr,
                    // Versions, or the parts of a multi-part movie (cd1, cd2).
                    m.Files > 1 ? `${m.Files} files` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {report.BiggestSeries.length > 0 && (
        <section class="lmna-storage__section" aria-label="Biggest shows">
          <h3>Biggest shows</h3>
          <ol class="lmna-top">
            {report.BiggestSeries.map((s) => (
              <li key={s.Id} class="lmna-top__item">
                <a class="lmna-top__title" href={detailsHash(s.Id)}>
                  {s.Name}
                </a>
                <span class="lmna-top__size">{formatBytes(s.Size)}</span>
                <span class="lmna-top__meta">
                  {`${s.Episodes} ${s.Episodes === 1 ? 'episode' : 'episodes'} · ${codecMix(s.Codecs)}`}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}

/**
 * On a TV, each table and library is a focus stop: a remote's D-pad only moves between focusable things (jellyfin-web's
 * focusManager counts controls and .focusable), and this card is mostly numbers between Refresh and the titles.
 */
const TV_STOP = ' lmna-storage__stop focusable';

/** A breakdown over every library: name, size, files and share, in a table narrow enough for a phone. */
function BucketTable({
  title,
  buckets,
  label,
  kind,
  tv,
}: {
  title: string;
  buckets: StorageBucket[];
  label: (key: string) => string;
  kind: 'codec' | 'res';
  tv: boolean;
}) {
  const percent = shares(buckets);
  return (
    <table class={`lmna-table lmna-storage__table${tv ? TV_STOP : ''}`} tabIndex={tv ? 0 : undefined}>
      <caption>{title}</caption>
      <thead>
        <tr>
          <th scope="col">{kind === 'codec' ? 'Codec' : 'Resolution'}</th>
          <th scope="col">Size</th>
          <th scope="col">Files</th>
          <th scope="col">Share</th>
        </tr>
      </thead>
      <tbody>
        {buckets.map((b, i) =>
          // "Not probed" only when there is some.
          b.Key === 'Unknown' && b.Files === 0 ? null : (
            <tr key={b.Key}>
              <th scope="row">
                <span class={`lmna-swatch lmna-seg--${kind}-${b.Key}`} aria-hidden="true" />
                {label(b.Key)}
              </th>
              <td>{formatBytes(b.Size)}</td>
              <td>{formatNumber(b.Files)}</td>
              <td>{percent[i]}%</td>
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
}

function Library({ name, storage, tv }: { name: string; storage: StorageBreakdown; tv: boolean }) {
  return (
    <div
      class={`lmna-storage__library${tv ? TV_STOP : ''}`}
      tabIndex={tv ? 0 : undefined}
      role="group"
      aria-label={name}
    >
      <p class="lmna-storage__library-head">
        <strong>{name}</strong>
        <span>
          {storage.Files === 0
            ? 'No video files'
            : `${formatBytes(storage.Size)} · ${formatFiles(storage.Files)}`}
        </span>
      </p>
      {storage.Files > 0 && (
        <>
          <Bar name={`${name} by codec`} buckets={storage.Codecs} label={codecLabel} kind="codec" />
          <Bar
            name={`${name} by resolution`}
            buckets={storage.Resolutions}
            label={resolutionLabel}
            kind="res"
          />
        </>
      )}
    </div>
  );
}

/**
 * A thin segmented bar (one library's files split by codec or resolution), with a legend that carries the numbers:
 * colour is never the only way to tell the parts apart.
 */
function Bar({
  name,
  buckets,
  label,
  kind,
}: {
  name: string;
  buckets: StorageBucket[];
  label: (key: string) => string;
  kind: 'codec' | 'res';
}) {
  const percent = shares(buckets);
  const parts = buckets
    .map((b, i) => ({
      bucket: b,
      share: percent[i]!,
      text: `${label(b.Key)} ${formatBytes(b.Size)}, ${formatFiles(b.Files)}`,
    }))
    .filter((p) => p.bucket.Files > 0);
  return (
    <div class="lmna-storage__bar-row">
      <div class="lmna-bar" role="img" aria-label={`${name}: ${parts.map((p) => p.text).join('; ')}`}>
        {parts.map((p) => (
          <span
            key={p.bucket.Key}
            class={`lmna-bar__seg lmna-seg--${kind}-${p.bucket.Key}`}
            style={{ width: `${p.share}%` }}
            title={p.text}
          />
        ))}
      </div>
      <ul class="lmna-legend" aria-hidden="true">
        {parts.map((p) => (
          <li key={p.bucket.Key}>
            <span class={`lmna-swatch lmna-seg--${kind}-${p.bucket.Key}`} />
            {label(p.bucket.Key)}{' '}
            <span>
              {formatBytes(p.bucket.Size)} · {formatFiles(p.bucket.Files)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
