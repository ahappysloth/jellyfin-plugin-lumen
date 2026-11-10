import { act, render, screen, waitFor } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../test/fakeClient';
import { makeContext } from '../../test/viewContext';
import type { Layout } from '../compat/jellyfin';
import { resetSessionCaches } from '../util/sessionCaches';
import { usePageChange } from './usePageChange';

const client = createFakeClient();
client.getPublicSystemInfo = async () => ({ ServerName: 'Den' });

function Page({
  id,
  heading,
  layout = 'desktop',
  field = false,
}: {
  id: string;
  heading?: preact.ComponentChildren;
  layout?: Layout;
  field?: boolean;
}) {
  const main = useRef<HTMLElement>(null);
  usePageChange(main, id, 'Search', makeContext(client, { layout }));
  return (
    <>
      <a href="#/home">Home</a>
      <main ref={main} tabIndex={-1}>
        {heading !== undefined && <h1>{heading}</h1>}
        {/* Like the search page, which focuses its field. */}
        {field && <input aria-label="Search" ref={(el) => el?.focus()} />}
      </main>
    </>
  );
}

describe('usePageChange', () => {
  afterEach(() => {
    resetSessionCaches();
    vi.useRealTimers();
    document.title = '';
  });

  it("names the tab after the page's heading and the server, keeping it while jellyfin-web sets its own", async () => {
    document.title = 'Den';
    const { unmount } = render(<Page id="a" heading="Lumen Alpha" />);
    await waitFor(() => expect(document.title).toBe('Lumen Alpha – Den'));

    document.title = 'Movies'; // jellyfin-web's hidden page
    await waitFor(() => expect(document.title).toBe('Lumen Alpha – Den'));
    // Giving the page back restores jellyfin-web's title.
    act(() => {
      unmount();
    });
    expect(document.title).toBe('Movies');
  });

  it("names a page whose heading is a logo after the logo's text, and one without a heading after its kind", async () => {
    const { rerender } = render(<Page id="a" heading={<img src="x" alt="Lumen Beta" />} />);
    await waitFor(() => expect(document.title).toBe('Lumen Beta – Den'));
    rerender(<Page id="b" />);
    await waitFor(() => expect(document.title).toBe('Search – Den'));
  });

  it('leaves focus alone on the first page, and moves it to the heading of the next', async () => {
    const { rerender } = render(<Page id="a" heading="Home" />);
    const link = screen.getByRole('link', { name: 'Home' });
    link.focus();
    await act(() => new Promise((r) => setTimeout(r, 10)));
    expect(link).toHaveFocus();

    rerender(<Page id="b" heading="Lumen Alpha" />);
    expect(screen.getByRole('heading', { name: 'Lumen Alpha' })).toHaveFocus();
  });

  it('waits for a heading that needs data, then focuses it', async () => {
    const { rerender } = render(<Page id="a" heading="Home" />);
    rerender(<Page id="b" />);
    expect(document.body).toHaveFocus();
    rerender(<Page id="b" heading="Lumen Alpha" />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Lumen Alpha' })).toHaveFocus());
  });

  it('focuses the main content when no heading turns up', () => {
    vi.useFakeTimers();
    const { rerender } = render(<Page id="a" heading="Home" />);
    rerender(<Page id="b" />);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('keeps focus the page put somewhere itself (the search field)', () => {
    const { rerender } = render(<Page id="a" heading="Home" />);
    rerender(<Page id="b" heading="Search" field />);
    expect(screen.getByRole('textbox', { name: 'Search' })).toHaveFocus();
  });

  it('leaves focus to the views in the TV layout (they focus their primary action)', () => {
    const { rerender } = render(<Page id="a" heading="Home" layout="tv" />);
    const link = screen.getByRole('link', { name: 'Home' });
    link.focus();
    rerender(<Page id="b" heading="Lumen Alpha" layout="tv" />);
    expect(link).toHaveFocus();
  });
});
