import type { MyRequest } from '../../api/types';
import { isMoving, progressDetail, progressLabel } from './requestProgress';
import { titleStrings } from './titleStrings';

/**
 * How the user's own request for a title is going, on its page and in My requests: the status and what it means
 * ("Downloading · 45% · 12 min left"), and a progress bar while it downloads. The bar is a progressbar (its value is
 * read when it's reached, not announced on every update).
 */
export function RequestProgressBlock({
  request,
  compact = false,
}: {
  request: MyRequest;
  compact?: boolean;
}) {
  const label = progressLabel(request.Status);
  const detail = progressDetail(request);
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
