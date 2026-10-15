import type { SegmentStyle, TextBaseDir } from '@/types/scene';
import { baseLangOf, LANG_WRAPPER, parseSegments } from '@/lib/textSegments';

export {
  baseLangOf,
  isRtlSegment,
  LANG_WRAPPER,
  parseSegments,
  reconstructLine,
  type RawSegment,
} from '@/lib/textSegments';

/**
 * Encode arbitrary text as a valid Python `str` literal (safe for LaTeX, quotes, newlines, Hebrew).
 * Avoids triple-quote termination bugs from raw r"""...""" embedding.
 */
export function pythonStringLiteral(s: string): string {
  return JSON.stringify(s);
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
 * A segment in a language other than the base is wrapped as a whole part (`\en{…}`), which
 * hebrew_math_parser.classify_segments reads back.
 */
export function buildExportParts(
  raw: string,
  segments: SegmentStyle[],
  baseDir: TextBaseDir = 'rtl',
): string[] {
  const baseLang = baseLangOf(baseDir);
  const parsed = parseSegments(raw, baseDir);
  return parsed.map((p, i) => {
    const st = segments[i] ?? p;
    const wrapped = wrapSegmentForTex(
      p.text,
      p.isMath,
      'bold' in st ? st.bold : false,
      'italic' in st ? st.italic : false,
    );
    const part = p.isMath ? `$${wrapped}$` : wrapped;
    return p.lang === baseLang ? part : `${LANG_WRAPPER[p.lang]}${part}}`;
  });
}
