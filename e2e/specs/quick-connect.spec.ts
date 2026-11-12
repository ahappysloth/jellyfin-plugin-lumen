import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import jsQR from 'jsqr';
import { ADMIN, BASE_URL, KID, api, loadState } from '../support/api';
import { login } from '../support/login';

// Quick Connect: a signed-out device shows a code (and a QR code) on Lumen's screen over jellyfin-web's sign-in page,
// and a signed-in one approves it on Lumen's #/quickconnect page (client/src/views/quickconnect). Against the real
// server, Quick Connect on (Jellyfin's default); the tests that switch it off put it back.

/** Jellyfin's switch for Quick Connect (Dashboard → General). */
async function setQuickConnect(on: boolean): Promise<void> {
  const { admin } = loadState();
  const config = await api<Record<string, unknown>>('/System/Configuration', { token: admin.token });
  await api('/System/Configuration', { method: 'POST', token: admin.token, body: { ...config, QuickConnectAvailable: on } });
}

/** Lumen's "Public address for QR codes" (null: not set). */
async function setQrAddress(address: string | null): Promise<void> {
  const { admin } = loadState();
  const config = await api<Record<string, unknown>>('/Lumen/Admin/Config', { token: admin.token });
  await api('/Lumen/Admin/Config', { method: 'POST', token: admin.token, body: { ...config, QuickConnectAddress: address } });
}

/**
 * The other device's requests, each as a device of its own. Approving a request signs its device in, which replaces any
 * sign-in that device id had: api()'s is the one the suite's saved tokens were issued to.
 */
