import { useEffect, useRef, useState } from 'preact/hooks';
import type { AdminApi } from '../adminApi';
import { describeDevice, type DeviceRow } from './devices';
import { countProblems, groupChecks, type HealthCheck, type HealthReport } from './healthModel';
import { type ProbeEnv, runBrowserChecks } from './probes';

export interface HealthState {
  /** Loading the first time, or running again. */
  running: boolean;
  report: HealthReport | null;
  /** The server's and the browser's rows, grouped in page order. */
  groups: ReturnType<typeof groupChecks>;
  devices: DeviceRow[];
  /** ❌ rows and devices: the tab's badge. */
  problems: number;
  /** Set when the server's checks couldn't be loaded. */
  failed: string | null;
  /** "Run checks again": nothing kept on the server is reused. */
  rerun: () => void;
  /**
   * Runs the checks again after a save, reset or update: the server has already dropped what it kept from before
   * (HealthService), so its other kept results (Trakt's lists, GitHub's answer) are reused.
   */
  refresh: () => void;
}

/**
 * The Health tab's data: the server's checks, then the browser's. Loaded once when the settings page opens (so the tab
 * can show a badge), again after the settings are saved or reset or an update is installed (so a fix shows at once), and
 * on "Run checks again", which asks the server not to reuse anything.
 */
export function useHealth(api: AdminApi, env: () => ProbeEnv): HealthState {
  const [running, setRunning] = useState(true);
  const [report, setReport] = useState<HealthReport | null>(null);
  const [browser, setBrowser] = useState<HealthCheck[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const run = useRef(0);

  const load = async (fresh: boolean): Promise<void> => {
    const id = ++run.current;
    setRunning(true);
    try {
      const next = await api.getHealth(fresh);
      if (id !== run.current) return;
      setFailed(null);
      const extra = await runBrowserChecks(env(), next);
      if (id !== run.current) return;
      setReport(next);
      setBrowser(extra);
    } catch {
      if (id === run.current) setFailed("Couldn't run the checks. Try again in a moment.");
    } finally {
      if (id === run.current) setRunning(false);
    }
  };

  useEffect(() => {
    void load(false);
  }, []);

  const groups = report ? groupChecks(report.Checks, browser) : [];
  const devices = report ? report.Devices.map(describeDevice) : [];
  return {
    running,
    report,
    groups,
    devices,
    problems:
      countProblems(([] as HealthCheck[]).concat(...groups.map((g) => g.checks))) +
      devices.filter((d) => d.status === 'Problem').length,
    failed,
    rerun: () => void load(true),
    refresh: () => void load(false),
  };
}
