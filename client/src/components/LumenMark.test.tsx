import { render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { MARK_SVG } from '../brand/mark';
import { LumenMark } from './LumenMark';

describe('LumenMark', () => {
  it('renders the one J mark, hidden from assistive tech', () => {
    const { container } = render(<LumenMark class="x" />);
    const mark = container.querySelector('.lmn-mark.x')!;
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(mark.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 64 64');
    expect(mark.querySelector('#lmnJShade')).not.toBeNull();
    expect(MARK_SVG).toContain('lmnJShade');
  });
});
