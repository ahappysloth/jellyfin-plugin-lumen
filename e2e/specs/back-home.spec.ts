import { expect, test, type Page } from '@playwright/test';
import { ADMIN, loadState } from '../support/api';
import { login } from '../support/login';

// The pill at the top of the pages that have no nav (a title, an episode, a person, a catalog title): Back, and Home
// once the user is more than one such page deep (client/src/takeover/pageDepth.ts).

const pill = (page: Page) => page.locator('#lmn-root .lmn-pill');
const back = (page: Page) => pill(page).getByRole('button', { name: 'Back' });
const home = (page: Page) => pill(page).getByRole('link', { name: 'Home' });

/** From home to a movie by its card, as a user gets there. */
async function openFromHome(page: Page, name: string): Promise<void> {
  const { items } = loadState();
  await page.locator(`#lmn-root .lmn-row a.lmn-card[data-item-id="${items[name]}"]`).first().click();
  await expect(page.getByRole('img', { name })).toBeVisible();
}

/** A title's cast member, then one of the titles on their page. */
async function openActor(page: Page): Promise<void> {
  await page.getByRole('region', { name: 'Cast' }).getByRole('button', { name: /Ada Vance/ }).click();
  await expect(page.getByRole('heading', { name: 'Ada Vance', level: 1 })).toBeVisible();
}

test('Back alone one page in; Back and Home deeper; Back steps out again, and Home goes home', { tag: '@smoke' }, async ({
  page,
}) => {
  await login(page, ADMIN);

  // Home → a movie: one page in, Back is enough.
  await openFromHome(page, 'Lumen Alpha');
  await expect(back(page)).toBeVisible();
  await expect(home(page)).toHaveCount(0);

  // → an actor → one of their titles: Home joins Back, in the same pill.
  await openActor(page);
  await expect(home(page)).toBeVisible();
  const [backBox, homeBox, pillBox] = await Promise.all([back(page), home(page), pill(page)].map((l) => l.boundingBox()));
  expect(homeBox!.x).toBeGreaterThan(backBox!.x + backBox!.width - 1);
  expect(homeBox!.x + homeBox!.width).toBeLessThanOrEqual(pillBox!.x + pillBox!.width);
  await page.getByRole('list', { name: 'Known for' }).getByRole('link', { name: 'Lumen Show' }).click();
  await expect(page.locator('#lmn-root .lmn-details--series')).toBeVisible();
  await expect(home(page)).toBeVisible();

  // Back, a page at a time: Home stays while it's more than one page from where the user set out, then goes.
  await back(page).click();
  await expect(page.getByRole('heading', { name: 'Ada Vance', level: 1 })).toBeVisible();
  await expect(home(page)).toBeVisible();
  await back(page).click();
  await expect(page.locator('#lmn-root .lmn-details--movie')).toBeVisible();
  await expect(back(page)).toBeVisible();
  await expect(home(page)).toHaveCount(0);

  // Deeper again, and Home: Lumen's home, with nothing left of the pill.
  await openActor(page);
  await home(page).click();
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.locator('#lmn-root .lmn-home')).toBeVisible();
  await expect(pill(page)).toHaveCount(0);

  // Home was a step forward, not a jump back: the browser's Back returns to the page it was pressed on, as deep as it
  // was; and a title opened from home now is one page in again.
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Ada Vance', level: 1 })).toBeVisible();
  await expect(home(page)).toBeVisible();
  await page.goForward();
  await expect(page.locator('#lmn-root .lmn-home')).toBeVisible();
  await openFromHome(page, 'Lumen Alpha');
  await expect(back(page)).toBeVisible();
  await expect(home(page)).toHaveCount(0);
});

test('the depth survives a reload, a page opened from a link is one page in, and other pages start it over', async ({ page }) => {
  const { items, libraries } = loadState();
  await login(page, ADMIN);
  await openFromHome(page, 'Lumen Alpha');
  await openActor(page);
  await expect(home(page)).toBeVisible();

  // A reload: still two pages in, and Back still knows the page before was one.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Ada Vance', level: 1 })).toBeVisible();
  await expect(home(page)).toBeVisible();
  // jellyfin-web's router keeps its own state in the same history entries: Lumen's stamp sits beside it.
  expect(await page.evaluate(() => history.state)).toMatchObject({ lmnDepth: 2, idx: expect.any(Number) });
  await back(page).click();
  await expect(page.locator('#lmn-root .lmn-details--movie')).toBeVisible();
  await expect(home(page)).toHaveCount(0);

  // A library page in between starts the count over.
  await page.goForward();
  await expect(home(page)).toBeVisible();
  await page.evaluate((id) => (location.hash = `#/movies?topParentId=${id}`), libraries.movies);
  await expect(page.getByRole('heading', { name: 'Movies', level: 1 })).toBeVisible();
  await page.locator(`#lmn-root a.lmn-card[data-item-id="${items['Lumen Beta']}"]`).first().click();
  await expect(page.getByRole('heading', { name: 'Lumen Beta', level: 1 })).toBeVisible();
  await expect(back(page)).toBeVisible();
  await expect(home(page)).toHaveCount(0);

  // A details page opened cold (a bookmark, a shared link): one page in.
  const fresh = await page.context().newPage();
  await fresh.goto(`/web/#/details?id=${items['Lumen Show']}`);
  await expect(fresh.locator('#lmn-root .lmn-details--series')).toBeVisible();
  await expect(back(fresh)).toBeVisible();
  await expect(home(fresh)).toHaveCount(0);
  await fresh.close();
});

