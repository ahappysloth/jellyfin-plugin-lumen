import { afterEach, describe, expect, it } from 'vitest';
import { getPlaybackManager, resetPlaybackManagerCache } from './playbackManager';

const manager = {
  getCurrentPlayer: () => null,
  setMaxStreamingBitrate: () => undefined,
  getPlayerState: () => ({}),
  seek: () => undefined,
  playPause: () => undefined,
  audioTracks: () => [],
};

/** A stand-in for jellyfin-web's webpack runtime: `push` hands chunk runtimes the module loader. */
function fakeWebpack(modules: Record<string, { source: string; exports: Record<string, unknown> }>): Window {
  const require = Object.assign((id: string) => modules[id]!.exports, {
    m: Object.fromEntries(Object.entries(modules).map(([id, m]) => [id, m.source])),
  });
  const chunks = Object.assign([], {
    push: (chunk: [unknown, unknown, (r: typeof require) => void]) => chunk[2](require),
  });
  return { webpackChunk: chunks } as unknown as Window;
}

describe('getPlaybackManager', () => {
  afterEach(resetPlaybackManagerCache);

  it("finds jellyfin-web's playback manager by shape, not by module id", () => {
    const win = fakeWebpack({
      '1': { source: 'getCurrentPlayer only', exports: { a: { getCurrentPlayer: 'x' } } },
      '68221': { source: 'setMaxStreamingBitrate(){} getCurrentPlayer(){}', exports: { g: 1, f: manager } },
    });
    expect(getPlaybackManager(win)).toBe(manager);
  });

  it('returns null (stock player) when the bundle has no such module or no webpack runtime', () => {
    expect(getPlaybackManager(fakeWebpack({ '1': { source: 'nothing', exports: {} } }))).toBeNull();
    resetPlaybackManagerCache();
    expect(getPlaybackManager({} as Window)).toBeNull();
  });
});
