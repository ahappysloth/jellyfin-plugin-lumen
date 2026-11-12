import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
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
 * scans in the background and keeps the result for 10 minutes; the card asks for it as it mounts (AdminApp mounts it
 * when its tab is first opened), and again every couple of seconds while a scan runs and the page is visible.
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

  useEffect(() => {
    live.current = true;
    void load(false);
    const onVisibility = (): void => {
      if (document.hidden || !pollDue.current) return;
      pollDue.current = false;
      poll();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      live.current = false;
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
                <span class="lmna-storage__files">in {formatFiles(report.Totals.Files)}</span>
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

/** Two libraries sharing a folder both count its files, so the libraries add up to more than the total. */
function overlaps({ Libraries: libraries, Totals: totals }: StorageReport): boolean {
  const sum = (pick: (s: StorageReport['Totals']) => number) =>
    libraries.reduce((n, l) => n + pick(l.Storage), 0);
  return sum((s) => s.Size) > totals.Size || sum((s) => s.Files) > totals.Files;
}

function Report({ report, tv }: { report: StorageReport; tv: boolean }) {
  const { Totals: totals } = report;
  return (
    <>
      <dl class="lmna-storage__tiles">
        <div class="lmna-storage__tile lmna-storage__tile--pool">
          <dt>H.264 at 1080p and above</dt>
          <dd>
            <strong>{formatBytes(totals.H264AtLeast1080p.Size)}</strong>{' '}
            <span class="lmna-storage__files">in {formatFiles(totals.H264AtLeast1080p.Files)}</span>
          </dd>
          <dd class="lmna-storage__hint">The usual re-encode candidates.</dd>
        </div>
        <div class="lmna-storage__tile">
          <dt>HDR</dt>
          <dd>
            <strong>{formatBytes(totals.Hdr.Size)}</strong>{' '}
            <span class="lmna-storage__files">in {formatFiles(totals.Hdr.Files)}</span>
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
          {overlaps(report) && (
            <p class="lmna-storage__overlap">
              Some files are in more than one library, so these add up to more than the total.
            </p>
          )}
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
          <Bar library={name} by="codec" buckets={storage.Codecs} label={codecLabel} kind="codec" tv={tv} />
          <Bar
            library={name}
            by="resolution"
            buckets={storage.Resolutions}
            label={resolutionLabel}
            kind="res"
            tv={tv}
          />
        </>
      )}
    </div>
  );
}

/** How far a bar's tooltip keeps from the window's edges, and from the bar. */
const TIP_MARGIN = 8;

/**
 * A thin segmented bar (one library's files split by codec or resolution), with a legend that carries the numbers:
 * colour is never the only way to tell the parts apart.
 *
 * Pointing at a part (or tapping it, on a touch screen) shows a tooltip with its numbers; tapping elsewhere hides it.
 * From the keyboard the bar is one Tab stop, its arrows going from part to part. The tooltip is only for the eye: the
 * bar's name already reads every part out, as the legend shows them, so a screen reader hears it once. Not on a TV,
 * where the library is a D-pad stop of its own and its legend says the same.
 */
function Bar({
  library,
  by,
  buckets,
  label,
  kind,
  tv,
}: {
  library: string;
  by: string;
  buckets: StorageBucket[];
  label: (key: string) => string;
  kind: 'codec' | 'res';
  tv: boolean;
}) {
  const percent = shares(buckets);
  const parts = buckets
    .map((b, i) => ({
      bucket: b,
      share: percent[i]!,
      text: `${label(b.Key)} ${formatBytes(b.Size)}, ${formatFiles(b.Files)}`,
    }))
    .filter((p) => p.bucket.Files > 0);
  const [active, setActive] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  // The pointer that last went down on the bar: a touch toggles the tooltip, a mouse only points.
  const pointer = useRef('');
  const shown = active !== null && active < parts.length ? parts[active]! : null;

  /** The part under the pointer, or the nearest one (the 2px gaps between parts, the hit area above and below). */
  const partAt = (x: number): number | null => {
    const segs = barRef.current?.children;
    if (!segs || !segs.length) return null;
    let best = 0;
    let distance = Infinity;
    for (let i = 0; i < segs.length; i++) {
      const r = segs[i]!.getBoundingClientRect();
      const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      if (d < distance) {
        distance = d;
        best = i;
      }
    }
    return best;
  };

  // Tapped elsewhere (another bar included): hidden.
  useEffect(() => {
    if (active === null) return undefined;
    const onDown = (e: Event): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setActive(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [active !== null]);

  // Over its part, and inside the window: shifted in from an edge (its arrow still points at the part), and under the
  // bar when there's no room above it.
  useLayoutEffect(() => {
    const tip = tipRef.current;
    const seg = active === null ? null : barRef.current?.children[active];
    const wrap = wrapRef.current;
    if (!tip || !seg || !wrap) return;
    const box = wrap.getBoundingClientRect();
    const part = seg.getBoundingClientRect();
    const width = tip.offsetWidth;
    const viewport = document.documentElement.clientWidth || window.innerWidth;
    const centre = (part.left + part.right) / 2;
    const left = Math.max(TIP_MARGIN, Math.min(centre - width / 2, viewport - TIP_MARGIN - width));
    tip.style.left = `${left - box.left}px`;
    tip.style.setProperty('--tip-arrow', `${Math.max(10, Math.min(width - 10, centre - left))}px`);
    const below = part.top - tip.offsetHeight - TIP_MARGIN < 0;
    tip.classList.toggle('is-below', below);
  }, [active, shown?.bucket.Key]);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const last = parts.length - 1;
    const at = active ?? -1;
    const next =
      e.key === 'ArrowRight'
        ? Math.min(at + 1, last)
        : e.key === 'ArrowLeft'
          ? Math.max(at - 1, 0)
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (e.key === 'Escape' && active !== null) {
      // The tooltip goes, and Escape goes no further (a dialog round the page would close).
      e.preventDefault();
      e.stopPropagation();
      setActive(null);
      return;
    }
    if (next === null) return;
    e.preventDefault();
    setActive(next);
  };

  return (
    <div class="lmna-storage__bar-row">
      <div
        ref={wrapRef}
        class={`lmna-bar-wrap${shown ? ' is-pointing' : ''}`}
        onPointerDown={(e) => {
          pointer.current = e.pointerType;
          if (e.pointerType === 'mouse') return;
          const at = partAt(e.clientX);
          setActive((current) => (current === at ? null : at));
        }}
        onPointerMove={(e) => {
          if (e.pointerType === 'mouse') setActive(partAt(e.clientX));
        }}
        onPointerLeave={(e) => {
          // A part picked from the keyboard stays up; one only pointed at goes with the pointer.
          const fromKeys = document.activeElement === barRef.current && !pointer.current;
          if (e.pointerType === 'mouse' && !fromKeys) setActive(null);
        }}
      >
        <div
          ref={barRef}
          class="lmna-bar"
          role="img"
          aria-label={`${library} by ${by}: ${parts.map((p) => p.text).join('; ')}`}
          tabIndex={tv ? undefined : 0}
          onKeyDown={tv ? undefined : onKeyDown}
          // From the keyboard, the first part shows at once; a click or tap has picked its own part already.
          onFocus={() => {
            if (!pointer.current) setActive((current) => current ?? 0);
          }}
          onBlur={() => {
            pointer.current = '';
            setActive(null);
          }}
        >
          {parts.map((p, i) => (
            <span
              key={p.bucket.Key}
              class={`lmna-bar__seg lmna-seg--${kind}-${p.bucket.Key}${i === active ? ' is-active' : ''}`}
              style={{ width: `${p.share}%` }}
            />
          ))}
        </div>
        {shown && (
          <div ref={tipRef} class="lmna-tip" aria-hidden="true">
            <span class={`lmna-swatch lmna-seg--${kind}-${shown.bucket.Key}`} />
            <strong>{label(shown.bucket.Key)}</strong>
            {` · ${formatBytes(shown.bucket.Size)} · ${formatFiles(shown.bucket.Files)} · ${shown.share}% of ${library}`}
          </div>
        )}
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
