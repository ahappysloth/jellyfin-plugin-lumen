import { expect, test, type Page } from '@playwright/test';
import { ADMIN } from '../support/api';
import { login } from '../support/login';

/**
 * Lumen's Inter (client/src/styles/fonts.css): --lmn-font puts Apple's system font first (-apple-system, and
 * BlinkMacSystemFont for Chromium), so a browser on a Mac or an iPhone uses San Francisco and never fetches Inter;
 * elsewhere (Linux, Windows, Android, TVs, and Playwright's WebKit on Linux) it does. Which one this browser is depends
 * on where the tests run, so each test asks the browser.
 */
const hasAppleSystemFont = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const context = document.createElement('canvas').getContext('2d')!;
    const width = (font: string) => {
      context.font = font;
      return context.measureText('mmmmmmmmmmlli WWW 0123456789').width;
    };
    return width('32px -apple-system, BlinkMacSystemFont, monospace') !== width('32px monospace');
  });

const interFaces = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    [...document.fonts].filter((f) => f.family.replace(/"/g, '') === 'Lumen Inter').map((f) => f.status),
  );

test('Inter only without an Apple system font, fetched once and cached for good', { tag: '@smoke' }, async ({ page, baseURL }) => {
  const fetched: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/lumen-font-')) fetched.push(response.url());
  });
  await login(page, ADMIN);
  await expect(page.locator('#lmn-root .lmn-hero')).toBeVisible();

  if (await hasAppleSystemFont(page)) {
    expect(fetched).toEqual([]);
    expect(await interFaces(page)).toEqual(['unloaded', 'unloaded', 'unloaded']);
    return;
  }
  await expect.poll(() => interFaces(page)).toContain('loaded');
  // Beside lumen.css, under any base URL; each weight once.
  for (const url of fetched) expect(new URL(url).pathname).toMatch(/\/Lumen\/Assets\/lumen-font-inter-[456]00-[\w-]+\.woff2$/);
  expect(new Set(fetched).size).toBe(fetched.length);
  const font = await page.request.get(fetched[0]!);
  expect(font.headers()['content-type']).toBe('font/woff2');
  expect(font.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  expect(new URL(fetched[0]!).origin).toBe(new URL(baseURL!).origin);
});

test("the loading veil waits for Lumen's fonts on a cold load, but no more than 800 ms", async ({ browser, page }) => {
  await login(page, ADMIN);
  await expect(page.locator('#lmn-root .lmn-hero')).toBeVisible();
  test.skip(await hasAppleSystemFont(page), 'this browser uses the Apple system font and never fetches Inter');
  const signedIn = await page.context().storageState();

  // A new context: Inter isn't cached. Its files take 3 s, far past the veil's wait.
  const cold = await browser.newContext({ storageState: signedIn });
  try {
    await cold.route(/\/lumen-font-/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await route.continue();
    });
    const coldPage = await cold.newPage();
    // When Lumen's page said it was ready (veil.ts marks the veil while it waits) and when the veil began to lift.
    await coldPage.addInitScript(() => {
      const times: Record<string, number> = {};
      (window as unknown as { __lmnVeil: Record<string, number> }).__lmnVeil = times;
      const watch = (): void => {
        const veil = document.getElementById('lmn-veil');
        if (!veil) {
          requestAnimationFrame(watch);
          return;
        }
        new MutationObserver(() => {
          if (veil.hasAttribute('data-lmn-font-wait')) times.ready ??= performance.now();
          if (veil.classList.contains('is-lifting')) times.lifting ??= performance.now();
        }).observe(veil, { attributes: true });
      };
      watch();
    });
    await coldPage.goto('/web/#/home');
    await expect(coldPage.locator('#lmn-root .lmn-hero')).toBeVisible();
    await expect(coldPage.locator('#lmn-veil')).toHaveCount(0);
    const times = await coldPage.evaluate(() => (window as unknown as { __lmnVeil: Record<string, number> }).__lmnVeil);
    expect(times.ready).toBeDefined();
    const waited = times.lifting! - times.ready!;
    expect(waited).toBeGreaterThanOrEqual(700);
    expect(waited).toBeLessThan(1200);
    // It lifted onto the stand-in; Inter swaps in once it's here.
    await expect.poll(() => interFaces(coldPage), { timeout: 10_000 }).toContain('loaded');
  } finally {
    await cold.close();
  }
});
