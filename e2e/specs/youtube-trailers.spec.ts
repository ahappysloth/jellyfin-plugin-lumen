import { expect, test, type Page } from '@playwright/test';
import { ADMIN, api, loadState, SEERR_URL, STUB_SEERR } from '../support/api';
import { login } from '../support/login';
import { resetStub } from '../support/trakt';

// "Use YouTube trailers when there's no local one": a title without a local trailer previews its trailer from YouTube,
// in the home hero and behind its details page. CI can't reach YouTube, so the server is started with
// LUMEN_YOUTUBE_EMBED_BASE pointing the browser at a stand-in for YouTube's player (support/stub-seerr.mjs, /embed/…),
// which speaks the player's postMessage protocol as checked against the real one (client/src/views/home/youTubePlayer.ts).
//
// The trailer itself comes the whole way: Lumen Show (the one fixture title without a local trailer) gets TMDB id 1399,
// which the stub Seerr knows with a YouTube trailer (dQw4w9WgXcQ), and the server passes that id on. Where a test needs
// another video (one that can't be embedded, a short one), it swaps the id in the home response.
const SHOW = 'Lumen Show';
const VIDEO = 'dQw4w9WgXcQ';
type Config = Record<string, unknown>;
let saved: Config;

async function setShowTmdbId(id: string | null): Promise<void> {
  const { admin, items } = loadState();
  // What GET gives, as jellyfin-web's metadata editor sends it back, less the trickplay info the server can't read.
  const { Trickplay: _, ...item } = await api<Record<string, unknown>>(`/Items/${items[SHOW]}`, {
    token: admin.token,
    query: { userId: admin.userId },
  });
  await api(`/Items/${items[SHOW]}`, { method: 'POST', token: admin.token, body: { ...item, ProviderIds: id ? { Tmdb: id } : {} } });
}

async function configure(youTubeTrailers: boolean): Promise<void> {
  const { admin, items } = loadState();
  await api('/Lumen/Admin/Config', {
    method: 'POST',
    token: admin.token,
    // Ten slides: every fixture title is one, Lumen Show among them.
    body: { ...saved, YouTubeTrailers: youTubeTrailers, HeroCount: 10, RequestsEnabled: true, SeerrUrl: SEERR_URL, SeerrApiKey: 'stub-key' },
  });
  // The hero gives Seerr a moment per build and takes what's known by then; asked here first, the answer is there.
  if (youTubeTrailers) await api(`/Lumen/Items/${items[SHOW]}/YouTubeTrailer`, { token: admin.token });
}

test.beforeAll(async () => {
  const { admin } = loadState();
  const client = await api<{ YouTubeEmbedBase?: string }>('/Lumen/ClientConfig', { token: admin.token });
  expect(client.YouTubeEmbedBase, 'start the Jellyfin server with LUMEN_YOUTUBE_EMBED_BASE pointing at the stub').toBe(STUB_SEERR);
  saved = await api<Config>('/Lumen/Admin/Config', { token: admin.token });
  await resetStub();
  await setShowTmdbId('1399');
  await configure(true);
});
test.afterAll(async () => {
  const { admin } = loadState();
  await setShowTmdbId(null);
  await api('/Lumen/Admin/Config', { method: 'POST', token: admin.token, body: saved });
});

interface Slide {
  Item: { Name: string };
  TrailerItemId: string | null;
  TrailerYouTubeId?: string | null;
}

/**
 * Opens home with `first` as the first slide (as the server sent it, unless `change` edits it), previews starting at
 * once, and the slide staying while its trailer plays unless `config` says otherwise.
 */
