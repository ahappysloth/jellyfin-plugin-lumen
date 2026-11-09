import { afterEach, describe, expect, it, vi } from 'vitest';
import { findSyncPlay, resetSyncPlayCache } from './syncPlay';
import { SYNCPLAY_MANAGER_METHODS } from './registry';

const manager = (): Record<string, unknown> =>
  Object.fromEntries(SYNCPLAY_MANAGER_METHODS.map((m) => [m, () => false]));
/** Babel-minified source of plugins/syncPlay/core/index.js: the export's keys survive. */
const CORE = 'var s=new o(r);t.default={Helper:i,Manager:s,PlayerFactory:r,Players:{GenericPlayer:a}}';

function fakeWebpack(modules: Record<string, { source: string; exports: unknown }>) {
  const required: string[] = [];
  const require = Object.assign(
    (id: string) => {
      required.push(id);
      return modules[id]!.exports;
    },
    { m: Object.fromEntries(Object.entries(modules).map(([id, m]) => [id, m.source])) },
  );
  const push = vi.fn((chunk: [unknown, unknown, (r: typeof require) => void]) => chunk[2](require));
  return { win: { webpackChunk: Object.assign([], { push }) } as unknown as Window, required };
}

describe('findSyncPlay', () => {
  afterEach(resetSyncPlayCache);

  it('finds the core module by its export keys and returns its Manager', () => {
    const m = manager();
    const { win, required } = fakeWebpack({
      '1': { source: 'x.Manager.isSyncPlayEnabled()', exports: {} },
      '2': { source: CORE, exports: { default: { Manager: m } } },
    });
    expect(findSyncPlay(win)).toBe(m);
    expect(required).toEqual(['2']);
  });

  it('returns null when the Manager lacks a method Lumen calls', () => {
    const m = manager();
    delete m.haltGroupPlayback;
    const { win } = fakeWebpack({ '2': { source: CORE, exports: { default: { Manager: m } } } });
    expect(findSyncPlay(win)).toBeNull();
  });

  it('requires nothing when two modules look like the core', () => {
    const { win, required } = fakeWebpack({
      '1': { source: CORE, exports: {} },
      '2': { source: CORE, exports: {} },
    });
    expect(findSyncPlay(win)).toBeNull();
    expect(required).toEqual([]);
  });

  it('returns null without webpack', () => {
    expect(findSyncPlay({} as Window)).toBeNull();
  });
});
