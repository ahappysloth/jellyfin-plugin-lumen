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
  NORMAL_MS,
  progressDetail,
  refreshRequestProgress,
  reset,
  secondsLeft,
  startRequestProgress,
  useMyRequests,
  usePollFast,
  useRequestProgress,
} from './requestProgress';

let answers: (MyRequests | { status: number })[];
let client: FakeClient;
const mineCalls = (): AjaxRequest[] => client.requests.filter((r) => r.url.includes('Lumen/Requests/Mine'));
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
  client = createFakeClient((request) => {
    if (request.url.includes('Lumen/Requests/Mine')) {
      const answer = answers.length > 1 ? answers.shift()! : answers[0];
      return answer && 'status' in answer ? Promise.reject(answer) : answer;
    }
    return undefined;
  });
});

afterEach(() => {
  reset();
  setHidden(false);
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

  it('stays at the normal pace for a fast page when nothing is downloading', async () => {
    answers = [{ Requests: [myRequest({ Status: 'Requested', Percent: null, SecondsLeft: null })] }];
    function Page() {
      usePollFast(true);
      return null;
    }
    start();
    await advance(1000);
    render(<Page />);
    await advance(FAST_MS * 2);
    expect(mineCalls()).toHaveLength(1);
    await advance(NORMAL_MS);
    expect(mineCalls()).toHaveLength(2);
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

  it('tries a failed first check again a couple of times, then stops', async () => {
    answers = [{ status: 502 }];
    start();
    await advance(1000);
    await advance(10 * NORMAL_MS);

    expect(mineCalls()).toHaveLength(3);
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
});
