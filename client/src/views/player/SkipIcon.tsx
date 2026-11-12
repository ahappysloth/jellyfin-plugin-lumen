import { Icon, RING_BACK } from '../../components/icons';

/**
 * The 10-second skip glyph: Lucide's rotate-ccw ring and arrowhead, stroked like the other icons, around a real "10"
 * set in the UI font (a filled path "10" blurs at control sizes). Forward mirrors the icon (player.css), and the "10"
 * back again.
 */
export function SkipIcon({ direction }: { direction: 'back' | 'forward' }) {
  const forward = direction === 'forward';
  return (
    <Icon name={RING_BACK} size={28} class={forward ? 'lmn-skip-icon is-forward' : 'lmn-skip-icon'}>
      <text
        transform={forward ? 'matrix(-1 0 0 1 24 0)' : undefined}
        x="12"
        y="15"
        text-anchor="middle"
        font-size="8"
        font-weight="700"
        letter-spacing="-.3"
        fill="currentColor"
        stroke="none"
      >
        10
      </text>
    </Icon>
  );
}
