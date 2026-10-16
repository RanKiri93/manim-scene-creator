/** Most style notes a project keeps, and the longest one (characters). */
export const MAX_COPILOT_NOTES = 20;
export const MAX_COPILOT_NOTE_LENGTH = 300;

/** Clean a list of Copilot style notes: strings only, trimmed, non-empty, no repeats, capped. */
export function normalizeCopilotNotes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const note = v.trim().replace(/\s+/g, ' ').slice(0, MAX_COPILOT_NOTE_LENGTH);
    if (note && !out.some((n) => n.toLowerCase() === note.toLowerCase())) out.push(note);
    if (out.length >= MAX_COPILOT_NOTES) break;
  }
  return out;
}
