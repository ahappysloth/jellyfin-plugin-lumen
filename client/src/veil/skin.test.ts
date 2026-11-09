import { afterEach, describe, expect, it } from 'vitest';
import {
  applyDashboardSkin,
  applySignInSkin,
  DASHBOARD_CLASS,
  isAdminRoute,
  isSignInRoute,
  SIGN_IN_CLASS,
} from './skin';

describe('sign-in skin', () => {
  afterEach(() => {
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-lmn-skin');
    document.documentElement.removeAttribute('style');
  });

  it.each([
    ['#/login', true],
    ['#!/login?serverid=x', true],
    ['#/forgotpassword', true],
    ['#/home', false],
    ['#/mypreferencesmenu', false],
  ])('isSignInRoute(%s) = %s', (hash, expected) => {
    expect(isSignInRoute(hash)).toBe(expected);
  });

  it('styles sign-in pages only when the server opted in, with the server name as a CSS string', () => {
    applySignInSkin(document, '#/login', 'Den');
    expect(document.documentElement.classList.contains(SIGN_IN_CLASS)).toBe(false);

    document.documentElement.setAttribute('data-lmn-skin', '');
    applySignInSkin(document, '#/login', 'Den "TV"');
    expect(document.documentElement.classList.contains(SIGN_IN_CLASS)).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--lmn-signin-name')).toBe('"Den \\"TV\\""');

    applySignInSkin(document, '#/home');
    expect(document.documentElement.classList.contains(SIGN_IN_CLASS)).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--lmn-signin-name')).toBe('');
  });
});

describe('admin pages skin', () => {
  afterEach(() => {
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-lmn-skin');
  });

  it.each([
    ['#/dashboard', true],
    ['#/dashboard/users/abc/profile', true],
    ['#!/dashboard/plugins?x=1', true],
    ['#/metadata?id=abc', true],
    ['#/configurationpage?name=Lumen', true],
    ['#/dashboardx', false],
    ['#/home', false],
    ['#/mypreferencesmenu', false],
    ['', false],
  ])('isAdminRoute(%s) = %s', (hash, expected) => {
    expect(isAdminRoute(hash)).toBe(expected);
  });

  it('styles admin pages only when the server opted in', () => {
    applyDashboardSkin(document, '#/dashboard');
    expect(document.documentElement.classList.contains(DASHBOARD_CLASS)).toBe(false);

    document.documentElement.setAttribute('data-lmn-skin', '');
    applyDashboardSkin(document, '#/dashboard/plugins');
    expect(document.documentElement.classList.contains(DASHBOARD_CLASS)).toBe(true);

    applyDashboardSkin(document, '#/home');
    expect(document.documentElement.classList.contains(DASHBOARD_CLASS)).toBe(false);
  });
});
