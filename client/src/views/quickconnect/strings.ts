import type { ApproveOutcome } from './model';

/**
 * Quick Connect's own strings, in its file (strings.ts holds those the core needs, Cancel and Try again among them).
 * Kept short: the file has a 6 KB budget.
 */
const OFF = 'Quick Connect is turned off on this server.';

export const qcStrings = {
  // The sign-in screen (SignInScreen.tsx).
  signInTitle: 'Sign in with Quick Connect',
  steps: 'On your phone or computer, open Lumen → Quick Connect and enter this code',
  orScan: ', or scan the QR code',
  /** Read digit by digit: "Your code: 1 2 3 4 5 6". */
  codeLabel: (code: string) => `Your code: ${code.split('').join(' ')}`,
  qrLabel: 'QR code',
  /** What the screen says in each state but showing its code (model.ts SignInState). */
  state: {
    starting: 'Getting a code…',
    signingIn: 'Approved. Signing in…',
    expired: 'That code has expired.',
    disabled: OFF,
    failed: "Couldn't get a code.",
    signInFailed: "Couldn't sign in.",
  },
  newCode: 'Get a new code',

  // The approve page (ApprovePage.tsx).
  signsInAs: 'Signs in as',
  code: 'Code',
  approve: 'Approve',
  fromLink: 'This code came from a link or QR code. ',
  warning: 'Only approve a code shown on a screen in front of you.',
  adminAccess: ' That device gets administrator access.',
  how: 'How it works: on the other device’s sign-in screen, pick “Use Quick Connect” and enter its code here.',
  approved: (name: string) => `Done: that device is signed in as ${name}.`,
  outcome: {
    incomplete: 'Enter all six digits.',
    invalid: 'That code isn’t valid or has expired.',
    used: 'That code has already been used.',
    disabled: OFF,
    signedOut: 'Your sign-in has expired. Sign in again.',
    offline: 'Couldn’t reach the server.',
    failed: 'Something went wrong.',
  } satisfies Record<Exclude<ApproveOutcome, 'approved'> | 'incomplete', string>,
  turnOn: 'Turn it on in Dashboard → General',
};
