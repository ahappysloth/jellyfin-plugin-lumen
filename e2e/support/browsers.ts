import type { PlaywrightTestArgs, PlaywrightTestOptions, PlaywrightWorkerArgs, PlaywrightWorkerOptions } from '@playwright/test';

type Args = PlaywrightTestArgs & PlaywrightTestOptions & PlaywrightWorkerArgs & PlaywrightWorkerOptions;

/**
 * For `test.skip(cannotPlay, CANNOT_PLAY)`. jellyfin-web takes an iPhone's user agent for iOS Safari and asks the server
 * for HLS, which it leaves to Safari's native HLS support. Playwright's WebKit build for Linux has none, so playback
 * fails there with MEDIA_NOT_SUPPORTED (a real iPhone plays it). WebKit with a desktop user agent direct-plays the VP9
 * fixtures fine, so this is the emulation, not the media.
 */
export const cannotPlay = ({ browserName, isMobile }: Pick<Args, 'browserName' | 'isMobile'>): boolean =>
  browserName === 'webkit' && isMobile;
export const CANNOT_PLAY = "emulated iPhone: jellyfin-web asks for native HLS, which Playwright's WebKit lacks";
