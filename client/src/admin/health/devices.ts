import { isTestedVersion, majorMinor } from '../../compat/testedVersions';
import type { DeviceReport, HealthStatus } from './healthModel';

/**
 * Today's compatibility failures in plain words: which device and browser, what broke, what Lumen did instead, and
 * whether updating Jellyfin or the browser would help. The check ids are the ones the client reports
 * (compat/jellyfin.ts selfTest, compat/playbackManager.ts, takeover/takeover.ts's selector probe); the raw ids stay
 * available on the page behind a details toggle.
 */

/** What broke and what Lumen did about it. `cause`: what changed, so what an update could fix. */
interface CheckText {
  broke: string;
  did: string;
  cause: 'jellyfin' | 'browser' | 'test';
  /** Problem: Lumen gave the page (or player) back to Jellyfin. Warning: Lumen's page showed, but something may show through. */
  status: HealthStatus;
}

const FELL_BACK = "Lumen showed Jellyfin's own pages on this device instead of its own.";
const OWN_PLAYER = "Lumen left Jellyfin's own video player controls in place.";

const CHECKS: Record<string, CheckText> = {
  apiClient: {
    broke: "Jellyfin's web app didn't offer the connection Lumen uses to talk to the server.",
    did: FELL_BACK,
    cause: 'jellyfin',
    status: 'Problem',
  },
  reactRoot: {
    broke: "Jellyfin's web app wasn't laid out as Lumen expects (its app container was missing).",
    did: FELL_BACK,
    cause: 'jellyfin',
    status: 'Problem',
  },
  stockPage: {
    broke: "Jellyfin's page content wasn't where Lumen expects it.",
    did: FELL_BACK,
    cause: 'jellyfin',
    status: 'Problem',
  },
  layoutClass: {
    broke: "Jellyfin didn't say which layout (TV, phone or desktop) it was using.",
    did: FELL_BACK,
    cause: 'jellyfin',
    status: 'Problem',
  },
  history: {
    broke: 'The browser lacks the page history support Lumen needs.',
    did: FELL_BACK,
    cause: 'browser',
    status: 'Problem',
  },
  hashRouting: {
    broke: "Jellyfin's page addresses weren't the kind Lumen expects.",
    did: FELL_BACK,
    cause: 'jellyfin',
    status: 'Problem',
  },
  forced: {
    broke: "Lumen's compatibility test switch was on in this browser.",
    did: FELL_BACK,
    cause: 'test',
    status: 'Problem',
  },
  'selector.appBar': {
    broke: "Jellyfin's header changed, so Lumen couldn't hide it.",
    did: "Lumen's pages still showed, but Jellyfin's header may show over them.",
    cause: 'jellyfin',
    status: 'Warning',
  },
  'selector.videoOsd': {
    broke: "Jellyfin's player controls changed, so Lumen couldn't hide them.",
    did: "Lumen's player controls still showed, but Jellyfin's may show beneath them.",
    cause: 'jellyfin',
    status: 'Warning',
  },
  'selector.upNext': {
    broke: "Jellyfin's next-episode card changed.",
    did: "Lumen shows Jellyfin's own next-episode card instead.",
    cause: 'jellyfin',
    status: 'Warning',
  },
};

/** One failed check, in words. */
export function describeCheck(id: string): CheckText {
  const known = CHECKS[id];
  if (known) return known;
  if (id.startsWith('playbackManager.'))
    return {
      broke: `Jellyfin's video player changed: it no longer has ${id.slice('playbackManager.'.length)}, which Lumen's controls use.`,
      did: OWN_PLAYER,
      cause: 'jellyfin',
      status: 'Problem',
    };
  if (id.startsWith('playbackManager:'))
    return {
      broke: "Lumen couldn't find Jellyfin's video player.",
      did: OWN_PLAYER,
      cause: 'jellyfin',
      status: 'Problem',
    };
  if (id.startsWith('selector.'))
    return {
      broke: `Part of Jellyfin's page that Lumen hides (${id.slice('selector.'.length)}) wasn't there.`,
      did: "Lumen's page still showed, but part of Jellyfin's may show through.",
      cause: 'jellyfin',
      status: 'Warning',
    };
  return {
    broke: `A compatibility check Lumen doesn't describe failed (${id}).`,
    did: FELL_BACK,
    cause: 'jellyfin',
    status: 'Problem',
  };
}

