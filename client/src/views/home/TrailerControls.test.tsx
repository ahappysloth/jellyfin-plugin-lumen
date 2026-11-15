import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MuteButton } from './TrailerControls';

describe('MuteButton', () => {
  afterEach(cleanup);

  it('names and draws what pressing it does, and says the other state', () => {
    const onChange = vi.fn();
    const { rerender } = render(<MuteButton muted onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Unmute trailer' }));
    expect(onChange).toHaveBeenCalledWith(false);

    rerender(<MuteButton muted={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mute trailer' }));
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it('hands focus to the control before it (Pause) when it goes while focused, not to the page', () => {
    const Controls = ({ mute }: { mute: boolean }) => (
      <div>
        <button type="button">Pause</button>
        {mute && <MuteButton muted onChange={vi.fn()} />}
      </div>
    );
    const { rerender } = render(<Controls mute />);
    screen.getByRole('button', { name: 'Unmute trailer' }).focus();

    rerender(<Controls mute={false} />);

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Pause' }));
  });

  it("hands focus to Pause after it too (the banner's order on a wide screen)", () => {
    const Controls = ({ mute }: { mute: boolean }) => (
      <div>
        <div role="tablist" />
        {mute && <MuteButton muted onChange={vi.fn()} />}
        <button type="button">Pause</button>
      </div>
    );
    const { rerender } = render(<Controls mute />);
    screen.getByRole('button', { name: 'Unmute trailer' }).focus();

    rerender(<Controls mute={false} />);

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Pause' }));
  });

  it('leaves focus alone when it goes without it', () => {
    const Controls = ({ mute }: { mute: boolean }) => (
      <div>
        <button type="button">Pause</button>
        {mute && <MuteButton muted onChange={vi.fn()} />}
        <button type="button">Other</button>
      </div>
    );
    const { rerender } = render(<Controls mute />);
    screen.getByRole('button', { name: 'Other' }).focus();

    rerender(<Controls mute={false} />);

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Other' }));
  });
});
