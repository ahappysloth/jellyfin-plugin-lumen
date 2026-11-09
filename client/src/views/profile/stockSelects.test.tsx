import { act, fireEvent, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enhanceStockSelects } from './stockSelects';

function stockPage(): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = `
    <div class="selectContainer"><div>
      <label class="selectLabel" for="selectQuality">Home network quality</label>
      <select is="emby-select" id="selectQuality" class="emby-select">
        <option value="auto">Auto</option>
        <option value="8">8 Mbps</option>
        <option value="4">4 Mbps</option>
      </select>
      <div class="selectArrowContainer"></div>
    </div></div>`;
  document.body.appendChild(root);
  return root;
}

describe('enhanceStockSelects', () => {
  let undo: () => void = () => undefined;
  afterEach(() => {
    act(() => undo());
    document.body.innerHTML = '';
  });

  it("drives the stock select from Lumen's dropdown, firing the change jellyfin-web listens for", () => {
    const root = stockPage();
    const select = root.querySelector('select')!;
    const onChange = vi.fn();
    select.addEventListener('change', onChange);
    act(() => {
      undo = enhanceStockSelects(root);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Home network quality: Auto' }));
    fireEvent.click(screen.getByRole('option', { name: '8 Mbps' }));

    expect(select.value).toBe('8');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(select.classList.contains('lmn-hidden-select')).toBe(true);
  });

  it('follows values jellyfin-web sets from script, and selects rendered later', async () => {
    const root = stockPage();
    act(() => {
      undo = enhanceStockSelects(root);
    });

    act(() => {
      root.querySelector('select')!.value = '4';
    });
    expect(screen.getByRole('button', { name: 'Home network quality: 4 Mbps' })).toBeInTheDocument();

    const later = document.createElement('div');
    later.innerHTML =
      '<select class="emby-select" aria-label="Skip forward"><option value="30">30 seconds</option></select>';
    await act(async () => {
      root.appendChild(later);
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'Skip forward: 30 seconds' })).toBeInTheDocument();
  });

  it('restores the stock select when undone', () => {
    const root = stockPage();
    act(() => {
      undo = enhanceStockSelects(root);
    });
    act(() => undo());
    undo = () => undefined;

    expect(root.querySelector('.lmn-stock-select')).toBeNull();
    expect(root.querySelector('select')!.classList.contains('lmn-hidden-select')).toBe(false);
  });
});
