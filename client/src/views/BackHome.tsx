import { HOME_HASH } from '../compat/jellyfin';
import { Icon } from '../components/icons';
import { strings } from '../strings';
import { usePageDepth } from '../takeover/pageDepth';
import type { ViewContext } from './context';

/** Back to wherever the user came from; home when the page was opened directly. */
export function goBack(ctx: Pick<ViewContext, 'navigate'>): void {
  if (window.history.length > 1) window.history.back();
  else ctx.navigate(HOME_HASH);
}

/**
 * The pill at the top of a page that has no nav (a title, an episode, a person, a catalog title): Back, and Home once
 * the user is more than one such page deep (takeover/pageDepth.ts), where Back alone is several presses from anywhere.
 *
 * The bar it sits in is a focuscontainer-x (jellyfin-web's focus manager): on a TV, Left and Right move along the bar,
 * between Back, Home and a trailer's controls at its other end, and nowhere else.
 *
 * Home is a link that adds to the history, as the nav's Home does: the browser's Back then returns to the page it was
 * pressed on, with the pages before it still behind. Replacing the entry would lose that page, and going back to the
 * first entry would leave Back pointing out of Lumen (or nowhere, on a page opened from a link).
 */
export function BackHome({
  onBack,
  autoFocus,
}: {
  /** Usually goBack; a page may have its own way back. */
  onBack: () => void;
  /** The page's default focus on a TV (useAutoFocus). */
  autoFocus?: boolean;
}) {
  const deep = usePageDepth() > 1;
  return (
    <div class="lmn-pill">
      <button
        type="button"
        class={`lmn-icon-button lmn-icon-button--lg${autoFocus ? ' lmn-autofocus' : ''}`}
        aria-label={strings.back}
        onClick={onBack}
      >
        <Icon name="back" size={20} />
      </button>
      {deep && (
        <a class="lmn-icon-button lmn-icon-button--lg" href={HOME_HASH} aria-label={strings.home}>
          <Icon name="home" size={20} />
        </a>
      )}
    </div>
  );
}
