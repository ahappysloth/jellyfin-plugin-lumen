import type { LumenApi } from '../api/lumenApi';
import type { ClientConfig } from '../api/types';
import type { JellyfinApiClient, Layout } from '../compat/jellyfin';

/** Everything a view needs; created per signed-in user by the bootstrap. */
export interface ViewContext {
  api: LumenApi;
  client: JellyfinApiClient;
  config: ClientConfig;
  userId: string;
  layout: Layout;
  /** Give the current route back to the stock UI (on errors or unsupported items). */
  onFallback: () => void;
  navigate: (hash: string) => void;
}
