import { afterEach, describe, expect, it } from 'vitest';
import { DEVICE_LOG_KEY, lastAttempt } from '../trailerInfo/deviceLog';
import { MAX_STEPS, MAX_TITLES, TRAILER_LOG_KEY, trailerLogger } from './trailerLog';

describe('the trailer log', () => {
  afterEach(() => sessionStorage.clear());

  it('is read by the Trailer section under the same key', () => {
    expect(DEVICE_LOG_KEY).toBe(TRAILER_LOG_KEY);
  });

  it('stores nothing until the attempt has a step, then keeps it as the title’s last attempt', () => {
    trailerLogger('m1', false)!.add({ source: 'imdb', quality: 'hd', outcome: 'played', ms: 800 });
    const later = trailerLogger('m1', true)!;
    expect(lastAttempt('m1')!.steps).toEqual([{ source: 'imdb', quality: 'hd', outcome: 'played', ms: 800 }]);

    later.add({ source: 'youtube', outcome: 'skipped', message: 'tv' });
    expect(lastAttempt('m1')).toMatchObject({ tv: true, steps: [{ source: 'youtube', outcome: 'skipped' }] });
  });

  it('ends a pending step once, and keeps messages short', () => {
    const log = trailerLogger('m1', false)!;
    const step = log.add({ source: 'imdb', quality: 'main', outcome: 'pending' });
    log.end(step, { outcome: 'error', code: 4, message: 'x'.repeat(300) });
    log.end(step, { outcome: 'played' });

    const stored = lastAttempt('m1')!.steps[0]!;
    expect(stored.outcome).toBe('error');
    expect(stored.code).toBe(4);
    expect(stored.message).toHaveLength(120);
  });

  it('is bounded: the latest titles, and the latest steps of each', () => {
    for (let i = 0; i < MAX_TITLES + 5; i++)
      trailerLogger(`t${i}`, false)!.add({ source: 'local', outcome: 'played' });
    const log = trailerLogger('t0x', false)!;
    for (let i = 0; i < MAX_STEPS + 3; i++) log.add({ source: 'imdb', outcome: 'timeout', code: i });

    const stored = JSON.parse(sessionStorage.getItem(TRAILER_LOG_KEY)!) as Record<string, unknown>;
    expect(Object.keys(stored)).toHaveLength(MAX_TITLES);
    expect(lastAttempt('t0')).toBeNull();
    expect(lastAttempt(`t${MAX_TITLES + 4}`)).not.toBeNull();
    expect(lastAttempt('t0x')!.steps.map((s) => s.code)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('is off without a title, and survives storage that refuses', () => {
    expect(trailerLogger(null, false)).toBeNull();
    sessionStorage.setItem(TRAILER_LOG_KEY, '{not json');
    expect(lastAttempt('m1')).toBeNull();
    trailerLogger('m1', false)!.add({ source: 'local', outcome: 'played' });
    expect(lastAttempt('m1')).not.toBeNull();
  });
});
