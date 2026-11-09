import { findSyncPlay } from '../../compat/syncPlay';
import { type MenuEntry, openContextMenu } from '../../components/ContextMenu';
import { Icon } from '../../components/icons';
import { showToast } from '../../components/Toast';
import { strings } from '../../strings';
import type { ViewContext } from '../context';
import type { SyncPlayState } from './syncPlayState';

const failed = (): void => showToast(strings.syncPlayFailed);

/** Opens the Watch together menu under `from`: the user's group and its actions, or the groups to join. */
export async function openWatchTogether(
  ctx: ViewContext,
  state: SyncPlayState,
  from: HTMLElement,
): Promise<void> {
  const rect = from.getBoundingClientRect();
  const at = { x: rect.left, y: rect.bottom + 8, returnFocus: from, label: strings.watchTogether };
  const manager = findSyncPlay();

  if (state.group) {
    const entries: MenuEntry[] = [];
    if (state.canStart && manager)
      entries.push({
        label: strings.startGroupPlayback,
        icon: 'play',
        onSelect: () => manager.resumeGroupPlayback(ctx.client),
      });
    if (state.canStop && manager)
      entries.push({
        label: strings.stopGroupPlayback,
        icon: 'stop',
        onSelect: () => manager.haltGroupPlayback(ctx.client),
      });
    entries.push({
      label: strings.leaveGroup,
      icon: 'logout',
      onSelect: () => void ctx.api.leaveSyncPlayGroup().catch(failed),
    });
    openContextMenu({
      ...at,
      title: state.group.GroupName,
      subtitle: state.group.Participants.join(', '),
      entries,
    });
    return;
  }

  const groups = await ctx.api.getSyncPlayGroups().catch(() => null);
  if (groups === null) return failed();
  const entries: MenuEntry[] = groups.map((g) => ({
    label: g.GroupName,
    detail: g.Participants.join(', '),
    icon: 'group',
    onSelect: () => void ctx.api.joinSyncPlayGroup(g.GroupId).catch(failed),
  }));
  if (state.canCreate) {
    const name = state.self;
    entries.push({
      label: strings.newGroup,
      icon: 'plus',
      onSelect: () =>
        void ctx.api.createSyncPlayGroup(strings.groupName(name ?? strings.watchTogether)).catch(failed),
    });
  }
  openContextMenu({
    ...at,
    title: strings.watchTogether,
    subtitle: groups.length === 0 ? `${strings.syncPlay} · ${strings.noGroups}` : strings.syncPlay,
    entries,
  });
}

/** The nav's Watch together button; lit while the user is in a group. Hidden when SyncPlay isn't available. */
export function WatchTogetherButton({
  ctx,
  state,
  class: className,
  size = 18,
}: {
  ctx: ViewContext;
  state: SyncPlayState;
  class: string;
  size?: number;
}) {
  if (!state.available) return null;
  const inGroup = !!state.group;
  return (
    <button
      type="button"
      class={`${className}${inGroup ? ' is-active is-syncplay' : ''}`}
      aria-haspopup="menu"
      aria-label={
        inGroup
          ? `${strings.watchTogether}: ${strings.inGroup(state.group!.GroupName)}`
          : strings.watchTogether
      }
      onClick={(e) => void openWatchTogether(ctx, state, e.currentTarget)}
    >
      <Icon name="group" size={size} />
    </button>
  );
}
