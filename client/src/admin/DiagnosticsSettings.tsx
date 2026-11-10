import { formatDateTime } from '../util/locale';
import type { DiagnosticEntry } from './adminApi';
import { Card } from './controls';

/** `diagnostics` is null when they couldn't be loaded, which must not read as "no problems". */
export function DiagnosticsSettings({ diagnostics }: { diagnostics: DiagnosticEntry[] | null }) {
  return (
    <Card
      title="Diagnostics"
      intro="Clients where Lumen's compatibility check failed and Jellyfin's own pages were shown."
    >
      {diagnostics === null ? (
        <p class="lmna-empty">Couldn't load the diagnostics. Reload the page to try again.</p>
      ) : diagnostics.length === 0 ? (
        <p class="lmna-empty">No compatibility problems reported.</p>
      ) : (
        <table class="lmna-table lmn-admin__diagnostics">
          <thead>
            <tr>
              <th>Client</th>
              <th>Server</th>
              <th>Failed checks</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {diagnostics.map((d) => (
              <tr key={`${d.Client}-${d.LastSeen}`}>
                <td>{d.Client}</td>
                <td>{d.ServerVersion}</td>
                <td>{d.FailedChecks.join(', ')}</td>
                <td>{formatDateTime(new Date(d.LastSeen))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
