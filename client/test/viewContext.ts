import { vi } from 'vitest';
import { LumenApi } from '../src/api/lumenApi';
import type { ClientConfig } from '../src/api/types';
import type { ViewContext } from '../src/views/context';
import type { FakeClient } from './fakeClient';

export const testConfig: ClientConfig = {
  Enabled: true,
  HomeTakeover: true,
  DetailsTakeover: true,
  AccentColor: '#f5a524',
  HeroIntervalSeconds: 8,
  TrailerPreview: false,
  TrailerDelaySeconds: 4,
  BuildHash: 'h',
};

export function makeContext(client: FakeClient, overrides: Partial<ViewContext> = {}): ViewContext {
  return {
    api: new LumenApi(client),
    client,
    config: testConfig,
    userId: client.userId ?? 'user1',
    layout: 'desktop',
    onFallback: vi.fn(),
    navigate: vi.fn(),
    ...overrides,
  };
}
