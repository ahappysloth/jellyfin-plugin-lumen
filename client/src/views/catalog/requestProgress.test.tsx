import { act, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient, type FakeClient } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import { myRequest } from '../../../test/myRequest';
import type { MyRequests } from '../../api/types';
import type { AjaxRequest } from '../../compat/jellyfin';
import { ToastHost } from '../../components/Toast';
import {
  FAST_MS,
  MAX_RETRY_MS,
  NORMAL_MS,
  RETRY_MS,
  progressDetail,
  refreshIfOlder,
  refreshRequestProgress,
  reset,
  retryDelay,
  secondsLeft,
  startRequestProgress,
  useMyRequests,
  usePollFast,
  useRequestProgress,
} from './requestProgress';

let answers: (MyRequests | { status: number })[];
let client: FakeClient;
/** When each GET /Lumen/Requests/Mine was made (Date.now(), faked). */
let mineTimes: number[];
const mineCalls = (): AjaxRequest[] => client.requests.filter((r) => r.url.includes('Lumen/Requests/Mine'));
/** The time between one check and the next. */
const spacing = (): number[] => mineTimes.slice(1).map((t, i) => t - mineTimes[i]!);
const announcedCalls = (): AjaxRequest[] =>
  client.requests.filter((r) => r.url.includes('Lumen/Requests/Announced'));

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function start(): ReturnType<typeof makeContext> {
  const ctx = makeContext(client);
  startRequestProgress(ctx);
  return ctx;
}

beforeEach(() => {
  vi.useFakeTimers();
  answers = [];
  mineTimes = [];
  client = createFakeClient((request) => {
    if (request.url.includes('Lumen/Requests/Mine')) {
      mineTimes.push(Date.now());
      const answer = answers.length > 1 ? answers.shift()! : answers[0];
      return answer && 'status' in answer ? Promise.reject(answer) : answer;
    }
    return undefined;
  });
});

