import { useMemo } from 'react';
import katex from 'katex';

const MATH_RE = /^\$([\s\S]*)\$$/;

export function isMathBoundaryWord(word: string): boolean {
  return MATH_RE.test(word);
}

/**
 * Renders a word-boundary label. Tokens wrapped in `$...$` (from guided-transcription math
 * segments) are rendered as LaTeX via KaTeX with a larger hover tooltip for readability;
 * everything else renders as plain truncated text.
 *
 * `align` controls which way the label (and its hover tooltip) grows so ticks near the clip's
 * right edge stay inside the clip instead of spilling out.
 */
export default function BoundaryLabel({
  word,
  align = 'left',
  maxWidthPx = 96,
  fillSegment = false,
}: {
  word: string;
  align?: 'left' | 'right';
  maxWidthPx?: number;
  /** When true (math in a wide segment), use the full segment width instead of clipping tight. */
  fillSegment?: boolean;
}) {
  const mathHtml = useMemo(() => {
    const match = word.match(MATH_RE);
    if (!match) return null;
    try {
      return katex.renderToString(match[1], {
        throwOnError: false,
        displayMode: fillSegment && maxWidthPx >= 80,
      });
    } catch {
      return null;
    }
  }, [word, fillSegment, maxWidthPx]);

  if (!mathHtml) {
    return (
      <span
        className={`pointer-events-none block truncate text-[8px] font-bold leading-tight text-white drop-shadow-sm ${
          align === 'right' ? 'text-right' : ''
        }`}
        style={{ maxWidth: `${maxWidthPx}px` }}
      >
        {word}
      </span>
    );
  }

  return (
    <span
      className="group/math pointer-events-auto relative block cursor-help"
      style={fillSegment ? { width: `${maxWidthPx}px`, maxWidth: `${maxWidthPx}px` } : undefined}
    >
      <span
        className={`block text-white drop-shadow-sm ${fillSegment ? 'overflow-visible' : 'overflow-hidden'}`}
        style={{
          fontSize: fillSegment ? '12px' : '10px',
          lineHeight: 1.2,
          maxWidth: fillSegment ? undefined : `${maxWidthPx}px`,
        }}
        dangerouslySetInnerHTML={{ __html: mathHtml }}
      />
      <span
        className={`pointer-events-none absolute top-full z-50 mt-1 hidden whitespace-nowrap rounded border border-slate-600 bg-slate-900 px-2 py-1 text-white shadow-lg group-hover/math:block ${
          align === 'right' ? 'right-0' : 'left-0'
        }`}
        style={{ fontSize: '16px' }}
        dangerouslySetInnerHTML={{ __html: mathHtml }}
      />
    </span>
  );
}
