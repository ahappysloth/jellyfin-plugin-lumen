import { render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { PLAYER_ICONS } from '../views/player/playerIcons';
import { PROFILE_ICONS } from '../views/profile/profileIcons';
import { defineIcons, Icon } from './icons';

const pathOf = (container: Element) => container.querySelector('svg path')?.getAttribute('d');

describe('Icon', () => {
  it('draws a shared icon by name', () => {
    const { container } = render(<Icon name="close" class="x" size={20} />);
    const svg = container.querySelector('svg.lmn-icon.x')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('width')).toBe('20');
    expect(pathOf(container)).toMatch(/^M6\.4 5 /);
  });

  it("draws an icon from a view's own set", () => {
    const icons = defineIcons({ dot: 'M11 11h2v2h-2Z' });
    const { container } = render(<Icon name={icons.dot} />);
    expect(pathOf(container)).toBe('M11 11h2v2h-2Z');
  });

  it("keeps the player's and the profile pages' icons as path data", () => {
    for (const d of [...Object.values(PLAYER_ICONS), ...Object.values(PROFILE_ICONS)]) {
      expect(d).toMatch(/^[Mm][\d .,\-A-Za-z]+$/);
    }
  });
});
