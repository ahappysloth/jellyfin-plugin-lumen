/** Small inline SVG icons (24×24 grid, currentColor). Decorative: always aria-hidden; label the control instead. */
import type { JSX } from 'preact';

const PATHS = {
  play: 'M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z',
  pause: 'M7 4h3v16H7zM14 4h3v16h-3z',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm-1 7h2v6h-2zm0-4h2v2h-2z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
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
    'M12 20.6s-7.6-4.6-9.7-9.4C.8 7.8 3 4 6.8 4c2.1 0 3.7 1.1 4.6 2.6h1.2C13.5 5.1 15.1 4 17.2 4 21 4 23.2 7.8 21.7 11.2 19.6 16 12 20.6 12 20.6Z',
  chevronDown: 'm4.6 8.6 7.4 7.4 7.4-7.4 1.4 1.4-8.8 8.8L3.2 10Z',
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

export function Icon({
  name,
  size = 18,
  class: className,
}: {
  name: IconName;
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
      <path d={PATHS[name]} fill-rule="evenodd" />
    </svg>
  );
}
