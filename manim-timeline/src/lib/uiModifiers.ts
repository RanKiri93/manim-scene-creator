/** Shift, Ctrl (Windows/Linux), or Cmd (macOS) — additive multi-select in timeline and item list. */
export function isMultiSelectModifier(
  e: Pick<MouseEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>,
): boolean {
  return e.shiftKey || e.ctrlKey || e.metaKey;
}
