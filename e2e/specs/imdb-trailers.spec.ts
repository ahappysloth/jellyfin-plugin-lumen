import { expect, test, type Locator, type Page } from '@playwright/test';
import { ADMIN, api, loadState, SEERR_URL, STUB_SEERR } from '../support/api';
import { login } from '../support/login';
import { resetStub } from '../support/trakt';

// "Use online trailers when there's no local one (IMDb, then YouTube)": a title without a local trailer previews its
// trailer from IMDb, an MP4 the browser plays straight from IMDb's video CDN in the same <video> as a local trailer, else
// from YouTube. CI can't reach IMDb, so the server runs with LUMEN_IMDB_API_BASE pointing its lookups at the stub
// (support/stub-seerr.mjs, /imdb/graphql), and LUMEN_IMDB_VIDEO_BASE naming the stub's videos' address (the browser's)
// as the only one it passes on, in place of imdb-video.media-imdb.com.
//
// Lumen Show (the one fixture title without a local trailer) gets IMDb id tt9000010, which the stub knows with a 126 s
// trailer, and TMDB id 1399, which the stub Seerr knows with a YouTube trailer: IMDb's must win. tt9000020 has only
// clips on IMDb, so YouTube's plays. The catalog's The Matrix (movie 603) has IMDb id tt0133093 in Seerr; The Matrix
// Reloaded (604) has none.
//
// Each comes in 720p and 1080p, and the browser plays the one its box needs: 720p in a desktop browser's default
// 1280x720 window, 1080p on an iPhone (the stub's 1080p stand-ins are 1080 lines tall, its others 360).
const SHOW = 'Lumen Show';
const IMDB = 'tt9000010';
const fileOf = (id: string, quality: string) =>
  new RegExp(`^${STUB_SEERR}/imdb/video/${id}_${quality}\\.mp4\\?Expires=\\d+&Signature=`);
const SHOW_VIDEO = fileOf(IMDB, '720p');
/** The quality this project's browser plays: an iPhone's box needs 1080p, a 1280x720 desktop window 720p. */
const quality = () => (test.info().project.name === 'webkit-iphone' ? '1080p' : '720p');
type Config = Record<string, unknown>;
let saved: Config;

async function setIds(name: string, ids: Record<string, string>): Promise<void> {
  const { admin, items } = loadState();
  // What GET gives, as jellyfin-web's metadata editor sends it back, less the trickplay info the server can't read.
  const { Trickplay: _, ...item } = await api<Record<string, unknown>>(`/Items/${items[name]}`, {
    token: admin.token,
    query: { userId: admin.userId },
  });
  await api(`/Items/${items[name]}`, { method: 'POST', token: admin.token, body: { ...item, ProviderIds: ids } });
}

async function configure(online: boolean): Promise<void> {
  const { admin, items } = loadState();
  await api('/Lumen/Admin/Config', {
    method: 'POST',
    token: admin.token,
    // Ten slides: every fixture title is one, Lumen Show among them.
    body: { ...saved, YouTubeTrailers: online, HeroCount: 10, RequestsEnabled: true, SeerrUrl: SEERR_URL, SeerrApiKey: 'stub-key' },
  });
  // The hero gives the lookups a moment per build and takes what's known by then; asked here first, the answer is there.
  if (online) await api(`/Lumen/Items/${items[SHOW]}/Trailer`, { token: admin.token });
}

interface Slide {
  Item: { Name: string };
  TrailerItemId: string | null;
  TrailerYouTubeId?: string | null;
  TrailerImdbUrl?: string | null;
  TrailerImdbUrlHd?: string | null;
}
const hero = async (): Promise<Slide[]> => (await api<{ Hero: Slide[] }>('/Lumen/Home', { token: loadState().admin.token })).Hero;
/** GET …/Trailer, its absent fields (Jellyfin's JSON leaves out nulls) as nulls. */
const trailerOf = async (id: string): Promise<[string | null, string | null]> => {
  const trailer = await api<{ ImdbUrl?: string | null; YouTubeId?: string | null }>(`/Lumen/Items/${id}/Trailer`, { token: loadState().admin.token });
  return [trailer.ImdbUrl ?? null, trailer.YouTubeId ?? null];
};
const stubImdb = async (): Promise<{ lookups: string[]; videos: { name: string; range: string | null }[] }> =>
  (await fetch(`${STUB_SEERR}/__stub/imdb`)).json() as Promise<{ lookups: string[]; videos: { name: string; range: string | null }[] }>;

