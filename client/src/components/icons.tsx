/**
 * Small inline SVG icons (24×24 grid, currentColor). Decorative: always aria-hidden; label the control instead.
 *
 * PATHS downloads at startup whole, so an icon only a lazily loaded view shows lives in that view's own set, made with
 * defineIcons in a module only its chunk imports (views/player/playerIcons.ts, views/profile/profileIcons.ts,
 * views/itemMenu/itemMenuIcons.ts), and is passed as `name={PLAYER_ICONS.cast}`. An icon the core needs too belongs
 * here.
 */
import type { JSX } from 'preact';

const PATHS = {
  play: 'M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z',
  pause: 'M7 4h3v16H7zM14 4h3v16h-3z',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm-1 7h2v6h-2zm0-4h2v2h-2z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
  /**
   * Watch together (SyncPlay): two people passing it round. Not one person (the account icon) and not a screen with
   * a play symbol (that's Quality, shown right under it in the player).
   */
  watchTogether:
    'M7 1.75a3.25 3.25 0 1 1 0 6.5 3.25 3.25 0 0 1 0-6.5Zm0 2a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5ZM2 14a5 5 0 0 1 10 0h-2a3 3 0 0 0-6 0ZM17 9.75a3.25 3.25 0 1 1 0 6.5 3.25 3.25 0 0 1 0-6.5Zm0 2a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5ZM12 22a5 5 0 0 1 10 0h-2a3 3 0 0 0-6 0ZM14.87 2A10.4 10.4 0 0 1 20.82 6.49 1 1 0 0 1 19.12 7.55 8.4 8.4 0 0 0 14.32 3.93 1 1 0 0 1 14.87 2ZM9.13 22A10.4 10.4 0 0 1 3.18 17.51 1 1 0 0 1 4.88 16.45 8.4 8.4 0 0 0 9.68 20.07 1 1 0 0 1 9.13 22Z',
  stop: 'M6 6h12v12H6z',
  /** A clock with an arrow running back round it. */
  history:
    'M4 12A9 9 0 1 1 6.64 18.36L8.05 16.95A7 7 0 1 0 6 12ZM1.5 12h7L5 15.5ZM12 7h2v4.6l3.2 1.9-1 1.7-4.2-2.5Z',
  server:
    'M4 3h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm1 2v4h14V5Zm2 1h2v2H7Zm-3 7h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Zm1 2v4h14v-4Zm2 1h2v2H7Z',
  check: 'M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L20.1 8.4 18.7 7z',
  eye: 'M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7Zm0 2c-3.6 0-6.6 3-7.8 5 1.2 2 4.2 5 7.8 5s6.6-3 7.8-5c-1.2-2-4.2-5-7.8-5Zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z',
  film: 'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 2v2h2V6Zm12 0v2h2V6ZM5 10v4h2v-4Zm12 0v4h2v-4ZM5 16v2h2v-2Zm12 0v2h2v-2ZM9 6v12h6V6Z',
  tv: 'M4 5h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7v1h3v2H8v-2h3v-1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1 2v9h14V7Z',
  home: 'M12 3 2.5 11H5v9h5v-6h4v6h5v-9h2.5Z',
  folder: 'M3 5a1 1 0 0 1 1-1h6l2 2h8a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Zm2 3v10h14V8Z',
  music: 'M19 3v12.5a3.5 3.5 0 1 1-2-3.16V7l-8 1.8v8.7A3.5 3.5 0 1 1 7 14.34V5.2Z',
  search:
    'M10.5 3a7.5 7.5 0 0 1 5.96 12.05l4.25 4.24-1.42 1.42-4.24-4.25A7.5 7.5 0 1 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z',
  user: 'M12 3a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm0 8c4.4 0 8 2.2 8 5v3H4v-3c0-2.8 3.6-5 8-5Zm0 2c-3.5 0-6 1.6-6 3v1h12v-1c0-1.4-2.5-3-6-3Z',
  heart:
    'M12 21.2 10.5 19.8C5.3 15.1 2 12.1 2 8.4 2 5.4 4.4 3 7.4 3c1.7 0 3.4.8 4.6 2.1C13.2 3.8 14.9 3 16.6 3 19.6 3 22 5.4 22 8.4c0 3.7-3.3 6.7-8.5 11.4Z',
  heartOutline:
    'M12 21.2 10.5 19.8C5.3 15.1 2 12.1 2 8.4 2 5.4 4.4 3 7.4 3c1.7 0 3.4.8 4.6 2.1C13.2 3.8 14.9 3 16.6 3 19.6 3 22 5.4 22 8.4c0 3.7-3.3 6.7-8.5 11.4Zm0-2.7.1-.1C16.9 14.1 20 11.3 20 8.4 20 6.5 18.5 5 16.6 5c-1.5 0-3 1-3.6 2.4h-2C10.4 6 8.9 5 7.4 5 5.5 5 4 6.5 4 8.4c0 2.9 3.1 5.7 7.9 10Z',
  replay: 'M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8Z',
  external:
    'M14 3h7v7h-2V6.4l-8.3 8.3-1.4-1.4L17.6 5H14ZM5 5h6v2H5v12h12v-6h2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
  download: 'M11 3h2v8.6l3.3-3.3 1.4 1.4-5.7 5.7-5.7-5.7 1.4-1.4 3.3 3.3ZM4 14h2v4h12v-4h2v6H4Z',
  close: 'M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4Z',
  settings:
    'M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L14.9 3h-4l-.4 2.7a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.4 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.7h4l.4-2.7a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z',
  display:
    'M3 4h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-7v2h3v2H7v-2h3v-2H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 2v10h16V6Z',
  key: 'M7 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm5.6-4H22v4h-2v3h-3v-3h-4.4a6 6 0 1 1 0-4Z',
  shield:
    'M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5Zm0 2.2 6 2.2V11c0 3.9-2.5 7.6-6 8.9-3.5-1.3-6-5-6-8.9V6.4Z',
  edit: 'M4 17.2V20h2.8l8.3-8.3-2.8-2.8ZM19.7 7.1a1 1 0 0 0 0-1.4L18.3 4.3a1 1 0 0 0-1.4 0l-1.4 1.4 2.8 2.8Z',
  logout:
    'M10 4H4v16h6v2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h6Zm6.6 3.6L21 12l-4.4 4.4-1.4-1.4 2-2H9v-2h8.2l-2-2Z',
  chevronDown: 'm4.6 8.6 7.4 7.4 7.4-7.4 1.4 1.4-8.8 8.8L3.2 10Z',
  more: 'M5 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm7 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm7 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
  star: 'm12 2.5 2.9 6.1 6.6.8-4.9 4.6 1.3 6.5L12 17.3l-5.9 3.2 1.3-6.5-4.9-4.6 6.6-.8Z',
  back: 'M15.4 4.6 8 12l7.4 7.4-1.4 1.4L5.2 12 14 3.2Z',
  chevronRight: 'M8.6 4.6 16 12l-7.4 7.4 1.4 1.4 8.8-8.8L10 3.2Z',
  chevronLeft: 'M15.4 4.6 8 12l7.4 7.4-1.4 1.4L5.2 12 14 3.2Z',
  volumeOff:
    'M4 9h4l5-4v14l-5-4H4Zm12.3.3 1.4-1.4 2.1 2.1 2.1-2.1 1.4 1.4-2.1 2.1 2.1 2.1-1.4 1.4-2.1-2.1-2.1 2.1-1.4-1.4 2.1-2.1Z',
  volumeOn:
    'M4 9h4l5-4v14l-5-4H4Zm12-1.5a6 6 0 0 1 0 9l-1.4-1.4a4 4 0 0 0 0-6.2Zm2.8-2.8a10 10 0 0 1 0 14.6l-1.4-1.4a8 8 0 0 0 0-11.8Z',
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
  size = 18,
  class: className,
}: {
  name: IconRef;
  size?: number;
  class?: string;
}): JSX.Element {
  return (
    <svg
      class={`lmn-icon${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={name in PATHS ? PATHS[name as IconName] : name} fill-rule="evenodd" />
    </svg>
  );
}
