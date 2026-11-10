import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminApi } from './adminApi';
import { parseReleaseNotes, waitForRestart } from './UpdatesSettings';

describe('release notes', () => {
  it('reads a CHANGELOG entry into headings and whole items', () => {
    const text = [
      '### Added',
      "- Dashboard look: the admin Dashboard takes Lumen's colours,",
      '  type and shapes.',
      '- Check for updates.',
      '',
      '### Fixed',
      '- The scrollbar stays.',
    ].join('\n');

    expect(parseReleaseNotes(text)).toEqual([
      {
        heading: 'Added',
        items: [
          "Dashboard look: the admin Dashboard takes Lumen's colours, type and shapes.",
          'Check for updates.',
        ],
      },
      { heading: 'Fixed', items: ['The scrollbar stays.'] },
    ]);
  });

  it('keeps plain notes without headings or bullets', () => {
    expect(parseReleaseNotes('Faster home page.')).toEqual([{ heading: null, items: ['Faster home page.'] }]);
  });
});

describe('waiting for a restart', () => {
  const api = (states: ({ up: false } | { up: true; restartPending: boolean })[]) => {
    let i = 0;
    return {
      serverState: vi.fn(async () => states[Math.min(i++, states.length - 1)]!),
    } as unknown as AdminApi;
  };
  const run = async (p: Promise<boolean>): Promise<boolean> => {
    await vi.runAllTimersAsync();
    return p;
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is back once Jellyfin went down and answers again', async () => {
    const a = api([
      { up: true, restartPending: true },
      { up: false },
      { up: false },
      { up: true, restartPending: false },
    ]);
    expect(await run(waitForRestart(a, 10, 1000))).toBe(true);
    expect(a.serverState).toHaveBeenCalledTimes(4);
  });

  it('is back when the restart was quicker than one check (no restart pending any more)', async () => {
    expect(await run(waitForRestart(api([{ up: true, restartPending: false }]), 10, 1000))).toBe(true);
  });

  it('gives up if Jellyfin never restarts', async () => {
    expect(await run(waitForRestart(api([{ up: true, restartPending: true }]), 10, 100))).toBe(false);
  });
});