test.beforeAll(async () => {
  const { admin } = loadState();
  saved = await api<Config>('/Lumen/Admin/Config', { token: admin.token });
  await resetStub();
  await setIds(SHOW, { Imdb: IMDB, Tmdb: '1399' });
  await configure(true);
});
test.afterAll(async () => {
  const { admin } = loadState();
  await setIds(SHOW, {});
  await setIds('Lumen Alpha', {});
  await api('/Lumen/Admin/Config', { method: 'POST', token: admin.token, body: saved });
});

/** Opens home with `first` as the first slide, previews starting at once, and the slide waiting for its trailer. */
async function openHome(page: Page, first: string, config: Config = {}): Promise<void> {
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
    await route.fulfill({ response, json: { ...home, Hero: [slide, ...home.Hero.filter((h) => h !== slide)] } });
  });
  await login(page, ADMIN);
  await expect(current(page).locator('h2')).toBeVisible();
}
const current = (page: Page) => page.locator('#lmn-root .lmn-hero__slide.is-current');
const title = (page: Page) => current(page).locator('h2').evaluate((h) => h.textContent || h.querySelector('img')?.alt);
const playing = (video: Locator) => video.evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0.25);
const timeOf = (video: Locator) => video.evaluate((v: HTMLVideoElement) => v.currentTime);
/**
 * Scrolls the page (whatever element scrolls it) by `dy` pixels, or to the top: mobile WebKit has no mouse wheel to do
 * it with.
 */
const scrollPage = (page: Page, dy: number | 'top') =>
  page.locator('#lmn-root .lmn-details__header').evaluate((header, by) => {
    let scroller: Element | null = header.parentElement;
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY)))
      scroller = scroller.parentElement;
    const target = scroller ?? document.scrollingElement!;
    if (by === 'top') target.scrollTop = 0;
    else target.scrollTop += by;
  }, dy);
/** Milliseconds from now until `video` shows (TrailerPreview's is-shown), timed in the page. */
const msUntilShown = (video: Locator) =>
  video.evaluate(
    (v: HTMLVideoElement) =>
      new Promise<number>((resolve) => {
        const from = performance.now();
        const check = () => (v.classList.contains('is-shown') ? resolve(performance.now() - from) : requestAnimationFrame(check));
        check();
      }),
  );

test('the server names the IMDb trailer of a title without a local one, ahead of its YouTube one, and only an MP4 there', async () => {
  const slides = await hero();
  const show = slides.find((h) => h.Item.Name === SHOW)!;
  // The 126 s trailer's 720p, and its 1080p besides, not the 30 s teaser's nor the clip's, at the stub's address in
  // place of IMDb's CDN.
  expect(show.TrailerImdbUrl).toMatch(SHOW_VIDEO);
  expect(show.TrailerImdbUrlHd).toMatch(fileOf(IMDB, '1080p'));
  expect(show.TrailerYouTubeId ?? null).toBeNull();
  expect(show.TrailerItemId ?? null).toBeNull();
  // A local trailer always wins: those slides have nothing online at all.
  const withLocal = slides.filter((h) => h.TrailerItemId);
  expect(withLocal.length).toBeGreaterThan(0);
  for (const slide of withLocal) expect([slide.TrailerImdbUrl ?? null, slide.TrailerImdbUrlHd ?? null, slide.TrailerYouTubeId ?? null]).toEqual([null, null, null]);
  // A title page gets both files, and YouTube's id with them: its fallback should IMDb's file not play in the browser.
  const onPage = await api<Record<string, string | null>>(`/Lumen/Items/${loadState().items[SHOW]}/Trailer`, { token: loadState().admin.token });
  expect(onPage.ImdbUrl).toMatch(SHOW_VIDEO);
  expect(onPage.ImdbUrlHd).toMatch(fileOf(IMDB, '1080p'));
  expect(onPage.YouTubeId).toBe('dQw4w9WgXcQ');
  // Asked once for everyone, by the id from the item's metadata (or not at all: the server keeps IMDb's answer across
  // runs of this spec, and the stub's record starts again with each).
  expect((await stubImdb()).lookups.filter((id) => id === IMDB).length).toBeLessThanOrEqual(1);
});

