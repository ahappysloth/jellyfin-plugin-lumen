/**
 * The 10-second skip glyph: an open ring with a line arrowhead and a real "10" set in the UI font (a filled path "10"
 * blurs at control sizes). Forward mirrors the ring, not the number.
 */
export function SkipIcon({ direction, size = 30 }: { direction: 'back' | 'forward'; size?: number }) {
  return (
    <svg
      class="lmn-icon lmn-skip-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <g
        transform={direction === 'forward' ? 'matrix(-1 0 0 1 24 0)' : undefined}
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M10.2 4.7A8.2 8.2 0 1 1 4.6 9.2" />
        <path d="M10.4 1.9 7.6 4.6l2.8 2.7" />
      </g>
      <text
        x="12"
        y="16.3"
        text-anchor="middle"
        font-size="7.6"
        font-weight="700"
        letter-spacing="-.3"
        fill="currentColor"
      >
        10
      </text>
    </svg>
  );
}
