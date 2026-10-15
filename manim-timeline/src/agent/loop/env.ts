import type { LoopToolEnv } from './tools';

let provider: (() => LoopToolEnv) | null = null;

/**
 * Host capabilities for the tool loop (preview snapshots, Manim frames). The canvas registers
 * them while mounted; the loop asks once per turn.
 */
export function registerLoopToolEnv(get: (() => LoopToolEnv) | null): void {
  provider = get;
}

export function loopToolEnv(): LoopToolEnv {
  return provider ? provider() : {};
}
