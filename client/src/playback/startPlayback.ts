import type { BaseItem } from '../api/types';
import type { ViewContext } from '../views/context';
import { resolveSeriesPlayTarget } from '../views/details/smartPlay';
import { playItem, resumeTicks } from './play';
import { clearStarting, showStarting, startingFor } from './starting';

/**
 * Plays any card's item: a series resumes or starts its next episode; anything else plays from its resume point.
 * Resolves false when there was nothing to play (a series with no episodes).
 */
export async function startPlayback(ctx: ViewContext, item: BaseItem): Promise<boolean> {
  showStarting(startingFor(ctx.client, item));
  try {
    const started = await start(ctx, item);
    if (!started) clearStarting();
    return started;
  } catch (error) {
    clearStarting();
    throw error;
  }
}

async function start(ctx: ViewContext, item: BaseItem): Promise<boolean> {
  if (item.Type === 'Series') {
    const userId = ctx.client.getCurrentUserId();
    const target = await resolveSeriesPlayTarget(ctx.api, item.Id);
    if (!target) return false;
    if (ctx.client.getCurrentUserId() !== userId) return false; // signed out meanwhile
    await playItem(ctx.api, ctx.client, target.episodeId, target.startTicks);
    return true;
  }
  await playItem(ctx.api, ctx.client, item, resumeTicks(item));
  return true;
}
