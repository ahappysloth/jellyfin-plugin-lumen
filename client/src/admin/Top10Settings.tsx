import { useState } from 'preact/hooks';
import type { AdminApi, LumenConfig, TraktTestResult } from './adminApi';
import { Card, Field, inputValue } from './controls';
import { NO_PASSWORD_MANAGER } from './RequestsSettings';

/**
 * The Trakt key behind the Top 10 rows, Top charts and the other Trakt rows (Trakt design note, 2026-11-12). Like
 * Seerr's, it's write-only: the server only says whether one is saved, a blank field keeps it, and Remove key clears it
 * on the next save.
 */
export function Top10Settings({
  api,
  config,
  update,
}: {
  api: AdminApi;
  config: LumenConfig;
  update: (patch: Partial<LumenConfig>) => void;
}) {
  const [test, setTest] = useState<TraktTestResult | 'testing' | null>(null);
  const saved = !!config.TraktClientIdSet && !config.ClearTraktClientId;
  const typed = config.TraktClientId ?? '';

  const runTest = async (): Promise<void> => {
    setTest('testing');
    try {
      setTest(await api.testTrakt(typed));
    } catch {
      setTest({ Ok: false, TopMovie: null, Error: 'The check failed. Check the server log.' });
    }
  };
  const tested = test && test !== 'testing' ? test : null;

  return (
    <Card
      title="Trakt"
      intro="With a Trakt key, Lumen adds a Top charts page (Trakt's most watched movies and shows of the week, month, year or all time, linked from the Top 10 rows) and these home sections: Top 10 Movies and Shows, Box Office, Most Anticipated Movies and Shows, Trending Movies and Shows, and Trakt list (any public list). Add them under Home sections. Without a key, the Top 10 rows rank Seerr's trending titles instead, and the rest stay hidden."
    >
      <Field
        label="Trakt API key"
        hint="A free key: create an app at trakt.tv/oauth/applications and paste its Client ID. Lumen only uses it to read Trakt's public charts and lists, from the server: it never reaches anyone's browser."
      >
        <input
          type="password"
          name="lumen-trakt-client-id"
          autoComplete="new-password"
          spellcheck={false}
          {...NO_PASSWORD_MANAGER}
          placeholder={saved ? 'Saved (leave blank to keep it)' : 'Paste the Client ID'}
          value={typed}
          onInput={(e) => {
            setTest(null);
            update({ TraktClientId: inputValue(e), ClearTraktClientId: false });
          }}
        />
      </Field>
      <div class="lmna-row">
        <button
          type="button"
          class="lmna-btn"
          disabled={test === 'testing' || (!typed && !saved)}
          onClick={() => void runTest()}
        >
          {test === 'testing' ? 'Checking…' : 'Check key'}
        </button>
        {saved && (
          <button
            type="button"
            class="lmna-btn"
            onClick={() => {
              setTest(null);
              update({ TraktClientId: '', ClearTraktClientId: true });
            }}
          >
            Remove key
          </button>
        )}
        {config.ClearTraktClientId && config.TraktClientIdSet && (
          <span role="status" class="lmna-pill">
            The key will be removed when you save.
          </span>
        )}
        {tested && (
          <span role="status" class={`lmna-pill ${tested.Ok ? 'lmna-pill--ok' : 'lmna-pill--error'}`}>
            {tested.Ok
              ? tested.TopMovie
                ? `Works. This week's most watched movie: ${tested.TopMovie}`
                : 'Works.'
              : tested.Error}
          </span>
        )}
      </div>
    </Card>
  );
}
