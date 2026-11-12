import { render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { ITEM_MENU_ICONS } from '../views/itemMenu/itemMenuIcons';
import { PLAYER_ICONS } from '../views/player/playerIcons';
import { PROFILE_ICONS } from '../views/profile/profileIcons';
import { SECONDARY_ICONS } from '../views/secondary/secondaryIcons';
import { defineIcons, Icon } from './icons';

const pathOf = (container: Element) => container.querySelector('svg path')?.getAttribute('d');

describe('Icon', () => {
  it('draws a shared icon by name, outlined with a 2-unit round stroke', () => {
    const { container } = render(<Icon name="close" class="x" size={22} />);
    const svg = container.querySelector('svg.lmn-icon.x')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('width')).toBe('22');
    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('stroke-width')).toBe('2');
    expect(svg.getAttribute('stroke-linecap')).toBe('round');
    expect(svg.getAttribute('stroke-linejoin')).toBe('round');
    expect(pathOf(container)).toBe('M18 6 6 18M6 6l12 12');
  });

  it('fills the icons marked so, without the mark', () => {
    for (const name of ['play', 'pause', 'star', 'heartFilled'] as const) {
      const { container } = render(<Icon name={name} />);
      expect(container.querySelector('svg')!.getAttribute('fill')).toBe('currentColor');
      expect(pathOf(container)).toMatch(/^M/);
    }
    const { container } = render(<Icon name="heart" />);
    expect(container.querySelector('svg')!.getAttribute('fill')).toBe('none');
  });

  it('is 20 px unless told otherwise', () => {
    const { container } = render(<Icon name="home" />);
    expect(container.querySelector('svg')!.getAttribute('width')).toBe('20');
  });

  it("draws an icon from a view's own set", () => {
    const icons = defineIcons({ dot: 'M11 11h2v2h-2Z', filledDot: '*M11 11h2v2h-2Z' });
    const { container } = render(<Icon name={icons.dot} />);
    expect(pathOf(container)).toBe('M11 11h2v2h-2Z');
    const filled = render(<Icon name={icons.filledDot} />).container;
    expect(pathOf(filled)).toBe('M11 11h2v2h-2Z');
    expect(filled.querySelector('svg')!.getAttribute('fill')).toBe('currentColor');
  });

  it("keeps the lazy views' icons as path data", () => {
    for (const d of [
      ...Object.values(PLAYER_ICONS),
      ...Object.values(PROFILE_ICONS),
      ...Object.values(ITEM_MENU_ICONS),
      ...Object.values(SECONDARY_ICONS),
    ]) {
      expect(d).toMatch(/^\*?M[\d .,\-A-Za-z]+$/);
    }
  });
});
