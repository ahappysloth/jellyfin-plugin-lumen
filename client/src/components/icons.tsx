/**
 * Small inline SVG icons (24×24 grid, currentColor). Decorative: always aria-hidden; label the control instead.
 *
 * Outlined, from Lucide (https://lucide.dev, ISC; LICENSES/lucide.txt), drawn as one path each: a 2-unit stroke with
 * round caps and joins, so every icon at a size has the same line weight. Path data starting with `*` is filled as
 * well (play, pause, a rating's star, a favorite's heart). The volume levels' waves and Watch together are Lumen's
 * own, drawn the same way.
 *
 * PATHS downloads at startup whole, so an icon only a lazily loaded view shows lives in that view's own set, made with
 * defineIcons in a module only its chunk imports (views/player/playerIcons.ts, views/profile/profileIcons.ts,
 * views/itemMenu/itemMenuIcons.ts, views/secondary/secondaryIcons.ts), and is passed as `name={PLAYER_ICONS.cast}`.
 * An icon the core needs too belongs here.
 */
import type { ComponentChildren, JSX } from 'preact';

const HEART =
  'M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5';
const CHEVRON_LEFT = 'M15 18l-6-6 6-6';
/** The volume icons' speaker, and its sound waves from the inside out: the player shows one per level. */
export const SPEAKER =
  'M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298Z';
/** A ring with an arrowhead, turning back (Lucide's rotate-ccw): history's clock face, and the player's 10 s skips. */
export const RING_BACK = 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5' as IconPath;
export const WAVES = [
  'M14.18 8.82a4.5 4.5 0 0 1 0 6.36',
  'M16.66 6.34a8 8 0 0 1 0 11.31',
  'M19.55 4.3a11.5 11.5 0 0 1 0 15.39',
];

const PATHS = {
  play: '*M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19Z',
  pause:
    '*M15 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM6 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z',
  info: 'M2 12a10 10 0 1 0 20 0 10 10 0 1 0-20 0M12 16v-4M12 8h.01',
  plus: 'M5 12h14M12 5v14',
  /**
   * Watch together (SyncPlay): two people passing it round. Not one person (the account icon) and not a screen with
   * a play symbol (that's Quality, shown right under it in the player).
   */
  watchTogether:
    'M4.5 5.5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M3 14a4 4 0 0 1 8 0M14.5 13.5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M13 22a4 4 0 0 1 8 0M15.93 2.86a9 9 0 0 1 4.12 3.75M8.07 21.14a9 9 0 0 1-4.12-3.75',
  /** A clock with an arrow running back round it. */
  history: `${RING_BACK}M12 7v5l4 2`,
  server:
    'M4 2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM4 14h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2ZM6 6h.01M6 18h.01',
  check: 'M20 6 9 17l-5-5',
  eye: 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0M9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
  film: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM7 3v18M3 7.5h4M3 12h18M3 16.5h4M17 3v18M17 7.5h4M17 16.5h4',
  tv: 'M17 2l-5 5-5-5M4 7h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z',
  home: 'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',
  folder:
    'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
  music:
    'M21 16V3a1 1 0 0 0-1.28-.96l-10 2.917a1 1 0 0 0-.72.96V19M15 16a3 3 0 1 0 6 0 3 3 0 1 0-6 0M3 19a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
  search: 'M21 21l-4.34-4.34M3 11a8 8 0 1 0 16 0 8 8 0 1 0-16 0',
  user: 'M7 8a5 5 0 1 0 10 0A5 5 0 1 0 7 8M20 21a8 8 0 0 0-16 0',
  heart: HEART,
  heartFilled: `*${HEART}`,
  replay: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5',
  external: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  download: 'M12 15V3M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5',
  close: 'M18 6 6 18M6 6l12 12',
  settings:
    'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915M9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
  display: 'M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM8 21h8M12 17v4',
  key: 'M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4ZM16 7.5a.5.5 0 1 0 1 0 .5.5 0 1 0-1 0',
  shield:
    'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z',
  sliders: 'M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4',
  edit: 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497ZM15 5l4 4',
  logout: 'M16 17l5-5-5-5M21 12H9M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4',
  chevronDown: 'M6 9l6 6 6-6',
  more: 'M11 12a1 1 0 1 0 2 0 1 1 0 1 0-2 0M18 12a1 1 0 1 0 2 0 1 1 0 1 0-2 0M4 12a1 1 0 1 0 2 0 1 1 0 1 0-2 0',
  star: '*M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16Z',
  back: CHEVRON_LEFT,
  chevronRight: 'M9 18l6-6-6-6',
  chevronLeft: CHEVRON_LEFT,
  volumeOff: `${SPEAKER}M16 9l6 6M22 9l-6 6`,
  /** The speaker with all three of the player's volume waves (views/player/playerIcons.ts has one and two). */
  volumeHigh: SPEAKER + WAVES.join(''),
} as const;

export type IconName = keyof typeof PATHS;

declare const iconPath: unique symbol;
/** An icon from a lazily loaded view's own set: its path data, branded so any other string is still a type error. */
export type IconPath = string & { readonly [iconPath]: true };
/** Either kind of icon: one named here, or one from a view's own set. */
export type IconRef = IconName | IconPath;

/** A lazily loaded view's own icons, by name, for `<Icon name={…}>`. */
export function defineIcons<K extends string>(paths: Record<K, string>): Readonly<Record<K, IconPath>> {
  return paths as Record<K, IconPath>;
}

export function Icon({
  name,
  size = 20,
  class: className,
  children,
}: {
  name: IconRef;
  size?: number;
  class?: string;
  /** Drawn over the path (the player's skip icons put their "10" in the ring). */
  children?: ComponentChildren;
}): JSX.Element {
  const d: string = name in PATHS ? PATHS[name as IconName] : name;
  const filled = d[0] === '*';
  return (
    <svg
      class={`lmn-icon${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={filled ? d.slice(1) : d} />
      {children}
    </svg>
  );
}