async function openHome(page: Page, first: string, change: (slide: Slide) => void = () => {}, config: Config = {}): Promise<void> {
  await page.route(/\/Lumen\/ClientConfig/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), HeroIntervalSeconds: 3, TrailerDelaySeconds: 0, HeroWaitForTrailer: true, ...config },
    });
  });
  await page.route(/\/Lumen\/Home/, async (route) => {
    const response = await route.fetch();
    const home = (await response.json()) as { Hero: Slide[] };
    const slide = home.Hero.find((h) => h.Item.Name === first)!;
    change(slide);
    await route.fulfill({ response, json: { ...home, Hero: [slide, ...home.Hero.filter((h) => h !== slide)] } });
  });
  await login(page, ADMIN);
  await expect(current(page).locator('h2')).toBeVisible();
}
const current = (page: Page) => page.locator('#lmn-root .lmn-hero__slide.is-current');
const title = (page: Page) => current(page).locator('h2').evaluate((h) => h.textContent || h.querySelector('img')?.alt);
/** The stub player's page, in the frame: its <body> says what state it's in (1 playing, 2 paused) and where. */
const playerIn = (page: Page, frame: string) => page.frameLocator(frame).locator('body');
const HERO_FRAME = '#lmn-root .lmn-hero__slide.is-current iframe';
const time = async (page: Page, frame: string) => Number(await playerIn(page, frame).getAttribute('data-time'));

test('the server names the YouTube trailer of a title without a local one, and only of such a title', async () => {
  const { admin } = loadState();
  const home = await api<{ Hero: Slide[] }>('/Lumen/Home', { token: admin.token });

  // From the stub Seerr's videos for TMDB 1399: the id alone, never an address.
  const show = home.Hero.find((h) => h.Item.Name === SHOW)!;
  expect(show.TrailerYouTubeId).toBe(VIDEO);
  expect(show.TrailerItemId ?? null).toBeNull();
  // A local trailer always wins: those slides have no YouTube id at all.
  const withLocal = home.Hero.filter((h) => h.TrailerItemId);
  expect(withLocal.length).toBeGreaterThan(0);
  for (const slide of withLocal) expect(slide.TrailerYouTubeId ?? null).toBeNull();
});

test('a hero slide plays its trailer from YouTube: the backdrop first, the picture once it plays, and Pause', { tag: '@smoke' }, async ({ page }) => {
  await openHome(page, SHOW);
  const frame = current(page).locator('iframe');
  const player = playerIn(page, HERO_FRAME);

  // The backdrop, with the player loading unseen over it: muted, inline, and nothing in it within reach.
  await expect(frame).toHaveAttribute('src', new RegExp(`^${STUB_SEERR}/embed/${VIDEO}\\?autoplay=1&mute=1&controls=0&playsinline=1`));
  await expect(current(page).locator('.lmn-hero__backdrop')).toBeVisible();
  await expect(frame).not.toHaveClass(/\bis-shown\b/);
  await expect(frame).toHaveCSS('opacity', '0');
  await expect(frame).toHaveCSS('pointer-events', 'none');
  expect(await page.locator('#lmn-root iframe').count()).toBe(1); // the current slide's only

  // Playing isn't shown yet: YouTube's player shows its own title and buttons for its first seconds, behind the backdrop.
  await expect(player).toHaveAttribute('data-state', '1');
  await expect(frame).not.toHaveClass(/\bis-shown\b/);
  await expect(frame).toHaveClass(/\bis-shown\b/, { timeout: 15_000 });
  expect(await time(page, HERO_FRAME)).toBeGreaterThan(4);
  await expect(frame).toHaveCSS('opacity', '1');
  // It covers the slide like a backdrop does, its edges (where YouTube's title and logo sit) outside it.
  const [box, slide] = [(await frame.boundingBox())!, (await current(page).boundingBox())!];
  expect(box.y).toBeLessThanOrEqual(slide.y - 59);
  expect(box.y + box.height).toBeGreaterThanOrEqual(slide.y + slide.height + 59);
  expect(box.x).toBeLessThanOrEqual(slide.x);
  expect(box.x + box.width).toBeGreaterThanOrEqual(slide.x + slide.width);
  // The slide waits for it (HeroWaitForTrailer), well past its 3 s.
  expect(await title(page)).toBe(SHOW);

  // Pause stops the player where it is, and the backdrop is back; Play carries on from there.
  const hero = page.locator('#lmn-root .lmn-hero');
  await hero.getByRole('button', { name: 'Pause slideshow' }).click();
  await expect(player).toHaveAttribute('data-state', '2');
  await expect(frame).not.toHaveClass(/\bis-shown\b/);
  const pausedAt = await time(page, HERO_FRAME);
  await hero.getByRole('button', { name: 'Play slideshow' }).click();
  await expect(player).toHaveAttribute('data-state', '1');
  await expect(frame).toHaveClass(/\bis-shown\b/, { timeout: 15_000 });
  // Back by the seconds it plays unseen before it shows again: it shows about where it was paused, not past it.
  expect(await time(page, HERO_FRAME)).toBeGreaterThan(pausedAt - 1.5);
  expect(await time(page, HERO_FRAME)).toBeLessThan(pausedAt + 3);
  expect(await title(page)).toBe(SHOW);
});

