import { afterEach, describe, expect, it } from 'vitest';
import { wantsCheck } from '../admin/updatesLink';
import { createPluginsButton, LUMEN_UPDATES_HASH, UPDATES_BUTTON_ID } from './pluginsButton';

describe("Check for Lumen updates on jellyfin-web's Plugins page", () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const header = (): HTMLAnchorElement => {
    document.body.innerHTML =
      '<div><span>Plugins</span><a class="MuiButton-root MuiButton-outlined css-abc" href="#/dashboard/plugins/repositories">Manage Repositories</a></div>';
    return document.querySelector('a')!;
  };

  it('goes in front of Manage Repositories, looking like it, and opens Lumen’s page to check', () => {
    const repositories = header();
    const button = createPluginsButton(document);
    button.sync('#/dashboard/plugins');

    const added = document.getElementById(UPDATES_BUTTON_ID) as HTMLAnchorElement;
    expect(added.textContent).toBe('Check for Lumen updates');
    expect(added.className).toBe(repositories.className);
    expect(added.nextElementSibling).toBe(repositories);
    expect(added.getAttribute('href')).toBe(LUMEN_UPDATES_HASH);
    expect(wantsCheck(LUMEN_UPDATES_HASH)).toBe(true);
    button.stop();
  });

  it('is added when the page renders after navigating, once, and only on the Plugins page', async () => {
    const button = createPluginsButton(document);
    button.sync('#/dashboard/plugins/repositories');
    header();
    await Promise.resolve();
    expect(document.getElementById(UPDATES_BUTTON_ID)).toBeNull();

    document.body.innerHTML = '';
    button.sync('#/dashboard/plugins');
    header(); // React renders the page later
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelectorAll(`#${UPDATES_BUTTON_ID}`)).toHaveLength(1);
    button.stop();
  });

  it('adds nothing when the page has no Manage Repositories button', () => {
    document.body.innerHTML = '<div>Plugins</div>';
    const button = createPluginsButton(document);
    button.sync('#/dashboard/plugins');
    expect(document.getElementById(UPDATES_BUTTON_ID)).toBeNull();
    button.stop();
  });

  it.each([
    ['#/configurationpage?name=Lumen&check=updates', true],
    ['#/configurationpage?name=Lumen', false],
    ['#/configurationpage?name=Lumen&check=other', false],
  ])('wantsCheck(%s) = %s', (hash, expected) => {
    expect(wantsCheck(hash)).toBe(expected);
  });
});
