import type { SegmentStyle } from '@/types/scene';

/**
 * Encode arbitrary text as a valid Python `str` literal (safe for LaTeX, quotes, newlines, Hebrew).
 * Avoids triple-quote termination bugs from raw r"""...""" embedding.
 */
export function pythonStringLiteral(s: string): string {
  return JSON.stringify(s);
}

interface RawSegment {
  text: string;
  isMath: boolean;
}

/**
 * Parse a raw LaTeX string (Hebrew + $math$ segments, || splits)
 * into an ordered list of segments. Mirrors hebrew_math_parser.parse_segments.
 */
export function parseSegments(raw: string): RawSegment[] {
  const parts: string[] = [];
  let i = 0;
  while (i < raw.length) {
    let chunk = '';
    while (i < raw.length) {
      if (raw[i] === '\\' && i + 1 < raw.length && raw[i + 1] === '$') {
        chunk += '$';
        i += 2;
        continue;
      }
      if (raw[i] === '$') break;
      chunk += raw[i++];
    }
    parts.push(chunk);
    if (i >= raw.length) break;
    i++;
    chunk = '';
    while (i < raw.length) {
      if (raw[i] === '\\' && i + 1 < raw.length && raw[i + 1] === '$') {
        chunk += '$';
        i += 2;
        continue;
      }
      if (raw[i] === '$') break;
      chunk += raw[i++];
    }
    parts.push(chunk);
    if (i < raw.length) i++;
  }

  const segments: RawSegment[] = [];
  for (let j = 0; j < parts.length; j++) {
    const text = parts[j];
    if (!text) continue;
    if (j % 2 === 1) {
      segments.push({ text, isMath: true });
    } else if (text.includes('||')) {
      for (const bit of text.split('||')) {
        if (bit) segments.push({ text: bit, isMath: false });
      }
    } else {
      segments.push({ text, isMath: false });
    }
  }
  return segments.length ? segments : [{ text: raw || '', isMath: false }];
}

export function reconstructLine(segments: RawSegment[]): string {
  return segments.map((s) => (s.isMath ? `$${s.text}$` : s.text)).join('');
}

/**
 * Wrap content with \textbf/\textit or \mathbf/\mathit for export.
 */
export function wrapSegmentForTex(
  content: string,
  isMath: boolean,
  bold: boolean,
  italic: boolean,
): string {
  if (!bold && !italic) return content;
  if (content.includes('{') || content.includes('}')) return content;
  let c = content;
  if (isMath) {
    if (bold && italic) c = `\\mathbf{\\mathit{${c}}}`;
    else if (bold) c = `\\mathbf{${c}}`;
    else c = `\\mathit{${c}}`;
  } else {
    if (bold && italic) c = `\\textbf{\\textit{${c}}}`;
    else if (bold) c = `\\textbf{${c}}`;
    else c = `\\textit{${c}}`;
  }
  return c;
}

/**
 * Build per-segment LaTeX parts for HebrewMathLine(...) multi-arg constructor.
 */
export function buildExportParts(raw: string, segments: SegmentStyle[]): string[] {
  const parsed = parseSegments(raw);
  return parsed.map((p, i) => {
    const st = segments[i] ?? p;
    const wrapped = wrapSegmentForTex(
      p.text,
      p.isMath,
      'bold' in st ? st.bold : false,
      'italic' in st ? st.italic : false,
    );
    return p.isMath ? `$${wrapped}$` : wrapped;
  });
}
