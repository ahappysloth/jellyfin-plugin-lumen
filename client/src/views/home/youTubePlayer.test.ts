import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectYouTubePlayer,
  embedBase,
  embedUrl,
  isYouTubeId,
  LISTENING,
  parseYouTubeMessage,
  YOUTUBE_EMBED_BASE,
  youTubeCommand,
  type PlayerStatus,
} from './youTubePlayer';

const ORIGIN = 'https://www.youtube-nocookie.com';
/** A message as the real embed sends it: a JSON string with the page's channel id. */
const message = (event: string, info?: unknown) =>
  JSON.stringify({ event, info, id: 'lumen', channel: 'widget' });

describe('isYouTubeId', () => {
  it('takes exactly eleven id characters', () => {
    expect(isYouTubeId('dQw4w9WgXcQ')).toBe(true);
    expect(isYouTubeId('a-B_c9D-e_F')).toBe(true);
    for (const bad of [
      '',
      'dQw4w9WgXc',
      'dQw4w9WgXcQQ',
      'dQw4w9WgXc?',
      'dQw4w9/gXcQ',
      'dQw4w9WgXcQ\n',
      null,
      42,
    ])
      expect(isYouTubeId(bad)).toBe(false);
  });
});

describe('embedBase', () => {
  it("is YouTube's no-cookie address unless the server names another", () => {
    expect(embedBase()).toBe(YOUTUBE_EMBED_BASE);
    expect(embedBase(null)).toBe(ORIGIN);
    expect(embedBase('')).toBe(ORIGIN);
  });

  it('takes an https origin, or http on this machine', () => {
    expect(embedBase('https://stub.example:8443')).toBe('https://stub.example:8443');
    expect(embedBase('http://localhost:5055')).toBe('http://localhost:5055');
    expect(embedBase('http://127.0.0.1:5055')).toBe('http://127.0.0.1:5055');
    expect(embedBase('http://host.docker.internal:5055')).toBe('http://host.docker.internal:5055');
  });

  it('ignores anything else', () => {
    for (const bad of [
      'http://example.com',
      'http://localhost.example.com',
      'https://stub.example/path',
      'https://stub.example/?x=1',
      'https://user:pass@stub.example',
      'javascript:alert(1)',
      'data:text/html,x',
      '//stub.example',
      'https://stub.example" onload="x',
    ])
      expect(embedBase(bad)).toBe(ORIGIN);
  });
});

describe('embedUrl', () => {
  it('asks for a muted, inline, chromeless player that talks to this page only', () => {
    const url = new URL(
      embedUrl(ORIGIN, 'dQw4w9WgXcQ', { origin: 'https://jellyfin.example:8920', autoplay: true }),
    );
    expect(url.origin + url.pathname).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      autoplay: '1',
      mute: '1',
      controls: '0',
      playsinline: '1',
      rel: '0',
      iv_load_policy: '3',
      disablekb: '1',
      fs: '0',
      enablejsapi: '1',
      origin: 'https://jellyfin.example:8920',
    });
  });

  it('waits when told to, and starts where asked, in whole seconds', () => {
    const url = new URL(
      embedUrl(ORIGIN, 'dQw4w9WgXcQ', { origin: 'http://x', autoplay: false, start: 12.8 }),
    );
    expect(url.searchParams.get('autoplay')).toBe('0');
    expect(url.searchParams.get('start')).toBe('12');
    expect(embedUrl(ORIGIN, 'dQw4w9WgXcQ', { origin: 'http://x', autoplay: true, start: 0 })).not.toContain(
      'start=',
    );
  });
});

