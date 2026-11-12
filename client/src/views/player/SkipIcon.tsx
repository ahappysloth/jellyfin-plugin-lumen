/**
 * The 10-second skip glyph: Lucide's rotate-ccw ring and arrowhead, stroked like the other icons (components/icons.tsx),
 * around a real "10" set in the UI font (a filled path "10" blurs at control sizes). Forward mirrors the ring, not the
 * number.
 */
export function SkipIcon({ direction, size = 28 }: { direction: 'back' | 'forward'; size?: number }) {
  return (
    <svg
      class="lmn-icon lmn-skip-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        transform={direction === 'forward' ? 'matrix(-1 0 0 1 24 0)' : undefined}
        d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <text
        x="12"
        y="15"
        text-anchor="middle"
        font-size="8"
        font-weight="700"
        letter-spacing="-.3"
        fill="currentColor"
      >
        10
      </text>
    </svg>
  );
}