test('a hero slide plays its IMDb trailer within a couple of seconds: the backdrop, then the picture once it plays, and Pause', { tag: '@smoke' }, async ({ page }) => {
  await openHome(page, SHOW);
  const video = current(page).locator('video');

  // A plain <video> straight from the CDN (no YouTube player), muted and inline, that loads as it's about to be due.
  await expect(video).toHaveAttribute('src', fileOf(IMDB, quality()));
  await expect(video).toHaveAttribute('preload', 'auto');
  expect(await video.evaluate((v: HTMLVideoElement) => v.muted && v.hasAttribute('playsinline'))).toBe(true);
  expect(await page.locator('#lmn-root iframe').count()).toBe(0);
  // Shown as soon as it's under way, with no wait for anything else: within 2 s of the slide settling.
  await expect(video).toHaveClass(/\bis-shown\b/, { timeout: 2_000 });
  await expect.poll(() => playing(video)).toBe(true);
  await expect(video).toHaveCSS('opacity', '1');
  // The slide waits for it (HeroWaitForTrailer), past its 3 s.
  await page.waitForTimeout(3500);
  expect(await title(page)).toBe(SHOW);
  // The file is fetched from IMDb's CDN once it's due. How much at a time is the browser's own business: Chromium and
  // Firefox ask for ranges, Linux WebKit's media stack (GStreamer) may start without one.
  const fetched = (await stubImdb()).videos.filter((v) => v.name === `${IMDB}_${quality()}`);
  expect(fetched.length).toBeGreaterThan(0);

  // Pause stops the video where it is; Play carries on from there.
  const heroRegion = page.locator('#lmn-root .lmn-hero');
  await heroRegion.getByRole('button', { name: 'Pause slideshow' }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  const pausedAt = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  await heroRegion.getByRole('button', { name: 'Play slideshow' }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(pausedAt + 0.5);
  expect(await title(page)).toBe(SHOW);
});

test('a title with a local trailer plays that one, though it has an IMDb id', async ({ page, browserName }) => {
  // The fixture trailer is WebM, which Playwright's WebKit on Linux may not play.
  test.skip(browserName === 'webkit', 'WebM playback');
  await setIds('Lumen Alpha', { Imdb: 'tt9000001' });
  try {
    const alpha = (await hero()).find((h) => h.Item.Name === 'Lumen Alpha')!;
    expect(alpha.TrailerItemId).toBeTruthy();
    expect(alpha.TrailerImdbUrl ?? null).toBeNull();

    await openHome(page, 'Lumen Alpha');
    await expect(current(page).locator('video.is-shown')).toHaveCount(1, { timeout: 15_000 });
    await expect(current(page).locator('video')).toHaveAttribute('src', /\/Videos\/[0-9a-f]+\/stream/);
    // Never asked: the local trailer wins before anything goes online.
    expect((await stubImdb()).lookups).not.toContain('tt9000001');
  } finally {
    await setIds('Lumen Alpha', {});
  }
});

test("a title IMDb has no trailer for plays YouTube's instead", async ({ page }) => {
  const { items } = loadState();
  await setIds(SHOW, { Imdb: 'tt9000020', Tmdb: '1399' });
  // Saving the settings again drops the server's cached home (a library change only does after 30 s).
  await configure(true);
  try {
    // Polled: Jellyfin may still be settling an earlier change of the item's ids.
    await expect.poll(() => trailerOf(items[SHOW]!)).toEqual([null, 'dQw4w9WgXcQ']);
    const show = (await hero()).find((h) => h.Item.Name === SHOW)!;
    expect([show.TrailerImdbUrl ?? null, show.TrailerYouTubeId]).toEqual([null, 'dQw4w9WgXcQ']);

    await openHome(page, SHOW);
    await expect(current(page).locator('iframe')).toHaveAttribute('src', new RegExp(`^${STUB_SEERR}/embed/dQw4w9WgXcQ\\?`));
    await expect(current(page).locator('video')).toHaveCount(0);
  } finally {
    await setIds(SHOW, { Imdb: IMDB, Tmdb: '1399' });
    await configure(true);
  }
});

test('the details page plays the IMDb trailer behind its header, with Pause and Mute', async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${items[SHOW]}`);

  const header = page.locator('#lmn-root .lmn-details__header');
  const video = header.locator('.lmn-details__trailer video');
  await expect(header.locator('.lmn-details__backdrop')).toBeVisible();
  await expect(video).toHaveAttribute('src', fileOf(IMDB, quality()));
  await expect(video).toHaveClass(/\bis-shown\b/, { timeout: 5_000 });
  await expect(page.locator('#lmn-root iframe')).toHaveCount(0);

  await header.getByRole('button', { name: 'Unmute trailer' }).click();
  expect(await video.evaluate((v: HTMLVideoElement) => v.muted)).toBe(false);
  await header.getByRole('button', { name: 'Mute trailer' }).click();
  expect(await video.evaluate((v: HTMLVideoElement) => v.muted)).toBe(true);
  await header.getByRole('button', { name: 'Pause trailer' }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await header.getByRole('button', { name: 'Play trailer' }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  // It's the preview only: the Trailer button plays a local trailer in the player, and this title has none.
  await expect(header.getByRole('button', { name: 'Trailer', exact: true })).toHaveCount(0);
});

test('a catalog title page plays the IMDb trailer behind its header, with Pause and Mute', { tag: '@smoke' }, async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/web/#/home?title=movie-603');
  await expect(page.getByRole('heading', { name: 'The Matrix', level: 1 })).toBeVisible();

  const header = page.locator('#lmn-root .lmn-details__header');
  const video = header.locator('.lmn-details__trailer video');
  // By the IMDb id Seerr has for the title: the title's request features are untouched.
  await expect(video).toHaveAttribute('src', fileOf('tt0133093', quality()));
  await expect(video).toHaveClass(/\bis-shown\b/, { timeout: 5_000 });
  await expect.poll(() => playing(video)).toBe(true);
  await expect(header.getByRole('button', { name: 'Request', exact: true })).toBeVisible();

  await header.getByRole('button', { name: 'Unmute trailer' }).click();
  expect(await video.evaluate((v: HTMLVideoElement) => v.muted)).toBe(false);
  await header.getByRole('button', { name: 'Pause trailer' }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  const pausedAt = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  await header.getByRole('button', { name: 'Play trailer' }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(pausedAt + 0.5);
  // The link to the trailer on YouTube, with sound, stays.
  await expect(header.getByRole('link', { name: 'Trailer' })).toHaveAttribute('href', /youtube\.com\/watch\?v=dQw4w9WgXcQ/);
});

test('a title page shows its trailer about a second after it opens, and its hero slide as its delay ends', async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/web/#/home?title=movie-603');
  await expect(page.getByRole('heading', { name: 'The Matrix', level: 1 })).toBeVisible();
  // The page's delay is 1 s, from as it opens; the lookup and the download happen during it. Measured from the heading
  // showing, so a little under that may already have run; on a phone the target is about 1.3 s.
  const video = page.locator('#lmn-root .lmn-details__trailer video');
  await expect(video).toHaveCount(1);
  const shownAfter = await msUntilShown(video);
  test.info().annotations.push({ type: 'timing', description: `title page: shown ${Math.round(shownAfter)} ms after the heading` });
  expect(shownAfter).toBeLessThan(1600);

  // The hero, with a 2 s delay: the picture shows as it ends, not a fetch and a decode later.
  await openHome(page, SHOW, { TrailerDelaySeconds: 2 });
  const slide = current(page).locator('video');
  await expect(slide).toHaveCount(1);
  const heroAfter = await msUntilShown(slide);
  test.info().annotations.push({ type: 'timing', description: `hero: shown ${Math.round(heroAfter)} ms after the slide's title (delay 2000 ms)` });
  expect(heroAfter).toBeGreaterThan(1000);
  expect(heroAfter).toBeLessThan(2600);
});

test("a title page's trailer scrolled out of view pauses, and carries on from there when back: no new download", async ({ page }) => {
  // A short window, so the header can leave it.
  await page.setViewportSize({ width: 1280, height: 560 });
  const lookups: string[] = [];
  page.on('request', (r) => {
    if (/\/Lumen\/Requests\/Title\/movie\/603\/Trailer/.test(r.url())) lookups.push(r.url());
  });
  await login(page, ADMIN);
  await page.goto('/web/#/home?title=movie-603');
  const header = page.locator('#lmn-root .lmn-details__header');
  const video = header.locator('.lmn-details__trailer video');
  await expect(video).toHaveClass(/\bis-shown\b/, { timeout: 5_000 });
  await expect.poll(() => timeOf(video)).toBeGreaterThan(2);
  // Marked, to tell it from a new one.
  await video.evaluate((v) => v.setAttribute('data-test-mark', 'first'));
  const before = (await stubImdb()).videos.length;

  await scrollPage(page, 4000);
  await expect.poll(() => header.evaluate((h) => h.getBoundingClientRect().bottom)).toBeLessThan(200);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  const pausedAt = await timeOf(video);
  // Paused while away: it doesn't play on unseen.
  await page.waitForTimeout(1500);
  expect(await timeOf(video)).toBeCloseTo(pausedAt, 1);

  await scrollPage(page, 'top');
  await expect.poll(() => header.evaluate((h) => h.getBoundingClientRect().top)).toBeGreaterThanOrEqual(-1);
  // At once, from where it was: the same video, no delay, not from the start.
  await expect.poll(() => playing(video), { timeout: 1_000 }).toBe(true);
  expect(await timeOf(video)).toBeGreaterThanOrEqual(pausedAt);
  await expect(video).toHaveAttribute('data-test-mark', 'first');
  await expect(video).toHaveClass(/\bis-shown\b/);
  // Nothing fetched again: neither the lookup nor the file.
  expect(lookups).toHaveLength(1);
  expect((await stubImdb()).videos.length).toBe(before);
});

test.describe('on an iPhone-sized screen', () => {
  test.use({ viewport: { width: 390, height: 664 }, deviceScaleFactor: 3 });

  test("plays IMDb's 1080p file: the box needs more than 720p", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto('/web/#/home?title=movie-603');
    const video = page.locator('#lmn-root .lmn-details__trailer video');
    await expect(video).toHaveAttribute('src', fileOf('tt0133093', '1080p'));
    await expect(video).toHaveClass(/\bis-shown\b/, { timeout: 5_000 });
    // The 1080-line stand-in, decoded.
    expect(await video.evaluate((v: HTMLVideoElement) => v.videoHeight)).toBe(1080);
  });
});

