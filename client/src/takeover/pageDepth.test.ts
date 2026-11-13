import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onNavigate } from './navigation';
import { pageDepth, trackPageDepth } from './pageDepth';

const HOME = '#/home';
const MOVIE = '#/details?id=11111111111111111111111111111111';
const ACTOR = '#/details?id=22222222222222222222222222222222';
const OTHER = '#/details?id=33333333333333333333333333333333&serverId=s1';
const CATALOG = '#/home?title=movie-603';
const VIDEO = '#/video';

let stop: () => void = () => undefined;

/** A link or `location.hash = …`: a new entry with no state, and the events a browser fires for it (jsdom fires none). */
function go(hash: string): void {
  History.prototype.pushState.call(history, null, '', hash);
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** jsdom walks its session history on a later task, then fires popstate. */
async function travel(delta: number): Promise<void> {
  const landed = new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
  history.go(delta);
  await landed;
}

/** A page load on the entry the browser is on: a reload, or a tab opened on a link. */
function load(): void {
  stop();
  stop = trackPageDepth(window);
}

beforeEach(() => {
  // A fresh entry on home for each test: nothing ahead of it, and no stamp on it.
  History.prototype.pushState.call(history, null, '', HOME);
  load();
});
afterEach(() => stop());

describe('page depth', () => {
  it('counts the sub-pages opened one from another: home → movie is 1, → actor 2, → another title 3', () => {
    expect(pageDepth()).toBe(0);
    go(MOVIE);
    expect(pageDepth()).toBe(1);
    go(ACTOR);
    expect(pageDepth()).toBe(2);
    go(CATALOG);
    expect(pageDepth()).toBe(3);
  });

  it('goes down again with Back, and up with Forward', async () => {
    go(MOVIE);
    go(ACTOR);
    go(OTHER);

    await travel(-1);
    expect(pageDepth()).toBe(2);
    await travel(-1);
    expect(pageDepth()).toBe(1);
    await travel(1);
    expect(pageDepth()).toBe(2);
    await travel(-2);
    expect(pageDepth()).toBe(0);
    await travel(3);
    expect(pageDepth()).toBe(3);
  });

  it('counts on from where Back left off, not from the deepest page seen', async () => {
    go(MOVIE);
    go(ACTOR);
    go(OTHER);
    await travel(-2);
    expect(pageDepth()).toBe(1);

    go(CATALOG);
    expect(pageDepth()).toBe(2);
  });

  it.each([
    ['home', HOME],
    ['a library', '#/movies?topParentId=44444444444444444444444444444444'],
    ['a library tab', '#/tv?topParentId=44444444444444444444444444444444&tab=3'],
    ['Favorites', '#/home?tab=1'],
    ['a genre', '#/list?genreId=55555555555555555555555555555555'],
    ['search', '#/search?query=alpha'],
    ['the profile page', '#/mypreferencesmenu'],
    ['a settings page', '#/mypreferencesdisplay'],
    ['My requests', '#/home?lumen=requests'],
    ['History', '#/home?lumen=history'],
    ['Top charts', '#/home?lumen=charts&chart=movies&period=weekly'],
    ['a page of jellyfin-web’s own', '#/dashboard'],
  ])('starts again from %s', (_name, hash) => {
    go(MOVIE);
    go(ACTOR);
    expect(pageDepth()).toBe(2);

    go(hash);
    expect(pageDepth()).toBe(0);
    go(OTHER);
    expect(pageDepth()).toBe(1);
  });

  it('is 1 on a sub-page opened from a link, a library title or a catalog one', () => {
    go(MOVIE);
    History.prototype.replaceState.call(history, null, '');
    load();
    expect(pageDepth()).toBe(1);

    History.prototype.pushState.call(history, null, '', CATALOG);
    load();
    expect(pageDepth()).toBe(1);
  });

  it('keeps the depth through a reload, and the history’s other entries theirs', async () => {
    go(MOVIE);
    go(ACTOR);
    go(OTHER);
    await travel(-1);

    load();
    expect(pageDepth()).toBe(2);
    await travel(-1);
    expect(pageDepth()).toBe(1);
    await travel(2);
    expect(pageDepth()).toBe(3);
  });

  it('leaves the player out: it plays over the page that started it', async () => {
    go(MOVIE);
    // jellyfin-web opens the player with its router, and goes back when playback ends.
    history.pushState({ usr: null, key: 'p1', idx: 5 }, '', VIDEO);
    expect(pageDepth()).toBe(1);
    await travel(-1);
    expect(pageDepth()).toBe(1);

    // A reload on the player lands on nothing deeper either, and the page behind it is where it was.
    go(ACTOR);
    history.pushState({ usr: null, key: 'p2', idx: 7 }, '', VIDEO);
    load();
    expect(pageDepth()).toBe(0);
    await travel(-1);
    expect(pageDepth()).toBe(2);
  });

  it('isn’t deeper for an entry jellyfin-web adds for the same page (a dialog), or replaces', async () => {
    go(MOVIE);
    go(ACTOR);
    // dialogHelper pushes the page again with the dialog in its state, and may replace that entry as it closes.
    history.pushState({ usr: { dialogs: ['dlg1'] }, key: 'k1', idx: 3 }, '', ACTOR);
    expect(pageDepth()).toBe(2);
    history.replaceState({ usr: { dialogs: [] }, key: 'k2', idx: 3 }, '', ACTOR);
    expect(pageDepth()).toBe(2);

    // A reload with the dialog's entry current still knows.
    load();
    expect(pageDepth()).toBe(2);
    await travel(-1);
    expect(pageDepth()).toBe(2);
    await travel(-1);
    expect(pageDepth()).toBe(1);
  });

  it('isn’t deeper for a sub-page replaced with another', async () => {
    go(MOVIE);
    history.pushState({ usr: null, key: 'k1', idx: 2 }, '', ACTOR);
    expect(pageDepth()).toBe(2);
    // react-router's navigate(…, { replace: true }): a fresh state (new key, same idx), so no stamp to find.
    history.replaceState({ usr: null, key: 'k2', idx: 2 }, '', OTHER);
    expect(pageDepth()).toBe(2);
    expect(history.state).toEqual({ usr: null, key: 'k2', idx: 2, lmnDepth: 2 });
    // And again: still no deeper.
    history.replaceState({ usr: null, key: 'k3', idx: 2 }, '', CATALOG);
    expect(pageDepth()).toBe(2);

    // A page that isn't a sub-page replaced with one is 1 (as a new entry from it would be), and Back still steps down.
    await travel(-1);
    expect(pageDepth()).toBe(1);
    go(HOME);
    history.replaceState({ usr: null, key: 'k4', idx: 3 }, '', ACTOR);
    expect(pageDepth()).toBe(1);
  });

  it('adds its stamp to the router’s state without touching what’s there, or telling anyone', () => {
    const navigated = vi.fn();
    const stopListening = onNavigate(navigated);
    const pushed = vi.spyOn(history, 'pushState');
    const replaced = vi.spyOn(history, 'replaceState');
    const usr = { dialogs: [] };

    // jellyfin-web's router (react-router's hash history) keeps usr, key and idx in the entry's state.
    history.pushState({ usr, key: 'abc123', idx: 4 }, '', MOVIE);

    expect(history.state).toEqual({ usr, key: 'abc123', idx: 4, lmnDepth: 1 });
    expect(window.location.hash).toBe(MOVIE);
    // The navigation itself, once; the stamp went past the wrapped methods, so nothing heard of it.
    expect(navigated).toHaveBeenCalledTimes(1);
    expect(pushed).toHaveBeenCalledTimes(1);
    expect(replaced).not.toHaveBeenCalled();

    // An entry made by a link has no state: the stamp is all of it, with react-router's idx left reading null (its push
    // counts getIndex() + 1, which a missing idx would make NaN).
    go(ACTOR);
    expect(history.state).toEqual({ idx: null, lmnDepth: 2 });
    // The pages that aren't sub-pages are left as they are.
    go(HOME);
    expect(history.state).toBeNull();
    stopListening();
  });

  it('holds the depth when the state can’t take a stamp, or the browser refuses it', () => {
    go(MOVIE);
    // A state that isn't an object (nothing of jellyfin-web's, but the history is the page's to share).
    history.pushState('opaque', '', ACTOR);
    expect(pageDepth()).toBe(2);
    expect(history.state).toBe('opaque');

    // Safari throws after 100 history changes in 30 seconds.
    const refused = vi.spyOn(History.prototype, 'replaceState').mockImplementation(() => {
      throw new DOMException('too many calls', 'SecurityError');
    });
    go(OTHER);
    expect(pageDepth()).toBe(3);
    refused.mockRestore();
  });

  it('stops following when told to', () => {
    go(MOVIE);
    stop();
    go(ACTOR);
    expect(pageDepth()).toBe(1);
  });
});
