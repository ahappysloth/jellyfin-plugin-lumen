import { fireEvent, render, screen } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { describe, expect, it, vi } from 'vitest';
import type { AdminApi, LumenConfig } from './adminApi';
import { Top10Settings } from './Top10Settings';

function Harness({ api, initial }: { api: Pick<AdminApi, 'testTrakt'>; initial: Partial<LumenConfig> }) {
  const [config, setConfig] = useState(initial as LumenConfig);
  return (
    <Top10Settings
      api={api as AdminApi}
      config={config}
      update={(patch) => setConfig((c) => ({ ...c, ...patch }))}
    />
  );
}

describe('Top10Settings', () => {
  it('says where the free key comes from and what it is for', () => {
    render(<Harness api={{ testTrakt: vi.fn() }} initial={{}} />);

    const field = screen.getByLabelText('Trakt API key');
    expect(field).toHaveAccessibleDescription(
      /trakt\.tv\/oauth\/applications.*only uses it to fetch the weekly/,
    );
    expect(field).toHaveAttribute('placeholder', 'Paste the Client ID');
    // Nothing to check, and nothing to remove, without a key.
    expect(screen.getByRole('button', { name: 'Check key' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Remove key' })).toBeNull();
  });

  it('checks the typed key and names this week’s top movie', async () => {
    const testTrakt = vi.fn(async () => ({ Ok: true, TopMovie: 'Inception', Error: null }));
    render(<Harness api={{ testTrakt }} initial={{}} />);

    fireEvent.input(screen.getByLabelText('Trakt API key'), { target: { value: 'abc123abc123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check key' }));

    expect(await screen.findByText("Works. This week's most watched movie: Inception")).toBeInTheDocument();
    expect(testTrakt).toHaveBeenCalledWith('abc123abc123');
  });

  it('checks the saved key when the field is blank, and shows Trakt’s error', async () => {
    const testTrakt = vi.fn(async () => ({
      Ok: false,
      TopMovie: null,
      Error: 'Trakt rejected the API key.',
    }));
    render(<Harness api={{ testTrakt }} initial={{ TraktClientIdSet: true }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Check key' }));

    expect(await screen.findByText('Trakt rejected the API key.')).toBeInTheDocument();
    expect(testTrakt).toHaveBeenCalledWith('');
  });

  it('typing a new key after Remove key keeps the new one', () => {
    render(<Harness api={{ testTrakt: vi.fn() }} initial={{ TraktClientIdSet: true }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove key' }));
    expect(screen.getByLabelText('Trakt API key')).toHaveAttribute('placeholder', 'Paste the Client ID');
    fireEvent.input(screen.getByLabelText('Trakt API key'), { target: { value: 'new-key-123' } });

    expect(screen.queryByText('The key will be removed when you save.')).toBeNull();
  });
});