export interface ClientInfo {
  /** "LG TV (webOS)", "iPhone", "Windows PC". */
  device: string;
  /** "Chrome 120", "Safari 17", "Chromium 68 (built in)". */
  browser: string;
  /** The engine's major version, for "is it old"; null when unknown. */
  engine: { name: 'Chromium' | 'Safari' | 'Firefox'; version: number } | null;
  /** jellyfin-web's layout: tv, mobile or desktop. */
  layout: string;
  /** A TV's browser updates only with the TV's software. */
  tv: boolean;
}

const LAYOUTS = ['tv', 'mobile', 'desktop'];

/** Reads the device and browser from a report's client: `${layout} ${userAgent}` (takeover/bootstrap.ts). */
export function parseClient(client: string): ClientInfo {
  const space = client.indexOf(' ');
  const first = space < 0 ? client : client.slice(0, space);
  const layout = LAYOUTS.includes(first) ? first : '';
  const ua = layout ? client.slice(space + 1) : client;

  const match = (pattern: RegExp): number | null => {
    const m = pattern.exec(ua);
    return m ? Number.parseInt(m[1]!, 10) : null;
  };
  const chrome = match(/(?:Chrome|Chromium|CriOS)\/(\d+)/);
  const safari = match(/Version\/(\d+)(?:\.\d+)*.*Safari/);
  const firefox = match(/(?:Firefox|FxiOS)\/(\d+)/);

  let device = 'Unknown device';
  let tv = false;
  if (/Web0S|webOS/i.test(ua)) [device, tv] = ['LG TV (webOS)', true];
  else if (/Tizen/i.test(ua)) [device, tv] = ['Samsung TV (Tizen)', true];
  else if (/Xbox/i.test(ua)) [device, tv] = ['Xbox', true];
  else if (/iPhone/.test(ua)) device = 'iPhone';
  else if (/iPad/.test(ua)) device = 'iPad';
  else if (/Android TV|AFT[A-Z]|BRAVIA|SHIELD|GoogleTV/i.test(ua)) [device, tv] = ['Android TV', true];
  else if (/Android/.test(ua)) device = 'Android phone or tablet';
  else if (/CrOS/.test(ua)) device = 'Chromebook';
  else if (/Windows/.test(ua)) device = 'Windows PC';
  else if (/Macintosh|Mac OS X/.test(ua)) device = 'Mac';
  else if (/Linux/.test(ua)) device = 'Linux PC';

  let browser = 'Unknown browser';
  let engine: ClientInfo['engine'] = null;
  const edge = match(/Edg(?:e|A|iOS)?\/(\d+)/);
  const samsung = match(/SamsungBrowser\/(\d+)/);
  const opera = match(/OPR\/(\d+)/);
  if (/JellyfinMediaPlayer|Jellyfin Media Player/i.test(ua)) browser = 'Jellyfin Media Player';
  else if (edge !== null) browser = `Edge ${edge}`;
  else if (samsung !== null) browser = `Samsung Internet ${samsung}`;
  else if (opera !== null) browser = `Opera ${opera}`;
  else if (firefox !== null) browser = `Firefox ${firefox}`;
  else if (chrome !== null)
    browser = tv
      ? `Chromium ${chrome} (built in)`
      : /; wv\)/.test(ua)
        ? `Android app (WebView, Chrome ${chrome})`
        : `Chrome ${chrome}`;
  else if (safari !== null) browser = `Safari ${safari}`;
  else if (/AppleWebKit/.test(ua)) browser = /iPhone|iPad/.test(ua) ? 'Safari (in an app)' : 'WebKit';

  if (/CriOS|FxiOS|EdgiOS/.test(ua)) {
    // Every iOS browser is Safari underneath: its version is the system's.
    const ios = match(/OS (\d+)_/);
    engine = ios !== null ? { name: 'Safari', version: ios } : null;
  } else if (firefox !== null) engine = { name: 'Firefox', version: firefox };
  else if (chrome !== null) engine = { name: 'Chromium', version: chrome };
  else if (safari !== null) engine = { name: 'Safari', version: safari };

  return { device, browser, engine, layout, tv };
}

