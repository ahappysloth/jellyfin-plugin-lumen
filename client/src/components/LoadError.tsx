import type { ComponentChildren } from 'preact';
import { strings } from '../strings';

/** The one "couldn't load" block: a message, Try again when there is something to retry, and any extra actions. */
export function LoadError({
  message = strings.loadFailed,
  onRetry,
  retrying = false,
  class: className,
  children,
}: {
  message?: string;
  onRetry?: () => void;
  /** A retry is under way: Try again shows it, and can't be pressed again. */
  retrying?: boolean;
  class?: string;
  children?: ComponentChildren;
}) {
  return (
    <div class={`lmn-browse__error${className ? ` ${className}` : ''}`} role="alert">
      <p>{message}</p>
      {(onRetry || children) && (
        <div class="lmn-load-error__actions">
          {onRetry && (
            <button
              type="button"
              class={`lmn-button lmn-button--secondary lmn-autofocus${retrying ? ' is-busy' : ''}`}
              disabled={retrying}
              aria-busy={retrying ? 'true' : undefined}
              onClick={onRetry}
            >
              {retrying && <span class="lmn-spinner" aria-hidden="true" />}
              {retrying ? strings.retrying : strings.retry}
            </button>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
