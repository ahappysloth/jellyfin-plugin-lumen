import type { ComponentChildren } from 'preact';
import { strings } from '../strings';

/** The one "couldn't load" block: a message, Try again when there is something to retry, and any extra actions. */
export function LoadError({
  message = strings.loadFailed,
  onRetry,
  class: className,
  children,
}: {
  message?: string;
  onRetry?: () => void;
  class?: string;
  children?: ComponentChildren;
}) {
  return (
    <div class={`lmn-browse__error${className ? ` ${className}` : ''}`} role="alert">
      <p>{message}</p>
      {(onRetry || children) && (
        <div class="lmn-load-error__actions">
          {onRetry && (
            <button type="button" class="lmn-button lmn-button--secondary lmn-autofocus" onClick={onRetry}>
              {strings.retry}
            </button>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
