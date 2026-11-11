import { defineIcons } from '../../components/icons';

/**
 * Icons only the item menu shows, so they download with it (components/icons.tsx). Closed captions is the player's
 * icon too, repeated here: one lazy chunk importing another's set would load it.
 */
export const ITEM_MENU_ICONS = defineIcons({
  closedCaption:
    'M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 14H5V6h14ZM7 15h3a1 1 0 0 0 1-1v-1H9.5v.5h-2v-3h2v.5H11v-1a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1Zm7 0h3a1 1 0 0 0 1-1v-1h-1.5v.5h-2v-3h2v.5H18v-1a1 1 0 0 0-1-1h-3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1Z',
  playlistAdd: 'M3 6h12v2H3Zm0 4h12v2H3Zm0 4h8v2H3Zm14 0v-3h2v3h3v2h-3v3h-2v-3h-3v-2Z',
  collection:
    'M6 3h12v2H6ZM4 6h16v2H4Zm-1 3h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1Zm1 2v8h16v-8Z',
  copy: 'M8 3h11a1 1 0 0 1 1 1v12h-2V5H8ZM4 7h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Zm1 2v10h9V9Z',
  image:
    'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 2v12h14V6ZM6 17l4-5 3 3.5 2-2.5 3 4ZM9 7.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z',
  refresh: 'M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.2L13 11h7V4Z',
  trash: 'M9 3h6l1 1h4v2H4V4h4ZM6 8h12l-1 12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1Zm2 2 .8 9h6.4l.8-9Z',
});