test('a swipe takes the YouTube player off the slide, and the buttons over it still work', async ({ page }) => {
  await openHome(page, SHOW);
  const frame = current(page).locator('iframe');
  await expect(frame).toHaveClass(/\bis-shown\b/, { timeout: 15_000 });

  // A drag that springs back: the frame goes at once (nothing plays on under a finger), and comes back after it.
  const box = (await page.locator('#lmn-root .lmn-hero').boundingBox())!;
  const y = box.y + box.height / 3;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(box.x + box.width / 2 + i * 5, y);
  await expect(page.locator('#lmn-root iframe')).toHaveCount(0);
  await page.mouse.up();
  await expect(frame).toHaveCount(1);

  // A real swipe leaves the slide, and its player with it.
  await page.mouse.move(box.x + box.width * 0.7, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width * 0.7 - i * 40, y);
  await page.mouse.up();
  await expect.poll(() => title(page)).not.toBe(SHOW);
  await expect(page.locator(`#lmn-root iframe[src*="${VIDEO}"]`)).toHaveCount(0);

  // More info, under which the frame lay, takes its click.
  await current(page).getByRole('button', { name: 'More info' }).click();
  await expect(page).toHaveURL(/#\/details\?id=/);
});

test('with the setting off, no YouTube player loads, though the title has a trailer there', async ({ page }) => {
  await configure(false);
  try {
    const { admin } = loadState();
    const home = await api<{ Hero: Slide[] }>('/Lumen/Home', { token: admin.token });
    for (const slide of home.Hero) expect(slide.TrailerYouTubeId ?? null).toBeNull();
    const asked: string[] = [];
    page.on('request', (request) => {
      if (request.url().startsWith(`${STUB_SEERR}/embed/`)) asked.push(request.url());
    });

    await openHome(page, SHOW);
    // Long enough for a preview to have started (they start at once here): nothing does.
    await page.waitForTimeout(2500);
    await expect(page.locator('#lmn-root iframe')).toHaveCount(0);
    expect(asked).toEqual([]);
    await expect(current(page).locator('.lmn-hero__backdrop')).toBeVisible();
  } finally {
    await configure(true);
  }
});

test('a video that cannot be embedded leaves the backdrop, without a message, and the slideshow moves on', async ({ page }) => {
  const asked = page.waitForRequest((request) => request.url().startsWith(`${STUB_SEERR}/embed/stubErr0150`));
  await openHome(page, SHOW, (slide) => (slide.TrailerYouTubeId = 'stubErr0150'));
  await asked;

  // The player answers with error 150: its frame goes, the backdrop stays, and nothing in the hero says so.
  await expect(page.locator('#lmn-root iframe')).toHaveCount(0);
  await expect(current(page).locator('.lmn-hero__backdrop')).toBeVisible();
  await expect(page.locator('#lmn-root .lmn-hero [role="alert"]')).toHaveCount(0);
  expect(await page.locator('#lmn-root .lmn-hero').innerText()).not.toMatch(/error|unavailable|youtube/i);
  // Nothing held the slide: the next title follows at the 3 s interval.
  await expect.poll(() => title(page), { timeout: 10_000 }).not.toBe(SHOW);
});

test('a YouTube trailer that ends fades back to the backdrop, and the next title follows', async ({ page }) => {
  // A 10 s video: shown from about 4.5 s in, fading out a couple of seconds before its end.
  await openHome(page, SHOW, (slide) => (slide.TrailerYouTubeId = 'stubShort10'));
  const frame = current(page).locator('iframe');
  await expect(frame).toHaveClass(/\bis-shown\b/, { timeout: 15_000 });
  expect(await title(page)).toBe(SHOW);
  await expect(page.locator('#lmn-root .lmn-hero__fill')).toHaveClass(/\bis-trailer\b/);

  await expect(frame).not.toHaveClass(/\bis-shown\b/, { timeout: 10_000 });
  await expect(page.locator('#lmn-root iframe')).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(() => title(page), { timeout: 10_000 }).not.toBe(SHOW);
});

test('a title with a local trailer plays that one, even if a YouTube id came with it', async ({ page, browserName }) => {
  // The fixture trailer is WebM, which Playwright's WebKit on Linux may not play.
  test.skip(browserName === 'webkit', 'WebM playback');
  await openHome(page, 'Lumen Alpha', (slide) => (slide.TrailerYouTubeId = VIDEO));

  await expect(current(page).locator('video.is-shown')).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator('#lmn-root iframe')).toHaveCount(0);
});

