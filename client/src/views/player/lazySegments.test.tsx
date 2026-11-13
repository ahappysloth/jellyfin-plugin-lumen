import { render } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SegmentsProps } from './SegmentPrompts';

describe('LazySegments', () => {
  afterEach(() => {
    vi.doUnmock('./SegmentPrompts');
    vi.doUnmock('../../util/loadStyles');
    vi.resetModules();
  });
  const props = {} as SegmentsProps;

  it('draws the prompts once their file and stylesheet are in, and nothing until then', async () => {
    vi.resetModules();
    vi.doMock('./SegmentPrompts', () => ({ SegmentPrompts: () => <p>prompts</p> }));
    const fresh = await import('./lazySegments');

    const view = render(<fresh.LazySegments {...props} />);
    expect(view.container).toBeEmptyDOMElement();

    await vi.waitFor(() => expect(view.container).toHaveTextContent('prompts'));
  });

  it("draws nothing when the stylesheet that hides jellyfin-web's prompts can't load, and asks again next time", async () => {
    vi.resetModules();
    vi.doMock('./SegmentPrompts', () => ({ SegmentPrompts: () => <p>prompts</p> }));
    const loadStyles = vi.fn((): Promise<void> => Promise.reject(new Error("couldn't load")));
    vi.doMock('../../util/loadStyles', () => ({ loadStyles }));
    const fresh = await import('./lazySegments');

    const view = render(<fresh.LazySegments {...props} />);
    await expect(fresh.loadSegments()).rejects.toThrow();
    expect(view.container).toBeEmptyDOMElement();

    loadStyles.mockImplementation(() => Promise.resolve());
    await expect(fresh.loadSegments()).resolves.toBeDefined();
    expect(loadStyles).toHaveBeenCalledWith('lumen-segments.css');
  });
});
