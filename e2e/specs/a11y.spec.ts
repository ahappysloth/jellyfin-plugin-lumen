import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN, SEERR_URL, STUB_SEERR, api, loadState, resetLumen } from '../support/api';
import { login } from '../support/login';
import { PROVIDER_IDS, configureTrakt, resetStub, setProviderIds } from '../support/trakt';

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

/**
 * No serious or critical violation, nor any landmark one (one main, one banner, each landmark told apart). `within`:
 * only that part of the page (Lumen's settings page sits in jellyfin-web's Dashboard, whose drawer isn't Lumen's).
 * `unnamed`: what the check of names leaves out (see where it's passed).
 */
async function expectNoViolations(page: Page, name: string, also: Also[] = [], within?: string, unnamed?: string): Promise<void> {
  let main = new AxeBuilder({ page }).withTags(TAGS).disableRules(DEFERRED);
  if (within) main = main.include(within);
  const runs = [main];
  for (const { rules, include = within, exclude } of [{ ...NAMES, exclude: unnamed }, ...also]) {
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

test.describe('Top charts, My requests and Lumen’s settings', () => {
  test.beforeEach(async () => {
    await resetStub();
    await setProviderIds((name) => PROVIDER_IDS[name]!);
  });
  test.afterEach(async () => {
    await setProviderIds(() => ({}));
    await resetLumen();
  });

  test('have no serious accessibility violations', async ({ page }) => {
    const { admin } = loadState();
    await configureTrakt({ trakt: true, seerr: false }, [{ Type: 'Top10Movies' }]);
    await login(page, ADMIN);
    // The row's title is a link to its chart, named "…, see all in Top charts".
    const seeAll = page.getByRole('link', { name: 'Top 10 Movies This Week, see all in Top charts' });
    await expect(seeAll).toBeVisible();
    await expectNoViolations(page, 'a Top 10 row’s title', [], '.lmn-row__title');

    await seeAll.click();
    await expect(page.getByRole('list', { name: 'Top movies this week' }).getByRole('listitem')).toHaveCount(2);
    // Ranked cards' names ("1, Lumen Beta") are a follow-up, like catalog cards': an aria-label that leaves out the
    // year and rating shown under the title, which label-content-name-mismatch asks for.
    await expectNoViolations(page, 'Top charts', [{ rules: ['color-contrast'], include: '.lmn-browse__header' }], undefined, '.lmn-card');

    // My requests, with one downloading (a progress bar) and one declined.
    const config = await api<Record<string, unknown>>('/Lumen/Admin/Config', { token: admin.token });
    await api('/Lumen/Admin/Config', {
      method: 'POST',
      token: admin.token,
      body: { ...config, RequestsEnabled: true, SeerrUrl: SEERR_URL, SeerrApiKey: 'stub-key' },
    });
    for (const [id, scenario] of [
      [702, { requestStatus: 3 }],
      [603, { requestStatus: 2, mediaStatus: 3, downloads: [{ size: 1000, sizeLeft: 250, etaSeconds: 600 }] }],
    ] as const) {
      await api('/Lumen/Requests', { method: 'POST', token: admin.token, body: { MediaType: 'movie', TmdbId: id } });
      await fetch(`${STUB_SEERR}/__stub/progress`, { method: 'POST', body: JSON.stringify({ [id]: scenario }) });
    }
    await page.goto('/web/#/home?lumen=requests');
    await page.reload(); // the page's settings (request features) are read as it loads
    const requests = page.getByRole('list', { name: 'My requests' });
    await expect(requests.getByRole('link')).toHaveCount(2);
    await expect(requests.getByRole('progressbar')).toBeVisible();
    await expectNoViolations(page, 'My requests', [{ rules: ['color-contrast'], include: '.lmn-my-requests' }]);

    // Lumen's settings: both tabs, with a section picked up and the save bar up. Text on plain cards, so contrast too.
    await page.goto('/web/#/configurationpage?name=Lumen');
    const root = page.locator('[id="lmn-admin-root"]:visible');
    await expect(root.getByRole('group', { name: 'Home sections' })).toBeVisible();
    const contrast: Also = { rules: ['color-contrast'] };
    await expectNoViolations(page, 'Lumen settings', [contrast], '#lmn-admin-root');
    const handle = root.getByRole('button', { name: 'Move Continue Watching', exact: true });
    await handle.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await expect(root.locator('.lmna-savebar')).toContainText('Unsaved changes');
    await expectNoViolations(page, 'Lumen settings, a section picked up', [contrast], '#lmn-admin-root');
    await page.keyboard.press('Escape');

    await root.getByRole('tab', { name: 'Storage' }).click();
    await expect(root.getByRole('img', { name: /^Movies by codec: / })).toBeVisible({ timeout: 30_000 });
    await expectNoViolations(page, 'Lumen settings, Storage', [contrast], '#lmn-admin-root');
    // Headings step down one level at a time (moderate to axe, so not in the checks above): the card's sections are
    // h2 under the page's h1.
    await expect(root.getByRole('heading', { name: 'Libraries', level: 2 })).toBeVisible();
    const order = await new AxeBuilder({ page }).withRules(['heading-order']).include('#lmn-admin-root').analyze();
    expect(order.violations.map((v) => v.nodes.map((n) => n.target.join(' ')).join(', '))).toEqual([]);

    // The Health tab, with Seerr set up, so every group has rows, and a device report opened. Its rows' titles are h2
    // too: the cards' names are legends, not headings.
    await root.getByRole('tab', { name: /^Health/ }).click();
    await expect(root.locator('[data-check="requests.seerr"]')).toContainText('answers');
    await expectNoViolations(page, 'Lumen settings, Health', [contrast], '#lmn-admin-root');
    const healthOrder = await new AxeBuilder({ page }).withRules(['heading-order']).include('#lmn-admin-root').analyze();
    expect(healthOrder.violations.map((v) => v.nodes.map((n) => n.target.join(' ')).join(', '))).toEqual([]);
  });
});

