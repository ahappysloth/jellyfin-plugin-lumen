import type { BaseItem } from '../api/types';
import { removeFromSnapshots, replaceInSnapshots } from './browse/browseStore';
import { clearCachedHome } from './home/homeStore';

/**
 * A title deleted from its ⋯ menu. Saved grids (browseStore) and the cached home are what Back shows first: neither may
 * bring its card back, since opening it would leave jellyfin-web's details page loading forever.
 */
export function forgetItem(userId: string, itemId: string): void {
  removeFromSnapshots(itemId);
  clearCachedHome(userId);
}

/** A title edited from its ⋯ menu, as the server now has it: Back shows it so too (home is fetched afresh). */
export function rememberEdit(userId: string, fresh: BaseItem): void {
  replaceInSnapshots(fresh);
  clearCachedHome(userId);
}
