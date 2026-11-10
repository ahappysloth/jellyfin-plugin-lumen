import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import detailsCss from '../../styles/details.css?raw';
import { EpisodeList } from './EpisodeList';

const episodes = [1, 2].map((n) => ({ Id: `e${n}`, Name: `Episode ${n}`, Type: 'Episode', IndexNumber: n }));

/** The declarations of `selector`'s rules outside any @media block. */
function topLevelRules(css: string, selector: string): string[] {
  const outside = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  const rules: string[] = [];
  for (const match of outside.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1]!.split(',').some((s) => s.trim() === selector)) rules.push(match[2]!);
  }
  return rules;
}

describe('EpisodeList', () => {
  it('plays a row and links to its episode page', () => {
    const onPlay = vi.fn();
    render(
      <EpisodeList
        episodes={episodes}
        client={createFakeClient()}
        onPlay={onPlay}
        detailsHref={(e) => `#/details?id=${e.Id}`}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Episode 2/ }));
    expect(onPlay).toHaveBeenCalledWith(episodes[1]);
    expect(screen.getByRole('link', { name: 'Details for Episode 2' })).toHaveAttribute(
      'href',
      '#/details?id=e2',
    );
  });

  // jellyfin-web's D-pad (focusManager.nav) moves right only to an element whose right edge is past the focused one's.
  // Laid over the full-width row button, the details link never was, so a TV remote couldn't reach it.
  it('puts the details link beside the row button, where D-pad Right reaches it', () => {
    render(
      <EpisodeList
        episodes={episodes}
        client={createFakeClient()}
        onPlay={vi.fn()}
        detailsHref={(e) => `#/details?id=${e.Id}`}
      />,
    );
    const link = screen.getByRole('link', { name: 'Details for Episode 1' });
    const row = screen.getByRole('button', { name: /Episode 1/ });
    expect(row.contains(link)).toBe(false);
    expect(row.nextElementSibling).toBe(link);

    // Outside the phone layout, neither is positioned over the other: they sit side by side in the row.
    const item = topLevelRules(detailsCss, '.lmn-episodes__item').join(';');
    expect(item).toMatch(/display:\s*flex/);
    for (const selector of ['.lmn-episodes__details', '.lmn-episode']) {
      expect(topLevelRules(detailsCss, selector).join(';')).not.toMatch(/position:\s*absolute|width:\s*100%/);
    }
  });
});
