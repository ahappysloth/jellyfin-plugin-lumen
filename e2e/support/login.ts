import type { BrowserContext, Page } from '@playwright/test';

type User = { name: string; password: string };
type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

/**
 * What jellyfin-web keeps of a sign-in: the server, user and access token, and the device id the token was issued to
 * (Jellyfin finds a page's session by its token's device: a token is good for that one device). Not its cached user,
 * so the page fetches the user afresh, nor settings like the layout, which tests set for themselves.
 */
const SIGN_IN_KEYS = new Set(['jellyfin_credentials', 'enableAutoLogin', '_deviceId2']);

/**
 * Each user's sign-in, saved the first time login() signs them in in this worker (the suite runs one, in its project's
 * browser). Signing in through jellyfin-web's form cold-loads it first; reusing the sign-in skips that in every test
 * after the first. Those tests are the same device to Jellyfin, so they share its session, one at a time.
 */
const signedIn = new Map<string, StorageState>();

/** The user each context was last signed in as, so signing out there forgets that user's saved sign-in. */
const contextUser = new WeakMap<BrowserContext, string>();

function signsInAs(context: BrowserContext, user: User): void {
  if (!contextUser.has(context)) {
    // Signing out ends the token server-side, for every test sharing it: the next login() signs in afresh.
    context.on('request', (request) => {
      if (/\/Sessions\/Logout\b/i.test(request.url())) signedIn.delete(contextUser.get(context)!);
    });
  }
  contextUser.set(context, user.name);
}

/**
 * Signs in through jellyfin-web's manual login form (users are hidden, so the form is shown directly): a new device,
 * and its own Jellyfin session. For a test that needs one, such as a second viewer, or one that joins a SyncPlay group
 * (the shared session would still be in it in the next test).
 */
export async function signIn(page: Page, user: User): Promise<void> {
  await page.goto('/web/#/login');
  await page.locator('#txtManualName').fill(user.name);
  await page.locator('#txtManualPassword').fill(user.password);
  await page.locator('.manualLoginForm button[type="submit"]').click();
  await page.waitForURL(/#\/home/);
  signsInAs(page.context(), user);
}

/**
 * Signs in and opens home. The first time for each user it signs in through the form and saves the sign-in; after that
 * it puts the saved sign-in in the page's browser storage, so jellyfin-web starts signed in, and goes on to home.
 */
export async function login(page: Page, user: User): Promise<void> {
  const saved = signedIn.get(user.name);
  if (!saved) {
    await signIn(page, user);
    const state = await page.context().storageState();
    signedIn.set(user.name, {
      cookies: state.cookies,
      origins: state.origins.map((origin) => ({
        ...origin,
        localStorage: origin.localStorage.filter(({ name }) => SIGN_IN_KEYS.has(name)),
      })),
    });
    return;
  }
  // Off jellyfin-web first: a hash change on its page wouldn't make it read the new credentials, and it mustn't write
  // its own over them as it goes.
  if (page.url() !== 'about:blank') await page.goto('about:blank');
  await page.context().setStorageState(saved);
  signsInAs(page.context(), user);
  // Into home the way the form goes: from the sign-in page, within the page. That leaves the page as a sign-in through
  // the form did, which the specs were written against. A cold load of home instead is still settling under Lumen's
  // loading veil as the test goes on (a menu it opens closes as the page moves under it).
  await page.goto('/web/#/login');
  await page.locator('.manualLoginForm').waitFor();
  await page.evaluate(() => (location.hash = '#/home'));
  await page.waitForURL(/#\/home/);
  await page.locator('#indexPage').waitFor({ state: 'attached' });
}
