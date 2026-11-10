import { describe, expect, it } from 'vitest';
import { parseReleaseNotes } from './UpdatesSettings';

describe('release notes', () => {
  it('reads a CHANGELOG entry into headings and whole items', () => {
    const text = [
      '### Added',
      "- Dashboard look: the admin Dashboard takes Lumen's colours,",
      '  type and shapes.',
      '- Check for updates.',
      '',
      '### Fixed',
      '- The scrollbar stays.',
    ].join('\n');

    expect(parseReleaseNotes(text)).toEqual([
      {
        heading: 'Added',
        items: [
          "Dashboard look: the admin Dashboard takes Lumen's colours, type and shapes.",
          'Check for updates.',
        ],
      },
      { heading: 'Fixed', items: ['The scrollbar stays.'] },
    ]);
  });

  it('keeps plain notes without headings or bullets', () => {
    expect(parseReleaseNotes('Faster home page.')).toEqual([{ heading: null, items: ['Faster home page.'] }]);
  });
});