/**
 * Engines older than this are worth updating if they can be: Lumen supports Chromium 68 and Safari 13, but those lack
 * fixes later ones have.
 */
const CURRENT_ENOUGH = { Chromium: 100, Safari: 15, Firefox: 100 } as const;

export interface DeviceRow {
  status: HealthStatus;
  /** "LG TV (webOS), Chromium 68 (built in), TV layout". */
  title: string;
  broke: string[];
  did: string[];
  /** Whether updating Jellyfin, Lumen or the browser would help. */
  advice: string;
  ids: string[];
  serverVersion: string;
  lastSeen: string;
}

/** The Jellyfin version a report was made on, without the "(untested)" mark the client adds. */
function reportedVersion(serverVersion: string): string {
  return serverVersion.replace(/\s*\(untested\)\s*$/, '');
}

export function describeDevice(report: DeviceReport): DeviceRow {
  const client = parseClient(report.Client);
  // Missing player methods read as one sentence ("it no longer has getPlaybackRate and setPlaybackRate"), not one each.
  const methods = report.FailedChecks.filter((id) => id.startsWith('playbackManager.')).map((id) =>
    id.slice('playbackManager.'.length),
  );
  const texts = report.FailedChecks.filter(
    (id) => !id.startsWith('playbackManager.') || id === `playbackManager.${methods[0]}`,
  ).map((id) =>
    id.startsWith('playbackManager.') && methods.length > 1
      ? {
          ...describeCheck(id),
          broke: `Jellyfin's video player changed: it no longer has ${methods.slice(0, -1).join(', ')} and ${methods[methods.length - 1]}, which Lumen's controls use.`,
        }
      : describeCheck(id),
  );
  const unique = (list: string[]): string[] => list.filter((t, i) => list.indexOf(t) === i);
  const version = reportedVersion(report.ServerVersion);
  const release = majorMinor(version) ?? version;
  const tested = isTestedVersion(version);

  const advice: string[] = [];
  if (texts.some((t) => t.cause === 'test'))
    advice.push('Turn the test switch off (or reload without it); nothing needs updating.');
  if (texts.some((t) => t.cause === 'jellyfin'))
    advice.push(
      tested
        ? `Lumen is tested with Jellyfin ${release}, so updating Jellyfin is unlikely to help. Copy the report into a bug report.`
        : `Lumen hasn't been tested with Jellyfin ${release} yet: a Lumen update may fix this. Updating the browser won't.`,
    );
  const old = client.engine && client.engine.version < CURRENT_ENOUGH[client.engine.name];
  if (texts.some((t) => t.cause === 'browser') || (old && texts.some((t) => t.cause !== 'test')))
    advice.push(
      client.tv
        ? "The TV's browser is old and updates only with the TV's software: update the TV if an update is offered."
        : texts.some((t) => t.cause === 'browser')
          ? 'Updating the browser should fix this.'
          : 'The browser is old: updating it may help.',
    );

  return {
    status: texts.some((t) => t.status === 'Problem') ? 'Problem' : 'Warning',
    title: [
      client.device,
      client.browser,
      client.layout && `${client.layout === 'tv' ? 'TV' : client.layout} layout`,
    ]
      .filter(Boolean)
      .join(', '),
    broke: unique(texts.map((t) => t.broke)),
    did: unique(texts.map((t) => t.did)),
    advice: advice.join(' '),
    ids: report.FailedChecks,
    serverVersion: report.ServerVersion,
    lastSeen: report.LastSeen,
  };
}
