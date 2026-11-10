import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN, loadState } from '../support/api';
import { login } from '../support/login';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/**
 * Deferred to follow-ups, so off here, but checked where this pass fixed them.
 * - color-contrast: text over backdrops and trailers, which axe can't measure and the scrims leave to the artwork
 *   (follow-up: contrast over artwork).
 * - target-size: controls below 24×24 px (follow-up: small targets). axe passes the hero's pager even at its old
 *   14×3 px, so its size is measured below instead.
 * - label-content-name-mismatch: experimental in axe, so off in the main run and checked on its own (cards included).
 */
const DEFERRED = ['color-contrast', 'target-size', 'label-content-name-mismatch'];

type Also = { rules: string[]; include?: string; exclude?: string };
const NAMES: Also = { rules: ['label-content-name-mismatch'] };

/** No serious or critical violation, nor any landmark one (one main, one banner, each landmark told apart). */
async function expectNoViolations(page: Page, name: string, also: Also[] = []): Promise<void> {
  const runs = [new AxeBuilder({ page }).withTags(TAGS).disableRules(DEFERRED)];
  for (const { rules, include, exclude } of [NAMES, ...also]) {
    let builder = new AxeBuilder({ page }).withRules(rules);
    if (include) builder = builder.include(include);
    if (exclude) builder = builder.exclude(exclude);
    runs.push(builder);
  }
  const found: string[] = [];
  for (const run of runs) {
    const { violations } = await run.analyze();
    for (const v of violations) {
      if (v.impact === 'serious' || v.impact === 'critical' || v.id.startsWith('landmark-'))
        found.push(`${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    }
  }
  expect(found, `axe on ${name}`).toEqual([]);
}

test('Lumen pages have no serious accessibility violations', { tag: '@smoke' }, async ({ page }) => {
  const { items, libraries } = loadState();
  await login(page, ADMIN);

  await expect(page.locator('#lmn-root .lmn-hero')).toBeVisible();
  await expectNoViolations(page, 'home');
  // The pager's dashes are 24 px targets at least (WCAG 2.5.8), however thin the bars they draw.
  const dashes = await page
    .locator('#lmn-root .lmn-hero__dash')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => Math.min(r.width, r.height)));
  expect(dashes.length).toBeGreaterThan(1);
  for (const side of dashes) expect(side).toBeGreaterThanOrEqual(24);

  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Lumen Alpha' })).toBeVisible();
  await expect(page.locator('#lmn-root .lmn-cast .lmn-person').first()).toBeVisible();
  await expectNoViolations(page, 'movie details', [{ rules: ['color-contrast'], include: '.lmn-cast' }]);

  await page.goto(`/web/#/details?id=${items['Lumen Show']}`);
  await expect(page.locator('#lmn-root .lmn-episode').first()).toBeVisible();
  await expectNoViolations(page, 'series details');

  await page.goto(`/web/#/movies?topParentId=${libraries.movies}`);
  await expect(page.locator('#lmn-root main .lmn-card').first()).toBeVisible();
  await expectNoViolations(page, 'Movies');
});
