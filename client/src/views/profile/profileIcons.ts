import { defineIcons } from '../../components/icons';

/** Icons only the profile pages show, so they download with them (components/icons.tsx). */
export const PROFILE_ICONS = defineIcons({
  gamepad:
    'M7 7h10a5 5 0 0 1 0 10c-1.5 0-2.4-.8-3.2-1.6-.5-.5-1.1-.4-1.8-.4s-1.3-.1-1.8.4C9.4 16.2 8.5 17 7 17A5 5 0 0 1 7 7Zm-1 3v1.5H4.5v2H6V15h2v-1.5h1.5v-2H8V10Zm9.5 1a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm2.5-2a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z',
  subtitles:
    'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1 2v10h16V7ZM6 11h5v2H6Zm7 0h5v2h-5Zm-7 3h8v2H6Zm10 0h2v2h-2Z',
});
