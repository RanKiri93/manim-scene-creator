import { useEffect, useState } from 'react';

const DEFAULT_URL = 'http://127.0.0.1:8765';

/**
 * Polls the measure server GET /health until it returns `{ status: "ok" }`.
 * Use in Tauri after the PyInstaller sidecar starts (same URL as manual uvicorn).
 */
export function useSidecarStatus(
  baseUrl: string = DEFAULT_URL,
  intervalMs: number = 400,
): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const base = baseUrl.replace(/\/$/, '');

    async function poll() {
      try {
        const resp = await fetch(`${base}/health`, { method: 'GET' });
        if (!resp.ok) {
          if (!cancelled) setReady(false);
          return;
        }
        const j: unknown = await resp.json();
        const ok =
          typeof j === 'object' &&
          j !== null &&
          'status' in j &&
          (j as { status?: string }).status === 'ok';
        if (!cancelled) setReady(ok);
      } catch {
        if (!cancelled) setReady(false);
      }
    }

    void poll();
    const id = window.setInterval(() => void poll(), intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [baseUrl, intervalMs]);

  return ready;
}

/** One-shot check (e.g. before a measure request). */
export async function pollSidecarReady(baseUrl: string = DEFAULT_URL): Promise<boolean> {
  try {
    const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/health`);
    if (!resp.ok) return false;
    const j: unknown = await resp.json();
    return (
      typeof j === 'object' &&
      j !== null &&
      'status' in j &&
      (j as { status?: string }).status === 'ok'
    );
  } catch {
    return false;
  }
}
