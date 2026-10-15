/** True when a key press belongs to a text field, so the "/" shortcut must not steal it. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

/**
 * The "/" key accepts both the character and the physical key: on a Hebrew layout the key
 * printed "/" types "." and "/" sits on Q, and either should open search.
 */
export function isInsertSearchShortcut(e: Pick<globalThis.KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return e.key === '/' || e.code === 'Slash';
}