test.describe('in a small window', () => {
  test.use({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 });

  test("plays IMDb's 720p file: it fills the box", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto('/web/#/home?title=movie-603');
    const video = page.locator('#lmn-root .lmn-details__trailer video');
    await expect(video).toHaveAttribute('src', fileOf('tt0133093', '720p'));
    await expect(video).toHaveClass(/\bis-shown\b/, { timeout: 5_000 });
    expect(await video.evaluate((v: HTMLVideoElement) => v.videoHeight)).toBe(360);
  });
});

test("a catalog title without an IMDb id plays its YouTube trailer behind the header", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/web/#/home?title=movie-604');
  await expect(page.getByRole('heading', { name: 'The Matrix Reloaded', level: 1 })).toBeVisible();
  await expect(page.locator('#lmn-root .lmn-details__trailer iframe')).toHaveAttribute('src', new RegExp(`^${STUB_SEERR}/embed/dQw4w9WgXcQ\\?`));
  await expect(page.locator('#lmn-root .lmn-details__trailer video')).toHaveCount(0);
});

test('TV layout: the IMDb trailer plays in the hero and on a catalog title page', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('layout', 'tv'));
  await openHome(page, SHOW);
  await expect(current(page).locator('.lmn-button--primary')).toBeFocused();
  await expect(current(page).locator('video')).toHaveClass(/\bis-shown\b/, { timeout: 5_000 });

  await page.goto('/web/#/home?title=movie-603');
  await expect(page.locator('#lmn-root .lmn-details__trailer video')).toHaveClass(/\bis-shown\b/, { timeout: 5_000 });
});

