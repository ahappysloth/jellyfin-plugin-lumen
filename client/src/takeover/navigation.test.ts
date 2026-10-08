import { afterEach, describe, expect, it, vi } from 'vitest';
import { onNavigate } from './navigation';

describe('onNavigate', () => {
  const stops: (() => void)[] = [];
  afterEach(() => stops.splice(0).forEach((stop) => stop()));

  it('reports pushState and replaceState navigations once per new href', () => {
    const listener = vi.fn();
    stops.push(onNavigate(listener));

    history.pushState(null, '', '#/details?id=a');
    history.replaceState(null, '', '#/details?id=a');
    history.replaceState(null, '', '#/home');

    expect(listener.mock.calls.map(([href]) => new URL(href as string).hash)).toEqual([
      '#/details?id=a',
      '#/home',
    ]);
  });

  it('stops reporting after unsubscribe', () => {
    const listener = vi.fn();
    const stop = onNavigate(listener);

    history.pushState(null, '', '#/x');
    stop();
    history.pushState(null, '', '#/y');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('wraps history methods only once', () => {
    stops.push(onNavigate(vi.fn()));
    const wrapped = history.pushState;
    stops.push(onNavigate(vi.fn()));

    expect(history.pushState).toBe(wrapped);
  });
});
