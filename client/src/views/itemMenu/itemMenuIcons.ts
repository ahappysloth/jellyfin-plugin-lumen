import { defineIcons } from '../../components/icons';

/**
 * Icons only the item menu shows, so they download with it (components/icons.tsx). Closed captions is the player's
 * icon too, repeated here: one lazy chunk importing another's set would load it.
 */
export const ITEM_MENU_ICONS = defineIcons({
  closedCaption:
    'M10 9.17a3 3 0 1 0 0 5.66M17 9.17a3 3 0 1 0 0 5.66M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
  playlistAdd: 'M16 5H3M11 12H3M16 19H3M18 9v6M21 12h-6',
  collection: 'M7 2h10M5 6h14M5 10h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z',
  copy: 'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2ZM4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2',
  image:
    'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM7 9a2 2 0 1 0 4 0 2 2 0 1 0-4 0M21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21',
  refresh:
    'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5',
  trash:
    'M10 11v6M14 11v6M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
});