test('the Health tab says IMDb lookups work while online trailers are on', async () => {
  const { admin } = loadState();
  const report = await api<{ Checks: { Id: string; Status: string; Group: string }[] }>('/Lumen/Admin/Health', {
    token: admin.token,
    query: { refresh: 'true' },
  });
  expect(report.Checks.find((c) => c.Id === 'trailers.imdb')).toMatchObject({ Group: 'Trailers', Status: 'Ok' });
});

test('with the setting off, nothing is looked up or loaded from IMDb, though the titles have trailers there', async ({ page }) => {
  const { admin, items } = loadState();
  await configure(false);
  try {
    await resetStub();
    for (const slide of await hero()) expect([slide.TrailerImdbUrl ?? null, slide.TrailerYouTubeId ?? null]).toEqual([null, null]);
    await expect.poll(() => trailerOf(items[SHOW]!)).toEqual([null, null]);

    await openHome(page, SHOW);
    await page.goto('/web/#/home?title=movie-603');
    await expect(page.getByRole('heading', { name: 'The Matrix', level: 1 })).toBeVisible();
    // Long enough for a preview to have started (they start at once on the hero, after 1 s here): nothing does.
    await page.waitForTimeout(2500);
    await expect(page.locator('#lmn-root video, #lmn-root iframe')).toHaveCount(0);
    expect(await stubImdb()).toEqual({ lookups: [], videos: [] });

    const report = await api<{ Checks: { Id: string; Status: string }[] }>('/Lumen/Admin/Health', { token: admin.token, query: { refresh: 'true' } });
    expect(report.Checks.find((c) => c.Id === 'trailers.imdb')?.Status).toBe('NotApplicable');
  } finally {
    await configure(true);
  }
});
