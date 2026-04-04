/**
 * Turn user input into a valid Python class name for the exported Manim scene.
 * Empty or invalid after cleaning falls back to "Scene1".
 */
export function safeSceneClassName(raw: string): string {
  const t = raw.trim().replace(/\s+/g, '_');
  if (!t) return 'Scene1';
  const cleaned = t.replace(/[^a-zA-Z0-9_]/g, '');
  if (!cleaned) return 'Scene1';
  let s = cleaned;
  if (/^[0-9]/.test(s)) s = `_${s}`;
  return s;
}