test('the details page plays the trailer from YouTube behind its header, with Pause and Mute', { tag: '@smoke' }, async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${items[SHOW]}`);

  const header = page.locator('#lmn-root .lmn-details__header');
  const frame = header.locator('.lmn-details__trailer iframe');
  const FRAME = '#lmn-root .lmn-details__trailer iframe';
  // The backdrop first; no trailer controls until there's a trailer to control.
  await expect(header.locator('.lmn-details__backdrop')).toBeVisible();
  await expect(header.getByRole('button', { name: 'Pause trailer' })).toHaveCount(0);
  await expect(frame).toHaveAttribute('src', new RegExp(`^${STUB_SEERR}/embed/${VIDEO}\\?`));
  await expect(frame).toHaveCSS('pointer-events', 'none');

  await expect(frame).toHaveClass(/\bis-shown\b/, { timeout: 15_000 });
  await expect(playerIn(page, FRAME)).toHaveAttribute('data-muted', 'true');
  await header.getByRole('button', { name: 'Unmute trailer' }).click();
  await expect(playerIn(page, FRAME)).toHaveAttribute('data-muted', 'false');
  await expect(frame).toHaveClass(/\bis-shown\b/); // unmuting doesn't take it off

  await header.getByRole('button', { name: 'Pause trailer' }).click();
  await expect(playerIn(page, FRAME)).toHaveAttribute('data-state', '2');
  await expect(frame).not.toHaveClass(/\bis-shown\b/);
  await header.getByRole('button', { name: 'Play trailer' }).click();
  await expect(playerIn(page, FRAME)).toHaveAttribute('data-state', '1');
  await expect(frame).toHaveClass(/\bis-shown\b/, { timeout: 15_000 });
  // It's the preview only: the Trailer button plays a local trailer in the player, and this title has none.
  await expect(header.getByRole('button', { name: 'Trailer', exact: true })).toHaveCount(0);
});

test('TV layout: no YouTube player, in the hero or behind details, only the backdrop', async ({ page }) => {
  const { items } = loadState();
  await page.addInitScript(() => localStorage.setItem('layout', 'tv'));
  const asked: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith(`${STUB_SEERR}/embed/`)) asked.push(request.url());
  });
  await openHome(page, SHOW);
  await expect(current(page).locator('.lmn-button--primary')).toBeFocused();
  // Long enough for a preview to have started (they start at once here): YouTube's player is left off a TV.
  await page.waitForTimeout(2500);
  await expect(page.locator('#lmn-root iframe')).toHaveCount(0);
  await expect(current(page).locator('.lmn-hero__backdrop')).toBeVisible();

  await page.goto(`/web/#/details?id=${items[SHOW]}`);
  await expect(page.locator('#lmn-root .lmn-details__backdrop')).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(page.locator('#lmn-root iframe')).toHaveCount(0);
  expect(asked).toEqual([]);
});
