/**
 * Strings only the profile pages show (see strings.ts). Only their chunk imports this (views/profile/lazyProfile.tsx),
 * so they don't weigh on startup. The ones the account menu in the nav shows too (Account, Administrator, History,
 * Sign out, the settings' names…) stay in strings.ts.
 */
export const profileStrings = {
  historyHint: 'What you watched, newest first',
  clientSettingsHint: "This app's own settings",
  downloadManagerHint: 'Downloads on this device',
  activity: 'Activity',
  preferences: 'Preferences',
  administration: 'Administration',
} as const;
