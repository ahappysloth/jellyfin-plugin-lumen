import { expect, test } from '@playwright/test';
import { ADMIN } from '../support/api';
import { login } from '../support/login';

// A phone: Lumen's tab bar is at the bottom of the screen.
test.use({ viewport: { width: 390, height: 844 } });

test("jellyfin-web's now-playing bar sits on top of Lumen's tab bar, not over it", async ({ page }) => {
  await login(page, ADMIN);
  const tabbar = page.locator('#lmn-root .lmn-tabbar');
  await expect(tabbar).toBeVisible();
  // The fixtures have no music: put a bar of the real one's height into jellyfin-web's real footer.
  const footer = page.locator('body > .appfooter');
  await footer.evaluate((el) => {
    const bar = document.createElement('div');
    bar.className = 'nowPlayingBar';
    bar.style.height = '55px';
    el.appendChild(bar);
  });
  const footerBox = (await footer.boundingBox())!;
  const tabbarBox = (await tabbar.boundingBox())!;
  expect(footerBox.height).toBeGreaterThan(50);
  expect(footerBox.y + footerBox.height).toBeLessThanOrEqual(tabbarBox.y + 1);
});
