import { HEALTH_FIX_ROUTES } from '../../compat/registry';
import type { HealthFix } from './healthModel';

/** Where the help pages are: on GitHub, so the link works from any server and stays current. */
export const HELP_LINKS: Record<string, string> = {
  skipIntro: 'https://github.com/ahappysloth/jellyfin-plugin-lumen/blob/main/docs/skip-intro-setup.md',
};

/** The settings cards a fix can open, by key (each Card's `anchor`). */
export const SETTING_CARDS = ['updates', 'general', 'hero', 'requests', 'trakt'] as const;

/** A fix's target: a link (a Dashboard page or help), or a card on the Settings tab to open; null when unknown. */
export function resolveFix(
  fix: HealthFix,
): { kind: 'link'; href: string; external: boolean } | { kind: 'setting'; card: string } | null {
  if (fix.Kind === 'dashboard') {
    const route = (HEALTH_FIX_ROUTES as Record<string, string>)[fix.Target];
    return route ? { kind: 'link', href: `#${route}`, external: false } : null;
  }
  if (fix.Kind === 'help') {
    const href = HELP_LINKS[fix.Target];
    return href ? { kind: 'link', href, external: true } : null;
  }
  return (SETTING_CARDS as readonly string[]).includes(fix.Target)
    ? { kind: 'setting', card: fix.Target }
    : null;
}