afterEach(() => {
  reset();
  setHidden(false);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('request progress', () => {
  it('checks once the page is idle, and never again with nothing in flight', async () => {
    answers = [{ Requests: [myRequest({ Status: 'Ready', Percent: null, SecondsLeft: null })] }];
    start();
    expect(mineCalls()).toHaveLength(0);

    await advance(1000);
    expect(mineCalls()).toHaveLength(1);
    await advance(10 * NORMAL_MS);
    expect(mineCalls()).toHaveLength(1);
  });

  it('follows a request in flight every 45 s while the page is visible', async () => {
    answers = [{ Requests: [myRequest()] }];
    start();
    await advance(1000);
    await advance(NORMAL_MS);
    expect(mineCalls()).toHaveLength(2);

    setHidden(true);
    await advance(5 * NORMAL_MS);
    expect(mineCalls()).toHaveLength(2);

    // Overdue by then: checked as soon as the page shows again.
    setHidden(false);
    await advance(0);
    expect(mineCalls()).toHaveLength(3);
  });

  it('checks every 10 s while a page shows a download in progress', async () => {
    answers = [{ Requests: [myRequest()] }];
    function Page() {
      usePollFast(true);
      return null;
    }
    start();
    await advance(1000);
    const { unmount } = render(<Page />);
    await advance(FAST_MS);
    await advance(FAST_MS);
    expect(mineCalls()).toHaveLength(3);

    unmount();
    await advance(FAST_MS);
    expect(mineCalls()).toHaveLength(3);
  });

  it('keeps the fast pace working after a sign-out while a title page was open', async () => {
    answers = [{ Requests: [myRequest()] }];
    function Page() {
      usePollFast(true);
      return null;
    }
    start();
    await advance(1000);
    const first = render(<Page />);
    reset();
    start();
    await advance(1000);
    first.unmount();
    await advance(0);
    expect(mineCalls()).toHaveLength(2);

    const second = render(<Page />);
    await advance(FAST_MS);
    expect(mineCalls()).toHaveLength(3);
    second.unmount();
    await advance(100); // Preact cleans an unmounted page's effects up after the next frame
  });

  it('stays at the normal pace for a fast page when nothing is downloading', async () => {
    answers = [{ Requests: [myRequest({ Status: 'Requested', Percent: null, SecondsLeft: null })] }];
    function Page() {
      usePollFast(true);
      return null;
    }
    start();
    await advance(1000);
    const { unmount } = render(<Page />);
    await advance(FAST_MS * 2);
    expect(mineCalls()).toHaveLength(1);
    await advance(NORMAL_MS);
    expect(mineCalls()).toHaveLength(2);
    unmount();
    await advance(100); // Preact cleans an unmounted page's effects up after the next frame
  });

  it('keeps the first check and its answer when the user moves on to another page meanwhile', async () => {
    let answer: (value: MyRequests) => void = () => undefined;
    client.respond = (request) =>
      request.url.includes('Lumen/Requests/Mine')
        ? new Promise<MyRequests>((resolve) => (answer = resolve))
        : undefined;
    start();
    // Each page brings a context of its own, for the same user.
    startRequestProgress(makeContext(client));
    await advance(1000);
    expect(mineCalls()).toHaveLength(1);

    startRequestProgress(makeContext(client));
    let seen: ReturnType<typeof useMyRequests> | null = null;
    function List() {
      seen = useMyRequests();
      return null;
    }
    render(<List />);
    answer({ Requests: [myRequest()] });
    await advance(0);
    expect(seen!.requests).toHaveLength(1);
  });

  it('drops an answer for the user signed in before', async () => {
    let answer: (value: MyRequests) => void = () => undefined;
    client.respond = (request) =>
      request.url.includes('Lumen/Requests/Mine')
        ? new Promise<MyRequests>((resolve) => (answer = resolve))
        : undefined;
    start();
    await advance(1000);
    startRequestProgress(makeContext(createFakeClient(() => new Promise(() => undefined), 'user2')));
    let seen: ReturnType<typeof useMyRequests> | null = null;
    function List() {
      seen = useMyRequests();
      return null;
    }
    render(<List />);
    answer({ Requests: [myRequest()] });
    await advance(0);
    expect(seen!.requests).toBeNull();
  });

  it('stops for good when the user has no request features (404)', async () => {
    answers = [{ status: 404 }];
    start();
    await advance(1000);
    await refreshRequestProgress();
    await advance(10 * NORMAL_MS);

    expect(mineCalls()).toHaveLength(1);
  });

  it('tries a failed first check again, later each time, without giving up (Seerr may still be starting)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    answers = [{ status: 502 }];
    start();
    await advance(1000);
    await advance(30 * 60_000);

    expect(spacing().slice(0, 6)).toEqual([
      RETRY_MS,
      2 * RETRY_MS,
      4 * RETRY_MS,
      8 * RETRY_MS,
      16 * RETRY_MS,
      MAX_RETRY_MS,
    ]);
    expect(mineCalls().length).toBeLessThan(15);
  });

  it('backs off when checks fail after an answer, instead of asking again at once', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    answers = [{ Requests: [myRequest()] }, { status: 503 }];
    start();
    await advance(1000);
    await advance(NORMAL_MS);
    expect(mineCalls()).toHaveLength(2); // the failed one

    // Nothing more in the next moments (it used to ask again with no wait, over and over).
    await advance(RETRY_MS - 1);
    expect(mineCalls()).toHaveLength(2);

    await advance(30 * 60_000);
    expect(spacing().slice(0, 7)).toEqual([
      NORMAL_MS,
      RETRY_MS,
      2 * RETRY_MS,
      4 * RETRY_MS,
      8 * RETRY_MS,
      16 * RETRY_MS,
      MAX_RETRY_MS,
    ]);
    // Then every 5 minutes at most: 7 checks in the last half hour, not one per round trip.
    expect(spacing().slice(6)).toEqual(Array(spacing().length - 6).fill(MAX_RETRY_MS));
    expect(mineCalls()).toHaveLength(11);
  });

  it('keeps backing off while the page is hidden and shown again', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    answers = [{ Requests: [myRequest()] }, { status: 503 }];
    start();
    await advance(1000);
    await advance(NORMAL_MS);
    setHidden(true);
    setHidden(false);
    await advance(RETRY_MS - 1);

    expect(mineCalls()).toHaveLength(2);
  });

  it('goes back to the normal pace once a check works again, and starts the back-off over', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    answers = [
      { Requests: [myRequest()] },
      { status: 503 },
      { status: 503 },
      { Requests: [myRequest()] },
      { Requests: [myRequest()] },
      { status: 503 },
      { Requests: [myRequest()] },
    ];
    start();
    await advance(1000);
    await advance(10 * NORMAL_MS);

    expect(spacing().slice(0, 6)).toEqual([
      NORMAL_MS,
      RETRY_MS,
      2 * RETRY_MS,
      NORMAL_MS,
      NORMAL_MS,
      RETRY_MS,
    ]);
  });

  it('spreads the retries out, so tabs that saw the same outage come back at different times', () => {
    expect(retryDelay(1, 0)).toBe(RETRY_MS / 2);
    expect(retryDelay(1, 1)).toBe(RETRY_MS);
    expect(retryDelay(3, 0.5)).toBe(3 * RETRY_MS);
    expect(retryDelay(20, 0)).toBe(MAX_RETRY_MS / 2);
    expect(retryDelay(20, 1)).toBe(MAX_RETRY_MS);
  });

  it('waits out a back-off when My requests asks for fresh progress', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    answers = [{ Requests: [myRequest()] }, { status: 503 }];
    start();
    await advance(1000);
    await advance(NORMAL_MS);
    refreshIfOlder(FAST_MS);
    await advance(0);

    expect(mineCalls()).toHaveLength(2);
  });

  it('checks at once when the user files a request', async () => {
    answers = [{ Requests: [] }];
    start();
    await advance(1000);
    await act(() => refreshRequestProgress());

    expect(mineCalls()).toHaveLength(2);
  });

  it('pops up once when a request is ready, and tells the server', async () => {
    const ready = myRequest({
      Status: 'Ready',
      Announce: true,
      RequestIds: [7],
      Item: { ...myRequest().Item, JellyfinItemId: 'abc' },
    });
    answers = [{ Requests: [ready] }];
    render(<ToastHost />);
    const ctx = start();
    await advance(1000);

    expect(screen.getByRole('alert')).toHaveTextContent('The Matrix is ready to watch');
    expect(announcedCalls()).toHaveLength(1);
    expect(JSON.parse(announcedCalls()[0]!.data as string)).toEqual({ RequestIds: [7] });

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(ctx.navigate).toHaveBeenCalledWith('#/details?id=abc');

    // The server still says so (another device's check raced this one's): not again here.
    await act(() => refreshRequestProgress());
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
    expect(announcedCalls()).toHaveLength(1);
  });

  it('pops up when the page shows again, for a request that became ready while it was hidden', async () => {
    let answer: (value: MyRequests) => void = () => undefined;
    client.respond = (request) =>
      request.url.includes('Lumen/Requests/Mine')
        ? new Promise<MyRequests>((resolve) => (answer = resolve))
        : undefined;
    render(<ToastHost />);
    start();
    await advance(1000);
    setHidden(true);
    answer({ Requests: [myRequest({ Status: 'Ready', Announce: true, RequestIds: [7] })] });
    await advance(0);
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();

    // Nothing in flight, so no further check: the answer it has is enough.
    await act(async () => setHidden(false));
    expect(screen.getByRole('alert')).toHaveTextContent('The Matrix is ready to watch');
    expect(announcedCalls()).toHaveLength(1);

    await act(async () => {
      setHidden(true);
      setHidden(false);
    });
    expect(announcedCalls()).toHaveLength(1);
  });

  it('keeps the pop-up for the next Lumen page when a request becomes ready on one of jellyfin-web’s', async () => {
    answers = [
      { Requests: [myRequest()] },
      { Requests: [myRequest({ Status: 'Ready', Announce: true, RequestIds: [7] })] },
    ];
    const lumenPage = render(<ToastHost />);
    start();
    await advance(1000);
    // The Dashboard, a music library: Lumen's page (and its pop-ups' host) is unmounted, the checks go on.
    lumenPage.unmount();
    await advance(NORMAL_MS);
    expect(mineCalls()).toHaveLength(2);
    // Nothing could show it, so the server isn't told it was shown (the user's other devices still may).
    expect(announcedCalls()).toHaveLength(0);

    // Back on a Lumen page: shown now, from the answer it has (with nothing in flight there's no further check).
    render(<ToastHost />);
    await advance(0);
    expect(screen.getByRole('alert')).toHaveTextContent('The Matrix is ready to watch');
    expect(announcedCalls()).toHaveLength(1);
    expect(mineCalls()).toHaveLength(2);
  });

  it('sums several ready requests up in one pop-up that opens My requests', async () => {
    answers = [
      {
        Requests: [
          myRequest({ Status: 'Ready', Announce: true }),
          myRequest({ key: 'tv-1399', title: 'Lumen Saga', Status: 'Ready', Announce: true }),
        ],
      },
    ];
    render(<ToastHost />);
    const ctx = start();
    await advance(1000);

    expect(screen.getByRole('alert')).toHaveTextContent('2 of your requests are ready to watch');
    fireEvent.click(screen.getByRole('button', { name: 'My requests' }));
    expect(ctx.navigate).toHaveBeenCalledWith('#/home?lumen=requests');
  });

  it("re-renders a title's subscribers only when its own request changes", async () => {
    const renders: string[] = [];
    function Card({ id }: { id: string }) {
      const progress = useRequestProgress(id);
      renders.push(`${id}:${progress?.Percent ?? '-'}`);
      return null;
    }
    answers = [{ Requests: [myRequest({ Percent: 40 })] }, { Requests: [myRequest({ Percent: 60 })] }];
    render(
      <>
        <Card id="movie-603" />
        <Card id="movie-999" />
      </>,
    );
    start();
    await advance(1000);
    await advance(NORMAL_MS);

    expect(renders).toEqual(['movie-603:-', 'movie-999:-', 'movie-603:40', 'movie-603:60']);
  });

  it('gives My requests the list, and says when there are no request features', async () => {
    let seen: ReturnType<typeof useMyRequests> | null = null;
    function List() {
      seen = useMyRequests();
      return null;
    }
    render(<List />);
    answers = [{ Requests: [myRequest()] }];
    start();
    expect(seen!.requests).toBeNull();
    await advance(1000);
    expect(seen!.requests).toHaveLength(1);
    expect(seen!.available).toBe(true);
  });
});