describe('parseYouTubeMessage', () => {
  // Shapes copied from the real embed (November 2026), cut down to a few of their fields.
  it('reads the first delivery: ready, with the state, time and exact length', () => {
    const data = message('initialDelivery', {
      apiInterface: ['playVideo', 'pauseVideo'],
      muted: true,
      volume: 100,
      playerState: 3,
      currentTime: 0,
      duration: 184.461,
      videoData: { video_id: 'n9xhJrPXop4', title: 'Dune Official Trailer', errorCode: null },
    });
    expect(parseYouTubeMessage(data)).toEqual({ ready: true, state: 3, currentTime: 0, duration: 184.461 });
  });

  it('reads onReady, a time tick, a change of state and an error', () => {
    expect(parseYouTubeMessage(message('onReady', null))).toEqual({ ready: true });
    expect(
      parseYouTubeMessage(
        message('infoDelivery', { currentTime: 1.175003, videoLoadedFraction: 0.09, playbackRate: 1 }),
      ),
    ).toEqual({ currentTime: 1.175003 });
    expect(
      parseYouTubeMessage(message('infoDelivery', { playerState: 1, currentTime: 0.005754, duration: 185 })),
    ).toEqual({ state: 1, currentTime: 0.005754, duration: 185 });
    expect(parseYouTubeMessage(message('onStateChange', 2))).toEqual({ state: 2 });
    expect(parseYouTubeMessage(message('onError', 150))).toEqual({ error: 150 });
  });

  it('reads every state the player has', () => {
    for (const state of [-1, 0, 1, 2, 3, 5])
      expect(parseYouTubeMessage(message('onStateChange', state))).toEqual({ state });
  });

  it("ignores the player's other messages", () => {
    expect(parseYouTubeMessage(message('infoDelivery', { muted: true, volume: 100 }))).toBeNull();
    expect(parseYouTubeMessage(message('apiInfoDelivery', { namespaces: ['captions'] }))).toBeNull();
    expect(parseYouTubeMessage(message('alreadyInitialized', null))).toBeNull();
    expect(parseYouTubeMessage(message('infoDelivery', null))).toBeNull();
    expect(parseYouTubeMessage(message('infoDelivery'))).toBeNull();
  });

  it('ignores what is not a message of the player at all', () => {
    for (const data of [
      undefined,
      null,
      42,
      { event: 'onStateChange', info: 1 }, // an object, not the JSON string the player sends
      '',
      'not json',
      '[1,2,3]',
      '"onReady"',
      'null',
      '{"event":',
      '{}',
      '{"event":42}',
      '{"info":{"playerState":1}}',
      `{"event":"infoDelivery","info":{"currentTime":1},"pad":"${'x'.repeat(100_000)}"}`,
    ])
      expect(parseYouTubeMessage(data)).toBeNull();
  });

  it('drops values that are not what they should be, keeping the rest', () => {
    expect(parseYouTubeMessage(message('onStateChange', 4))).toBeNull();
    expect(parseYouTubeMessage(message('onStateChange', '1'))).toBeNull();
    expect(parseYouTubeMessage(message('onStateChange', { playerState: 1 }))).toBeNull();
    expect(parseYouTubeMessage(message('onError', 'boom'))).toBeNull();
    expect(
      parseYouTubeMessage(
        message('infoDelivery', { playerState: 9, currentTime: -1, duration: 0, extra: { nested: true } }),
      ),
    ).toBeNull();
    expect(
      parseYouTubeMessage(message('infoDelivery', { playerState: '1', currentTime: '3', duration: 120 })),
    ).toEqual({ duration: 120 });
    // JSON has no NaN or Infinity; a string or null in their place is no number.
    expect(
      parseYouTubeMessage('{"event":"infoDelivery","info":{"currentTime":null,"duration":"Infinity"}}'),
    ).toBeNull();
  });
});

