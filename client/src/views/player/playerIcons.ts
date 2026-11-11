import { defineIcons } from '../../components/icons';

/** Icons only the player shows, so they download with it (components/icons.tsx). */
export const PLAYER_ICONS = defineIcons({
  airplay:
    'M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2.2l-1.7-2H19V6H5v9h3.9l-1.7 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm7 9 6 7H6Z',
  arrowLeft: 'M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20Z',
  cast: 'M1 18v3h3a3 3 0 0 0-3-3Zm0-4v2a5 5 0 0 1 5 5h2a7 7 0 0 0-7-7Zm0-4v2a9 9 0 0 1 9 9h2A11 11 0 0 0 1 10Zm20-7H3a2 2 0 0 0-2 2v3h2V5h18v14h-7v2h7a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Z',
  closedCaption:
    'M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 14H5V6h14ZM7 15h3a1 1 0 0 0 1-1v-1H9.5v.5h-2v-3h2v.5H11v-1a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1Zm7 0h3a1 1 0 0 0 1-1v-1h-1.5v.5h-2v-3h2v.5H18v-1a1 1 0 0 0-1-1h-3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1Z',
  fullscreen: 'M4 4h6v2H6v4H4Zm10 0h6v6h-2V6h-4ZM4 14h2v4h4v2H4Zm14 0h2v6h-6v-2h4Z',
  fullscreenExit: 'M8 4h2v6H4V8h4Zm6 0h2v4h4v2h-6ZM4 14h6v6H8v-4H4Zm10 0h6v2h-4v4h-2Z',
  pip: 'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1 2v10h16V7Zm8 4h7v5h-7Z',
  quality:
    'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm0 2v10h16V7Zm6 2.2 5 2.8-5 2.8Z',
  skipNext: 'M6 6.5v11a1 1 0 0 0 1.5.86L15 13.4V17h2V7h-2v3.6L7.5 5.64A1 1 0 0 0 6 6.5Z',
});
