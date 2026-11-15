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

  describe("a landscape card's title over its art", () => {
    const landscape = (item: CatalogItem, variant: 'landscape' | 'poster' = 'landscape') =>
      render(
        <CatalogCard
          item={{ ...item, Backdrop: 'bd.jpg', Poster: 'p.jpg' }}
          client={createFakeClient()}
          imageToken="t"
          variant={variant}
          onSelect={() => {}}
        />,
      ).container;

    it("lays the title's logo over the backdrop, through the catalog image proxy", () => {
      const card = landscape({ ...saga, Logo: 'logo.png' });

      const logo = card.querySelector<HTMLImageElement>('img.lmn-card__logo')!;
      expect(logo.getAttribute('src')).toBe('http://jf/Lumen/Requests/Image/w300/logo.png?t=t');
      expect(logo).toHaveAttribute('alt', '');
      expect(card.querySelector('.lmn-card__name')).toBeNull();
    });

    it('shows the title as text where it has no logo, hidden from screen readers (the card is named already)', () => {
      const card = landscape(saga);

      const name = card.querySelector('.lmn-card__art .lmn-card__name')!;
      expect(name).toHaveTextContent('Lumen Saga');
      expect(name).toHaveAttribute('aria-hidden', 'true');
      expect(card.querySelector('.lmn-card__logo')).toBeNull();
    });

    it("adds nothing over a landscape card's poster, used when there's no backdrop: it carries its own title", () => {
      const card = render(
        <CatalogCard
          item={{ ...saga, Poster: 'p.jpg', Logo: 'logo.png' }}
          client={createFakeClient()}
          imageToken="t"
          variant="landscape"
          onSelect={() => {}}
        />,
      ).container;

      expect(card.querySelector('.lmn-card__logo')).toBeNull();
      expect(card.querySelector('.lmn-card__name')).toBeNull();
    });

    it('leaves a poster as it is: it carries its own title', () => {
      const card = landscape({ ...saga, Logo: 'logo.png' }, 'poster');

      expect(card.querySelector('.lmn-card__logo')).toBeNull();
      expect(card.querySelector('.lmn-card__name')).toBeNull();
    });
  });
});
