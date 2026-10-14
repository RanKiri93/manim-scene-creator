/** Join class names, skipping falsy parts. No conflict resolution: callers pass layout classes only. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