test('an episode’s ⓘ and a season’s ⋯ have no blur on the plain page; a phone’s ⓘ is glass', { tag: '@smoke' }, async ({
  page,
  isMobile,
}) => {
  const { items } = loadState();
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${items['Lumen Show']}`);

  const series = page.locator('#lmn-root .lmn-details--series');
  const info = series.getByRole('link', { name: /^Details for / }).first();
  const seasonMore = series.locator('.lmn-episodes-header').getByRole('button', { name: /^More actions for / });
  await expect(info).toBeVisible();
  await expect(seasonMore).toBeVisible();
  const blur = (el: Element) => {
    const style = getComputedStyle(el);
    return style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter');
  };
  // Every episode's ⓘ had a blur of its own, though only on a phone does it sit over a picture (the still's corner).
  if (isMobile) expect(await info.evaluate(blur)).toContain('blur(');
  else expect(await info.evaluate(blur)).not.toContain('blur(');
  expect(await seasonMore.evaluate(blur)).not.toContain('blur(');
});

test('the glass buttons turn into a white disc with a dark icon under the pointer and the keyboard’s focus', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'no pointer to hover with, and no Tab key');
  await login(page, ADMIN);
  await openFromHome(page, 'Lumen Alpha');
  await openActor(page);

  const look = (which: 'Back' | 'Home') =>
    (which === 'Back' ? back(page) : home(page)).evaluate((el) => {
      const style = getComputedStyle(el);
      return { fill: style.backgroundColor, icon: getComputedStyle(el.querySelector('svg')!).stroke };
    });
  const white = { fill: 'rgb(255, 255, 255)', icon: 'rgb(15, 15, 15)' };
  const clear = { fill: 'rgba(0, 0, 0, 0)', icon: 'rgb(255, 255, 255)' };
  // At rest the pill is the glass (a translucent fill over a blur, where the browser has one) and its buttons clear.
  await page.mouse.move(600, 400);
  expect(await look('Back')).toEqual(clear);
  const glass = await pill(page).evaluate((el) => {
    const style = getComputedStyle(el);
    return { fill: style.backgroundColor, blur: style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter') };
  });
  expect(glass.fill).toMatch(/^rgba\(20, 20, 20, 0\.\d+\)$/);
  expect(glass.blur).toContain('blur(');

  // Each button on its own: the pointer on Home leaves Back clear.
  await home(page).hover();
  await expect.poll(() => look('Home')).toEqual(white);
  expect(await look('Back')).toEqual(clear);
  await back(page).hover();
  await expect.poll(() => look('Back')).toEqual(white);
  await expect.poll(() => look('Home')).toEqual(clear);

  // The keyboard: the same disc, and a ring around it besides.
  await page.mouse.move(600, 400);
  await back(page).focus();
  await page.keyboard.press('Tab');
  await expect(home(page)).toBeFocused();
  await expect.poll(() => look('Home')).toEqual(white);
  expect(await home(page).evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/home$/);
});

test('TV layout: the D-pad reaches Back and Home, with Left and Right along the bar, and OK on Home goes home', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => localStorage.setItem('layout', 'tv'));
  const { items } = loadState();
  await login(page, ADMIN);
  await expect(page.locator('html')).toHaveClass(/\blayout-tv\b/);
  // Home → a movie → an actor, as the remote would (OK on a card, then on the cast member).
  await page.evaluate((id) => (location.hash = `#/details?id=${id}`), items['Lumen Alpha']);
  const play = page.locator('#lmn-root .lmn-details--movie').getByRole('button', { name: 'Play', exact: true });
  await expect(play).toBeFocused();

  // One page in: Up from Play is Back, alone in its pill.
  await page.keyboard.press('ArrowUp');
  await expect(back(page)).toBeFocused();
  await expect(home(page)).toHaveCount(0);
  // The remote's focus is the white disc too (TVs' browsers have no :focus-visible).
  await expect.poll(() => back(page).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');

  // Another title from here (two pages in), with a trailer playing behind its header: its Pause and Mute are at the
  // bar's other end. Right goes along the bar, Back, Home, Pause, Mute, and Left all the way back.
  await page.evaluate((id) => (location.hash = `#/details?id=${id}`), items['Lumen Zeta']);
  const zeta = page.locator('#lmn-root .lmn-details__header');
  const pause = zeta.getByRole('button', { name: 'Pause trailer' });
  await expect(pause).toBeVisible({ timeout: 15_000 });
  await back(page).focus();
  await page.keyboard.press('ArrowRight');
  await expect(home(page)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(pause).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(zeta.getByRole('button', { name: 'Unmute trailer' })).toBeFocused();
  for (const stop of [pause, home(page), back(page)]) {
    await page.keyboard.press('ArrowLeft');
    await expect(stop).toBeFocused();
  }
  await page.goBack();
  await expect(play).toBeVisible();
  await expect(home(page)).toHaveCount(0);

  const actor = page.getByRole('region', { name: 'Cast' }).getByRole('button', { name: /Ada Vance/ });
  await actor.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Ada Vance', level: 1 })).toBeVisible();
  // Two pages in. The person page's default focus is a title; Up from the first row reaches the pill.
  await expect(page.locator('#lmn-root .lmn-person-page :focus')).toHaveCount(1);
  await back(page).focus();
  await page.keyboard.press('ArrowRight');
  await expect(home(page)).toBeFocused();
  // Right again stays put (nothing more along the bar); Left is Back.
  await page.keyboard.press('ArrowRight');
  await expect(home(page)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(back(page)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(back(page)).toBeFocused();
  // Down goes back to the page, and Up returns to the pill.
  await page.keyboard.press('ArrowDown');
  await expect(pill(page).locator(':focus')).toHaveCount(0);
  await page.keyboard.press('ArrowUp');
  await expect(pill(page).locator(':focus')).toHaveCount(1);

  await home(page).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.locator('#lmn-root .lmn-hero')).toBeVisible();
});
