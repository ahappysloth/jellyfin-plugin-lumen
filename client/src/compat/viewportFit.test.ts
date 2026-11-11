import { afterEach, describe, expect, it } from 'vitest';
import { keepViewportCover } from './viewportFit';

// jellyfin-web 12.4's appHost.setUserScalable(), as the photo slideshow calls it.
const SCALABLE = 'width=device-width, initial-scale=1, minimum-scale=1, user-scalable=yes';
const flush = (): Promise<void> => Promise.resolve();

function viewport(content: string): HTMLMetaElement {
  const meta = document.createElement('meta');
  meta.name = 'viewport';
  meta.content = content;
  document.head.append(meta);
  return meta;
}

describe('keepViewportCover', () => {
  let stop = (): void => {};
  afterEach(() => {
    stop();
    document.head.innerHTML = '';
  });

  it('puts viewport-fit=cover back after jellyfin-web rewrites the viewport', async () => {
    const meta = viewport('width=device-width, initial-scale=1, viewport-fit=cover');
    stop = keepViewportCover();
    meta.setAttribute('content', SCALABLE);
    await flush();
    expect(meta.content).toBe(`${SCALABLE}, viewport-fit=cover`);
  });

  it('leaves a viewport that still has cover as it is', async () => {
    const meta = viewport('width=device-width, viewport-fit=cover');
    stop = keepViewportCover();
    meta.setAttribute('content', 'viewport-fit=cover, width=device-width, user-scalable=no');
    await flush();
    expect(meta.content).toBe('viewport-fit=cover, width=device-width, user-scalable=no');
  });

  it('does nothing where the page started without cover', async () => {
    const meta = viewport('width=device-width, initial-scale=1');
    stop = keepViewportCover();
    meta.setAttribute('content', SCALABLE);
    await flush();
    expect(meta.content).toBe(SCALABLE);
  });

  it('does nothing without a viewport meta', () => {
    expect(() => keepViewportCover()()).not.toThrow();
  });

  it('stops watching once stopped', async () => {
    const meta = viewport('width=device-width, viewport-fit=cover');
    keepViewportCover()();
    meta.setAttribute('content', SCALABLE);
    await flush();
    expect(meta.content).toBe(SCALABLE);
  });
});
