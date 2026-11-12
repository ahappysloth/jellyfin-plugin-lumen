import { afterEach, describe, expect, it, vi } from 'vitest';

// test/setup.ts stands in for this module everywhere else (jsdom loads no stylesheets); this file tests the real one.
vi.unmock('./loadStyles');

const fresh = async () => {
  vi.resetModules();
  return import('./loadStyles');
};

const links = (name: string) =>
  [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].filter((l) =>
    l.href.includes(name),
  );

describe('loadStyles', () => {
  afterEach(() => {
    document.head.innerHTML = '';
  });

  it("links the sheet beside lumen.css with lumen.css's version, once, and resolves when it applies", async () => {
    const core = document.createElement('link');
    core.rel = 'stylesheet';
    core.href = '../Lumen/Assets/lumen.css?v=abc';
    document.head.appendChild(core);
    const { loadStyles } = await fresh();

    let done = false;
    const sheet = loadStyles('lumen-player.css').then(() => (done = true));
    expect(loadStyles('lumen-player.css')).toBe(loadStyles('lumen-player.css'));
    const link = links('lumen-player.css')[0]!;
    expect(links('lumen-player.css')).toHaveLength(1);
    expect(new URL(link.href).search).toBe('?v=abc');
    // After lumen.css, so its rules win ties with the core's, as they did inside it.
    expect(document.head.lastElementChild).toBe(link);

    await Promise.resolve();
    expect(done).toBe(false);
    link.dispatchEvent(new Event('load'));
    await sheet;
    expect(done).toBe(true);
  });

  it("rejects if the sheet can't load, and links it afresh next time", async () => {
    const { loadStyles } = await fresh();
    const first = loadStyles('lumen-secondary.css');
    links('lumen-secondary.css')[0]!.dispatchEvent(new Event('error'));
    await expect(first).rejects.toThrow(/lumen-secondary\.css/);
    expect(links('lumen-secondary.css')).toHaveLength(0);

    const second = loadStyles('lumen-secondary.css');
    expect(second).not.toBe(first);
    links('lumen-secondary.css')[0]!.dispatchEvent(new Event('load'));
    await expect(second).resolves.toBeUndefined();
  });
});