describe('progress words', () => {
  it('counts the time left down from the last answer', async () => {
    answers = [{ Requests: [myRequest({ SecondsLeft: 600 })] }];
    start();
    await advance(1000);
    const request = myRequest({ SecondsLeft: 600 });

    expect(secondsLeft(request)).toBe(600);
    expect(secondsLeft(request, Date.now() + 61_000)).toBe(539);
    expect(secondsLeft(request, Date.now() + 3600_000)).toBe(0);
    expect(secondsLeft(myRequest({ SecondsLeft: null }))).toBeNull();
  });

  it('says the percentage, the episodes and the time left', () => {
    // As the answer arrived (nothing has arrived since reset: that's at 0).
    const now = 0;
    expect(progressDetail(myRequest({ Percent: 45.7, SecondsLeft: null }), now)).toBe('45%');
    expect(progressDetail(myRequest({ Percent: 45, SecondsLeft: 30 }), now)).toMatch(
      /^45% · Less than a minute left$/,
    );
    expect(progressDetail(myRequest({ Percent: 45, SecondsLeft: 750 }), now)).toMatch(/13 min left$/);
    expect(progressDetail(myRequest({ Percent: 45, SecondsLeft: 3 * 3600 + 600 }), now)).toMatch(
      /3 hr 10 min left$/,
    );
    expect(progressDetail(myRequest({ EpisodesDone: 3, EpisodesTotal: 8, SecondsLeft: null }), now)).toBe(
      '3 of 8 episodes',
    );
    expect(progressDetail(myRequest({ Status: 'Processing' }), now)).toBe('Adding to your library');
    expect(progressDetail(myRequest({ Status: 'Queued', Percent: null }), now)).toBe('');
  });

  it('rounds the time left to whole minutes before splitting it into hours, and counts one day as one', () => {
    const left = (seconds: number): string =>
      progressDetail(myRequest({ Percent: 45, SecondsLeft: seconds }), 0).replace('45% · ', '');
    expect(left(59)).toBe('Less than a minute left');
    expect(left(60)).toBe('1 min left');
    expect(left(3569)).toBe('59 min left');
    // Half a minute short of the hour, of two hours and of a day: never "60 min".
    expect(left(3570)).toBe('1 hr 0 min left');
    expect(left(3600)).toBe('1 hr 0 min left');
    expect(left(7170)).toBe('2 hr 0 min left');
    expect(left(86_399)).toBe('1 day left');
    expect(left(86_400)).toBe('1 day left');
    expect(left(129_000)).toBe('1 day left');
    expect(left(3 * 86_400)).toBe('3 days left');
  });
});