async function asOtherDevice<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(new URL(path, BASE_URL.replace(/\/?$/, '/')), {
    method: 'POST',
    headers: {
      Authorization: `MediaBrowser Client="Lumen E2E", Device="Quick Connect", DeviceId="lumen-e2e-qc-${crypto.randomUUID()}", Version="1.0.0"`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(response.status, path).toBe(200);
  return (await response.json()) as T;
}

/** A request as another device starts one (no sign-in needed). */
const initiate = (): Promise<{ Secret: string; Code: string }> => asOtherDevice('QuickConnect/Initiate');

/** Who a request's secret signs in as, once approved. */
const redeem = async (secret: string): Promise<string> =>
  (await asOtherDevice<{ User: { Name: string } }>('Users/AuthenticateWithQuickConnect', { Secret: secret })).User.Name;

const signInScreen = (page: Page): Locator => page.getByRole('dialog', { name: 'Sign in with Quick Connect' });
const shownCode = (page: Page): Locator => signInScreen(page).locator('.lmn-qc-signin__code [aria-hidden="true"]');

/** Opens the sign-in page signed out and taps "Use Quick Connect": Lumen's screen, with a code. Returns the code. */
async function openSignInScreen(page: Page): Promise<string> {
  await page.goto('/web/#/login');
  await page.locator('.btnQuick').click();
  await expect(shownCode(page)).toHaveText(/^\d{3} \d{3}$/);
  return (await shownCode(page).textContent())!.replace(' ', '');
}

/**
 * Reads the QR code the page draws, as a phone's camera would: a screenshot of it, decoded by jsQR (a decoder written
 * independently of Lumen's encoder). The screenshot is turned into pixels in the page, which has a PNG decoder.
 */
async function readQr(page: Page): Promise<string | undefined> {
  const png = (await signInScreen(page).getByRole('img', { name: 'QR code' }).screenshot()).toString('base64');
  const { width, height, data } = await page.evaluate(async (src) => {
    const image = new Image();
    image.src = `data:image/png;base64,${src}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return { width: canvas.width, height: canvas.height, data: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data) };
  }, png);
  return jsQR(Uint8ClampedArray.from(data), width, height)?.data;
}

/** A second device, signed in as `user`: its own browser context. */
async function signedInDevice(browser: Browser, baseURL: string | undefined, user: typeof ADMIN): Promise<Page> {
  const page = await (await browser.newContext({ baseURL })).newPage();
  await login(page, user);
  return page;
}

const approvePage = (page: Page): Locator => page.locator('#lmn-root .lmn-qc-approve');
const codeField = (page: Page): Locator => approvePage(page).getByLabel('Code', { exact: true });
const approveButton = (page: Page): Locator => approvePage(page).getByRole('button', { name: 'Approve' });

async function openApprovePage(page: Page, hash = '#/quickconnect'): Promise<void> {
  await page.evaluate((h) => (location.hash = h), hash);
  await expect(codeField(page)).toBeVisible();
}

test('one device shows a code and a QR code, another approves it, and the first is signed in', { tag: '@smoke' }, async ({
  page,
  browser,
  baseURL,
  isMobile,
}) => {
  const connects: string[] = [];
  page.on('request', (r) => /\/QuickConnect\/Connect\b/.test(r.url()) && connects.push(r.url()));
  const code = await openSignInScreen(page);
  await expect(signInScreen(page)).toContainText('open Lumen → Quick Connect and enter this code');
  await expect(signInScreen(page).getByRole('button', { name: 'Cancel' })).toBeFocused();
  // The secret that trades the approval for a sign-in stays in memory: never on the page.
  await expect(page.locator('body')).not.toContainText(/[0-9a-f]{64}/);
  if (isMobile) {
    // A phone shows the code alone: scanning one phone with another is the long way round.
    await expect(signInScreen(page).getByRole('img', { name: 'QR code' })).toBeHidden();
  } else {
    await expect(signInScreen(page)).toContainText('or scan the QR code');
    expect(await readQr(page)).toBe(`${BASE_URL.replace(/\/$/, '')}/web/#/quickconnect?code=${code}`);
  }

  const phone = await signedInDevice(browser, baseURL, KID);
  try {
    await openApprovePage(phone);
    await expect(approvePage(phone)).toContainText('Signs in as' + KID.name);
    await expect(approvePage(phone)).toContainText('Only approve a code shown on a screen in front of you.');
    await expect(approvePage(phone)).toContainText('How it works');
    // A non-administrator signs in only as themselves: no account picker.
    await expect(approvePage(phone).getByRole('button', { name: /Signs in as/ })).toHaveCount(0);
    await codeField(phone).fill(code);
    await approveButton(phone).click();
    await expect(approvePage(phone).getByRole('status')).toHaveText(new RegExp(`that device is signed in as ${KID.name}`));
  } finally {
    await phone.context().close();
  }

  await page.waitForURL(/#\/home/);
  await expect(page.locator('#lmn-root .lmn-row').first()).toBeVisible();
  await expect(signInScreen(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { ApiClient: { getCurrentUserId(): string } }).ApiClient.getCurrentUserId()))
    .toBe(loadState().kid.userId);
  // Signed in: no more asking.
  const asked = connects.length;
  await page.waitForTimeout(4000);
  expect(connects).toHaveLength(asked);
});

test("a QR code's link goes through sign-in to the approve page, filled in but not approved, and leaves the address bar", async ({
  page,
}) => {
  const authorizes: string[] = [];
  page.on('request', (r) => /\/QuickConnect\/Authorize\b/.test(r.url()) && authorizes.push(r.url()));
  const request = await initiate();
  const admin = loadState().admin.userId;
  // Signed out, with a userId in the link as jellyfin-web's own page reads it: Lumen ignores it.
  await page.goto(`/web/#/quickconnect?code=${request.Code}&userId=${admin}`);
  await page.waitForURL(/#\/login\?.*url=%2Fquickconnect%3Fcode%3D/);
  await page.locator('#txtManualName').fill(KID.name);
  await page.locator('#txtManualPassword').fill(KID.password);
  await page.locator('.manualLoginForm button[type="submit"]').click();

  await expect(codeField(page)).toHaveValue(request.Code);
  expect(new URL(page.url()).hash).toBe('#/quickconnect');
  await expect(approvePage(page)).toContainText('This code came from a link or QR code.');
  await expect(approvePage(page)).toContainText('Signs in as' + KID.name);
  await page.waitForTimeout(1500);
  expect(authorizes).toEqual([]);

  await approveButton(page).click();
  await expect(approvePage(page).getByRole('status')).toContainText('signed in as kid');
  expect(authorizes).toHaveLength(1);
  expect(new URL(authorizes[0]!).searchParams.get('userId')).toBe(loadState().kid.userId);
  expect(await redeem(request.Secret)).toBe(KID.name);
});

test("the approve page says what the server answered: a wrong code, a used one, and a sign-in that's run out", async ({
  page,
}) => {
  await login(page, KID);
  await openApprovePage(page);

  // The cells take what's typed or pasted, digits only.
  await codeField(page).fill('12a');
  await expect(codeField(page)).toHaveValue('12');
  await approveButton(page).click();
  await expect(approvePage(page).getByRole('alert')).toHaveText('Enter all six digits.');

  await codeField(page).fill('999 999');
  await expect(codeField(page)).toHaveValue('999999');
  await approveButton(page).click();
  await expect(approvePage(page).getByRole('alert')).toHaveText('That code isn’t valid or has expired.');
  await expect(codeField(page)).toHaveAttribute('aria-invalid', 'true');

  const request = await initiate();
  const { admin, kid } = loadState();
  await api('/QuickConnect/Authorize', { method: 'POST', token: admin.token, query: { code: request.Code, userId: kid.userId } });
  await codeField(page).fill(request.Code);
  await approveButton(page).click();
  await expect(approvePage(page).getByRole('alert')).toHaveText('That code has already been used.');

  // A 401 while Quick Connect is on: this page's own sign-in ran out.
  await page.route(/\/QuickConnect\/Authorize\b/, (route) => route.fulfill({ status: 401 }));
  await codeField(page).fill('123456');
  await approveButton(page).click();
  await expect(approvePage(page).getByRole('alert')).toHaveText('Your sign-in has expired. Sign in again.');
});

test('with Quick Connect turned off, the sign-in screen and the approve page say so, with a way to turn it on for admins', async ({
  page,
  browser,
  baseURL,
}) => {
  await openSignInScreen(page);
  const admin = await signedInDevice(browser, baseURL, ADMIN);
  try {
    await openApprovePage(admin);
    await setQuickConnect(false);
    // The open screen hears it on its next question (401).
    await expect(signInScreen(page).getByRole('status')).toHaveText('Quick Connect is turned off on this server.');
    await expect(shownCode(page)).toHaveCount(0);

    // Approving now gets a 401, and the page asks the server which one it is.
    await codeField(admin).fill('123456');
    await approveButton(admin).click();
    await expect(approvePage(admin).getByRole('alert')).toContainText('Quick Connect is turned off on this server.');
    await expect(approvePage(admin).getByRole('link', { name: 'Turn it on in Dashboard → General' })).toHaveAttribute(
      'href',
      '#/dashboard/settings',
    );
    // Opened while it's off: the page says so straight away, instead of the form.
    await admin.reload();
    await expect(approvePage(admin).getByRole('alert')).toContainText('Quick Connect is turned off on this server.');
    await expect(codeField(admin)).toHaveCount(0);
  } finally {
    await setQuickConnect(true);
    await admin.context().close();
  }
});

test('an administrator can sign the device in as another user, as on jellyfin-web’s page', async ({ page }) => {
  await login(page, ADMIN);
  const request = await initiate();
  await openApprovePage(page);
  const picker = approvePage(page).getByRole('button', { name: /Signs in as/ });
  await expect(picker).toContainText(ADMIN.name);
  await expect(approvePage(page)).toContainText('That device gets administrator access.');

  await picker.click();
  await page.getByRole('option', { name: KID.name, exact: true }).click();
  await expect(approvePage(page).locator('.lmn-qc-approve__account strong')).toHaveText(KID.name);
  await expect(approvePage(page)).not.toContainText('administrator access');

  await codeField(page).fill(request.Code);
  await approveButton(page).click();
  await expect(approvePage(page).getByRole('status')).toContainText(`signed in as ${KID.name}`);
  expect(await redeem(request.Secret)).toBe(KID.name);
});

test.describe('the sign-in screen', () => {
  test.skip(({ isMobile }) => isMobile, 'the QR code shows on bigger screens');

  test('gets a new code when the server says the old one has gone, twice, then stops and offers another', async ({
    page,
  }) => {
    const initiates: string[] = [];
    page.on('request', (r) => /\/QuickConnect\/Initiate\b/.test(r.url()) && initiates.push(r.url()));
    // Every code "expires" at its first question.
    await page.route(/\/QuickConnect\/Connect\b/, (route) => route.fulfill({ status: 404 }));
    await openSignInScreen(page);
    await expect(signInScreen(page).getByRole('status')).toHaveText('That code has expired.', { timeout: 20_000 });
    expect(initiates).toHaveLength(3);
    const again = signInScreen(page).getByRole('button', { name: 'Get a new code' });
    await expect(again).toBeFocused();
    await page.waitForTimeout(4000);
    expect(initiates).toHaveLength(3);

    await page.unroute(/\/QuickConnect\/Connect\b/);
    await again.click();
    await expect(shownCode(page)).toHaveText(/^\d{3} \d{3}$/);
    expect(initiates).toHaveLength(4);
  });

  test('stops asking the server when it closes: Cancel, Escape, or the page changing', async ({ page }) => {
    const connects: string[] = [];
    page.on('request', (r) => /\/QuickConnect\/Connect\b/.test(r.url()) && connects.push(r.url()));
    const stillAfter = async (): Promise<void> => {
      const asked = connects.length;
      await page.waitForTimeout(4000);
      expect(connects).toHaveLength(asked);
    };

    await openSignInScreen(page);
    await expect.poll(() => connects.length).toBeGreaterThan(0);
    await signInScreen(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(signInScreen(page)).toHaveCount(0);
    await expect(page.locator('.btnQuick')).toBeFocused();
    await stillAfter();

    await page.locator('.btnQuick').click();
    await expect(shownCode(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(signInScreen(page)).toHaveCount(0);
    expect(new URL(page.url()).hash).toMatch(/^#\/login/);
    await stillAfter();

    await page.locator('.btnQuick').click();
    await expect(shownCode(page)).toBeVisible();
    await page.evaluate(() => (location.hash = '#/forgotpassword'));
    await expect(signInScreen(page)).toHaveCount(0);
    await stillAfter();
  });

  test('points the QR code at the public address when an admin set one', async ({ page }) => {
    await setQrAddress('https://jellyfin.example.com/jf/');
    try {
      const code = await openSignInScreen(page);
      await expect(page.locator('meta[name="lumen-quick-connect-address"]')).toHaveAttribute(
        'content',
        'https://jellyfin.example.com/jf/',
      );
      expect(await readQr(page)).toBe(`https://jellyfin.example.com/jf/web/#/quickconnect?code=${code}`);
    } finally {
      await setQrAddress(null);
    }
    await page.reload();
    await expect(page.locator('meta[name="lumen-quick-connect-address"]')).toHaveCount(0);
  });

  test("leaves Quick Connect to jellyfin-web's dialog when what Lumen signs in with isn't there", async ({ page }) => {
    await page.goto('/web/#/login');
    await page.locator('.btnQuick').waitFor();
    await page.evaluate(() => delete (window as unknown as { Dashboard: { navigate?: unknown } }).Dashboard.navigate);
    await page.locator('.btnQuick').click();
    await expect(page.locator('.dialog').filter({ hasText: /\d{6}/ })).toBeVisible();
    await expect(signInScreen(page)).toHaveCount(0);
  });
});

test.describe('TV layout', () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('layout', 'tv'));
  });

  test('TV layout: Quick Connect is the main button, opens on OK, keeps the D-pad, and Back closes it', async ({ page }) => {
    await page.goto('/web/#/login');
    await expect(page.locator('html')).toHaveClass(/\blayout-tv\b/);
    const button = page.locator('.btnQuick');
    await expect(button).toBeVisible();
    // Highlighted, in the accent, but it doesn't open by itself.
    const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--lmn-accent').trim());
    expect(accent).not.toBe('');
    await expect(button).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const submit = page.locator('.manualLoginForm .button-submit');
    expect(await button.evaluate((b) => getComputedStyle(b).backgroundColor)).not.toBe(
      await submit.evaluate((b) => getComputedStyle(b).backgroundColor),
    );
    await page.waitForTimeout(1500);
    await expect(signInScreen(page)).toHaveCount(0);

    // Down from the sign-in form reaches it.
    await page.locator('#txtManualPassword').focus();
    for (let i = 0; i < 8 && !(await button.evaluate((b) => b === document.activeElement)); i++) await page.keyboard.press('ArrowDown');
    await expect(button).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(shownCode(page)).toBeVisible();
    // Big enough to read from the sofa: over a tenth of the screen's height.
    const height = await shownCode(page).evaluate((c) => c.getBoundingClientRect().height);
    expect(height).toBeGreaterThan(72);

    const cancel = signInScreen(page).getByRole('button', { name: 'Cancel' });
    await expect(cancel).toBeFocused();
    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight']) {
      await page.keyboard.press(key);
      await expect(cancel, key).toBeFocused();
    }
    await page.keyboard.press('Escape');
    await expect(signInScreen(page)).toHaveCount(0);
    expect(new URL(page.url()).hash).toMatch(/^#\/login/);
    await expect(button).toBeFocused();
  });

  test('TV layout: the approve page goes from the code to Approve with the D-pad', async ({ page }) => {
    await login(page, KID);
    await openApprovePage(page);
    await expect(codeField(page)).toBeFocused();
    await page.keyboard.type('123456');
    await expect(codeField(page)).toHaveValue('123456');
    await page.keyboard.press('ArrowDown');
    await expect(approveButton(page)).toBeFocused();
  });
});
