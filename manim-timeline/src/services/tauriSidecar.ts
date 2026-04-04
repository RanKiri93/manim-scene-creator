/**
 * Tauri sidecar management for measure_server.py.
 *
 * Phase 2: Stub — the server runs standalone.
 * Phase 3: This module will spawn measure_server via Tauri's sidecar API,
 * bind to a random port, health-check, and expose the URL.
 */

import { checkHealth } from './measureClient';

let cachedHealthy = false;

export async function ensureMeasureServer(baseUrl: string): Promise<boolean> {
  if (cachedHealthy) return true;
  cachedHealthy = await checkHealth(baseUrl);
  return cachedHealthy;
}

export function resetHealthCache() {
  cachedHealthy = false;
}
