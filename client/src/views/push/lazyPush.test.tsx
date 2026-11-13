import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';

/** A module that hasn't loaded the toggle's file yet, whatever ran before. */
const freshModule = async () => {
  vi.resetModules();
  return import('./lazyPush');
};

describe('lazyPush', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    cleanup();
    vi.doUnmock('./PushSettings');
    vi.resetModules();
    vi.useRealTimers();
  });

  it("shows nothing until the toggle's file is in, then the toggle", async () => {
    vi.doMock('./PushSettings', () => ({
      PushToggle: (p: { titled?: boolean }) => (
        <div data-testid="toggle">{p.titled ? 'titled' : 'plain'}</div>
      ),
      resumePush: vi.fn(),
    }));
    const fresh = await freshModule();
    const { container } = render(<fresh.LazyPushToggle ctx={makeContext(createFakeClient())} titled />);

    expect(container).toBeEmptyDOMElement();
    expect(await screen.findByTestId('toggle')).toHaveTextContent('titled');
  });

  it("leaves the page without a toggle if its file can't load, and asks again next time", async () => {
    vi.doMock('./PushSettings', () => {
      throw new Error('Failed to fetch dynamically imported module');
    });
    const fresh = await freshModule();
    const { container } = render(<fresh.LazyPushToggle ctx={makeContext(createFakeClient())} />);

    await expect(fresh.loadPush()).rejects.toThrow();
    expect(container).toBeEmptyDOMElement();

    vi.doMock('./PushSettings', () => ({
      PushToggle: () => <div data-testid="toggle" />,
      resumePush: vi.fn(),
    }));
    await expect(fresh.loadPush()).resolves.toBeDefined();
  });

  it('downloads nothing at startup on a device that never turned notifications on', async () => {
    vi.useFakeTimers();
    const resumePush = vi.fn();
    const factory = vi.fn(() => ({ PushToggle: () => null, resumePush }));
    vi.doMock('./PushSettings', factory);
    const fresh = await freshModule();

    fresh.resumePush(makeContext(createFakeClient()));
    await vi.advanceTimersByTimeAsync(10_000);

    expect(factory).not.toHaveBeenCalled();
    expect(resumePush).not.toHaveBeenCalled();
  });

  it("checks the device's subscription once the page is idle, where notifications are on", async () => {
    vi.useFakeTimers();
    const resumePush = vi.fn();
    vi.doMock('./PushSettings', () => ({ PushToggle: () => null, resumePush }));
    const fresh = await freshModule();
    localStorage.setItem(fresh.PUSH_FLAG, 'user1');
    const ctx = makeContext(createFakeClient());

    fresh.resumePush(ctx);
    expect(resumePush).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(resumePush).toHaveBeenCalledWith(ctx);
  });

  it('reads the flag as unset where storage is blocked', async () => {
    const fresh = await freshModule();
    const blocked = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect(fresh.pushFlag()).toBeNull();
    blocked.mockRestore();
  });
});