describe('connectYouTubePlayer', () => {
  let frame: HTMLIFrameElement;
  let posted: string[];
  let statuses: PlayerStatus[];
  let times: number[];
  let ready: number;

  /** The player says something, from its own frame and origin unless told otherwise. */
  const say = (event: string, info?: unknown, from: { origin?: string; source?: Window | null } = {}) =>
    window.dispatchEvent(
      new MessageEvent('message', {
        data: message(event, info),
        origin: from.origin ?? ORIGIN,
        source: from.source === undefined ? frame.contentWindow : from.source,
      }),
    );
  const commands = () =>
    posted.filter((p) => p !== LISTENING).map((p) => JSON.parse(p) as { func: string; args: unknown[] });
  const connect = (base = ORIGIN) =>
    connectYouTubePlayer(frame, base, {
      onReady: () => ready++,
      onStatus: (status) => statuses.push(status),
      onTime: (clock) => times.push(clock.currentTime),
    });

  beforeEach(() => {
    vi.useFakeTimers();
    frame = document.createElement('iframe');
    document.body.append(frame);
    posted = [];
    statuses = [];
    times = [];
    ready = 0;
    // jsdom's frame is an empty page of this origin: what it's sent, and for whom, is all there is to see.
    vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(((data: string, target: string) => {
      expect(target).toBe(ORIGIN);
      posted.push(data);
    }) as Window['postMessage']);
  });
  afterEach(() => {
    frame.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("tells the player it's listening once the frame has loaded, until it answers", () => {
    const player = connect();
    vi.advanceTimersByTime(1000);
    expect(posted).toEqual([]); // nothing to talk to yet

    frame.dispatchEvent(new Event('load'));
    expect(posted).toEqual([LISTENING]);
    vi.advanceTimersByTime(500);
    expect(posted).toEqual([LISTENING, LISTENING, LISTENING]);

    say('initialDelivery', { playerState: -1, currentTime: 0, duration: 184.461 });
    expect(ready).toBe(1);
    // As YouTube's own script does: asks to be told of state changes and errors.
    expect(commands()).toEqual([
      { event: 'command', func: 'addEventListener', args: ['onStateChange'], id: 'lumen', channel: 'widget' },
      { event: 'command', func: 'addEventListener', args: ['onError'], id: 'lumen', channel: 'widget' },
    ]);
    const sent = posted.length;
    vi.advanceTimersByTime(5000);
    say('onReady', null);
    expect(posted).toHaveLength(sent); // and stops saying so
    expect(ready).toBe(1);
    expect(player.status).toBe('loading');
  });

  it('says so at once for a frame that had loaded before it got here', () => {
    connectYouTubePlayer(frame, ORIGIN, { onStatus: vi.fn(), onTime: vi.fn() }, true);
    expect(posted).toEqual([LISTENING]);
    vi.advanceTimersByTime(250);
    expect(posted).toEqual([LISTENING, LISTENING]);
  });

  it('gives up saying so after ten seconds without an answer', () => {
    connect();
    frame.dispatchEvent(new Event('load'));
    vi.advanceTimersByTime(60_000);
    expect(posted).toHaveLength(40);
  });

  it('maps the states it reports: playing, paused, buffering, ended', () => {
    const player = connect();
    say('initialDelivery', { playerState: 3, currentTime: 0, duration: 184.461 });
    say('infoDelivery', { playerState: 1, currentTime: 0.01, duration: 184.461 });
    say('onStateChange', 1); // the same again, as an event: nothing new
    say('infoDelivery', { playerState: 2, currentTime: 6.2 });
    say('onStateChange', 3);
    say('onStateChange', 1);
    say('infoDelivery', { playerState: 0, currentTime: 184.461 });
    expect(statuses).toEqual(['buffering', 'playing', 'paused', 'buffering', 'playing', 'ended']);
    expect(player.status).toBe('ended');

    // Over is over: the end screen's replay button isn't the preview's business.
    say('onStateChange', 1);
    expect(statuses).toHaveLength(6);
  });

  it('counts unstarted and cued as still loading', () => {
    const player = connect();
    say('initialDelivery', { playerState: -1, currentTime: 0 });
    say('onStateChange', 5);
    expect(statuses).toEqual([]);
    expect(player.status).toBe('loading');
  });

  it.each([2, 5, 100, 101, 150])('takes error %i as final', (code) => {
    const player = connect();
    say('initialDelivery', { playerState: -1, currentTime: 0, duration: 0 });
    say('onError', code);
    say('onStateChange', 1);
    expect(statuses).toEqual(['error']);
    expect(player.status).toBe('error');
  });

  it('reports the time while it plays, and only then', () => {
    connect();
    say('initialDelivery', { playerState: 3, currentTime: 0, duration: 100 });
    say('infoDelivery', { currentTime: 0 }); // buffering
    expect(times).toEqual([]);
    say('infoDelivery', { playerState: 1, currentTime: 0.2 });
    say('infoDelivery', { currentTime: 0.45 });
    say('infoDelivery', { playerState: 2, currentTime: 0.5 });
    say('infoDelivery', { currentTime: 0.5 });
    expect(times).toEqual([0.2, 0.45]);
  });

  it('ignores messages from another origin or another window', () => {
    const player = connect();
    say('onStateChange', 1, { origin: 'https://evil.example' });
    say('onStateChange', 1, { origin: 'https://www.youtube.com' });
    say('onStateChange', 1, { source: window });
    say('onStateChange', 1, { source: null });
    const other = document.createElement('iframe');
    document.body.append(other);
    say('onStateChange', 1, { source: other.contentWindow });
    other.remove();
    expect(statuses).toEqual([]);
    expect(ready).toBe(0);
    expect(player.status).toBe('loading');
    expect(posted).toEqual([]);
  });

  it("ignores a message that isn't the player's, from the right frame", () => {
    connect();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { event: 'onStateChange', info: 1 },
        origin: ORIGIN,
        source: frame.contentWindow,
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', { data: 'garbage', origin: ORIGIN, source: frame.contentWindow }),
    );
    expect(statuses).toEqual([]);
    expect(ready).toBe(0);
  });

  it("talks to the stub player's origin when that is where it was loaded from", () => {
    vi.mocked(frame.contentWindow!.postMessage).mockImplementation(((data: string, target: string) => {
      expect(target).toBe('http://localhost:5055');
      posted.push(data);
    }) as Window['postMessage']);
    connect('http://localhost:5055');
    frame.dispatchEvent(new Event('load'));
    say('onStateChange', 1); // from YouTube's origin: not this player's
    expect(statuses).toEqual([]);
    say('onStateChange', 1, { origin: 'http://localhost:5055' });
    expect(statuses).toEqual(['playing']);
    expect(posted[0]).toBe(LISTENING);
  });

  it('sends play, pause, mute and captions-off as commands', () => {
    const player = connect();
    player.play();
    player.pause();
    player.setMuted(false);
    player.setMuted(true);
    player.hideCaptions();
    expect(posted).toEqual([
      youTubeCommand('playVideo'),
      youTubeCommand('pauseVideo'),
      youTubeCommand('unMute'),
      youTubeCommand('mute'),
      youTubeCommand('unloadModule', ['captions']),
    ]);
    expect(JSON.parse(posted[0]!)).toEqual({
      event: 'command',
      func: 'playVideo',
      args: [],
      id: 'lumen',
      channel: 'widget',
    });
  });

  describe('clock', () => {
    it('runs on between messages while it plays, and stands still otherwise', () => {
      const { clock } = connect();
      expect(clock.currentTime).toBe(0);
      expect(clock.duration).toBeNaN(); // not known yet: the hero waits for a real length
      say('initialDelivery', { playerState: 3, currentTime: 0, duration: 100 });
      vi.advanceTimersByTime(400);
      expect(clock.currentTime).toBe(0);

      say('infoDelivery', { playerState: 1, currentTime: 2 });
      vi.advanceTimersByTime(200);
      expect(clock.currentTime).toBeCloseTo(2.2, 3);
      say('infoDelivery', { currentTime: 2.26 });
      expect(clock.currentTime).toBeCloseTo(2.26, 3);

      say('infoDelivery', { playerState: 2, currentTime: 2.3 });
      vi.advanceTimersByTime(5000);
      expect(clock.currentTime).toBeCloseTo(2.3, 3);
    });

    it("keeps the shortest length it's told (exact first, rounded up later) and never runs past it", () => {
      const { clock } = connect();
      say('initialDelivery', { playerState: 1, currentTime: 184, duration: 184.461 });
      say('infoDelivery', { playerState: 1, currentTime: 184.2, duration: 185 });
      expect(clock.duration).toBe(184.461);
      vi.advanceTimersByTime(3000);
      expect(clock.currentTime).toBe(184.461);
    });

    it('goes back for a rewind, holding where it was until the player is there again', () => {
      const player = connect();
      say('initialDelivery', { playerState: 1, currentTime: 20, duration: 100 });
      say('infoDelivery', { playerState: 2, currentTime: 20 });
      posted.length = 0;

      player.rewind(4.5);
      expect(commands()).toEqual([
        { event: 'command', func: 'seekTo', args: [15.5, true], id: 'lumen', channel: 'widget' },
      ]);
      say('infoDelivery', { playerState: 1, currentTime: 15.5 });
      expect(player.clock.currentTime).toBe(20);
      say('infoDelivery', { currentTime: 19.9 });
      expect(player.clock.currentTime).toBe(20);
      say('infoDelivery', { currentTime: 21 });
      expect(player.clock.currentTime).toBe(21);
    });

    it("doesn't rewind past the start", () => {
      const player = connect();
      say('initialDelivery', { playerState: 2, currentTime: 2, duration: 100 });
      posted.length = 0;
      player.rewind(4.5);
      expect(commands()[0]!.args).toEqual([0, true]);
    });

    it('is connected while the frame is in the page and the player in use', () => {
      const player = connect();
      expect(player.clock.isConnected).toBe(true);
      frame.remove();
      expect(player.clock.isConnected).toBe(false);
      document.body.append(frame);
      player.destroy();
      expect(player.clock.isConnected).toBe(false);
    });
  });

  it('hears nothing more once its frame is out of the page, destroyed yet or not', () => {
    connect();
    frame.remove();
    // jsdom leaves the removed frame its window; a browser doesn't, and a message without a source has none either.
    say('onStateChange', 1);
    say('onStateChange', 1, { source: null });
    expect(statuses).toEqual([]);
  });

  it('hears nothing more once destroyed', () => {
    const player = connect();
    frame.dispatchEvent(new Event('load'));
    player.destroy();
    posted.length = 0;
    vi.advanceTimersByTime(5000);
    say('onStateChange', 1);
    frame.dispatchEvent(new Event('load'));
    expect(posted).toEqual([]);
    expect(statuses).toEqual([]);
  });
});
