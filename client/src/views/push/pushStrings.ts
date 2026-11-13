/**
 * Strings only the notifications toggle shows (see strings.ts). Only its chunk imports this (views/push/lazyPush.tsx),
 * so they don't weigh on startup.
 */
export const pushStrings = {
  heading: 'Notifications',
  label: 'Notify me when requests are ready',
  offHint:
    'A notification on this device when something you requested is ready to watch, even with the app closed.',
  onHint: 'On for this device.',
  blockedHint:
    'Notifications are blocked for this site. Allow them in your browser’s settings, then turn this on.',
  // iOS only delivers notifications to a web app on the Home Screen (16.4 and later), not to a Safari tab.
  homeScreenHint:
    'On an iPhone or iPad, notifications need the Home Screen app: tap Share, then Add to Home Screen, open the app from there and turn this on.',
  test: 'Send a test notification',
  testSending: 'Sending…',
  testSent: 'Sent. It should arrive in a moment.',
  testWait: 'Wait a moment before sending another test.',
  testFailed: "Couldn't send the test. Try again later.",
  onFailed: "Couldn't turn notifications on. Try again.",
  offFailed: "Couldn't turn notifications off. Try again.",
} as const;
