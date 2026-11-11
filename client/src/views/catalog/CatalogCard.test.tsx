import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import type { CatalogItem } from '../../api/types';
import { CatalogCard } from './CatalogCard';

const saga: CatalogItem = {
  Key: 'tv-1399',
  MediaType: 'tv',
  TmdbId: 1399,
  Title: 'Lumen Saga',
  Year: 2011,
  GenreNames: [],
  State: 'PartlyAvailable',
};

describe('CatalogCard', () => {
  it('fits "Partly available" on one line as "Partial", keeping the full state in its name', () => {
    render(
      <CatalogCard
        item={saga}
        client={createFakeClient()}
        imageToken="t"
        variant="poster"
        onSelect={() => {}}
      />,
    );

    const card = screen.getByRole('button', { name: 'Lumen Saga, Partly available' });
    expect(card.querySelector('.lmn-card__state')).toHaveTextContent(/^Partial$/);
  });
});
