import type { MyRequest } from '../../api/types';
import { isMoving, progressDetail, progressLabel } from './requestProgress';
import { titleStrings } from './titleStrings';
import { strings } from '../../strings';

/**
 * progressDetail for a request from another list than the user's own (everyone's requests), whose time left counts
 * down from when that list arrived, `at`: progressDetail counts from the user's own last answer.
 */
function detailFrom(request: MyRequest, at: number): string {
  const rest = progressDetail({ ...request, SecondsLeft: null });
  if (request.Status !== 'Downloading' || request.SecondsLeft == null) return rest;
  const left = Math.max(0, request.SecondsLeft - Math.floor((Date.now() - at) / 1000));
  return [rest, strings.timeLeft(left)].filter((p) => p).join(' · ');
}

/**
 * How the user's own request for a title is going, on its page and in My requests: the status and what it means
 * ("Downloading · 45% · 12 min left"), and a progress bar while it downloads. The bar is a progressbar (its value is
 * read when it's reached, not announced on every update).
 */
export function RequestProgressBlock({
  request,
  compact = false,
  receivedAt,
}: {
  request: MyRequest;
  compact?: boolean;
  /** When the list it came in arrived, if it isn't the user's own (everyone's requests: allRequests.ts). */
  receivedAt?: number;
}) {
  const label = progressLabel(request.Status);
  const detail = receivedAt === undefined ? progressDetail(request) : detailFrom(request, receivedAt);
  const percent = isMoving(request.Status) && request.Percent != null ? request.Percent : null;
  const problem = request.Status === 'Declined' || request.Status === 'Failed';
  const note = compact ? null : titleStrings.progressNote[request.Status];
  return (
    <div class={`lmn-request-progress${problem ? ' is-problem' : ''}`}>
      <p class="lmn-request-progress__status">
        <strong>{label}</strong>
        {detail && <span>{detail}</span>}
      </p>
      {percent !== null && (
        <div
          class="lmn-request-progress__bar"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.floor(percent)}
          aria-valuetext={detail || undefined}
        >
          <span style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
        </div>
      )}
      {note && <p class="lmn-request-progress__note">{note}</p>}
    </div>
  );
}
