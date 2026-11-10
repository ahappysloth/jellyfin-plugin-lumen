import { render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import { testConfig } from '../../../test/viewContext';
import type { BaseItem } from '../../api/types';
import { DetailsHeader } from './DetailsHeader';

const movie: BaseItem = { Id: 'm1', Name: 'Lumen Alpha', Type: 'Movie', ImageTags: { Logo: 'l' } };

function renderHeader(overrides: Partial<Parameters<typeof DetailsHeader>[0]> = {}) {
  return render(
    <DetailsHeader
      item={movie}
      client={createFakeClient()}
      config={testConfig}
      primary={null}
      trailerId={null}
      onBack={vi.fn()}
      badges={[]}
      played={false}
      favorite={false}
      error={null}
      toggleWatched={vi.fn()}
      toggleFavorite={vi.fn()}
      {...overrides}
    />,
  );
}

describe('DetailsHeader', () => {
  it('makes the title logo the page heading, named after the title', () => {
    renderHeader();

    const heading = screen.getByRole('heading', { level: 1, name: 'Lumen Alpha' });
    expect(heading).toContainElement(screen.getByRole('img', { name: 'Lumen Alpha' }));
  });
});
