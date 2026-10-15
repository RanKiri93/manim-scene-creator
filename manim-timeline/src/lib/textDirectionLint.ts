import type { TextBaseDir, TextLang } from '@/types/scene';
import { baseLangOf, LANG_WRAPPER } from './textSegments';

/**
 * Editor hint for text lines: letters of the other script that sit outside a language wrapper.
 * In a right-to-left line, unwrapped English comes out with its words in reverse order and is
 * written right to left; in a left-to-right line, unwrapped Hebrew has the same problem.
 */

export interface ForeignRun {
  /** Inclusive start / exclusive end offsets in `raw`. */
  start: number;
  end: number;
  text: string;
}

const LATIN = /[A-Za-z]/;
const HEBREW = /[֐-׿]/;
/** Characters that may sit between two foreign letters inside one run. */
const CONNECTOR = /[\s'’\-.,:;!?0-9|]/;

function foreignLetter(lang: TextLang): RegExp {
  return lang === 'en' ? LATIN : HEBREW;
}

/** The language a line needs wrapped, i.e. the one that is not its base. */
export function foreignLangOf(baseDir: TextBaseDir | null | undefined): TextLang {
  return baseLangOf(baseDir) === 'he' ? 'en' : 'he';
}

/** Index of the `}` closing the `{` at `openIdx`, or -1. */
function closeBrace(s: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

/**
 * Runs of letters in the other script that are not inside math, a language wrapper, or a
 * `\command` name. Neighbouring words joined by spaces, punctuation, digits or `||` form one run.
 */
export function findUnwrappedForeignRuns(raw: string, baseDir: TextBaseDir = 'rtl'): ForeignRun[] {
  const foreign = foreignLangOf(baseDir);
  const isForeign = foreignLetter(foreign);
  const eligible: boolean[] = new Array(raw.length).fill(false);
  let inMath = false;
  let i = 0;
  while (i < raw.length) {
    const c = raw[i]!;
    if (c === '\\') {
      const wrapperLang = (Object.keys(LANG_WRAPPER) as TextLang[]).find((l) =>
        raw.startsWith(LANG_WRAPPER[l], i),
      );
      if (!inMath && wrapperLang) {
        const close = closeBrace(raw, i + LANG_WRAPPER[wrapperLang].length - 1);
        if (close >= 0) {
          i = close + 1;
          continue;
        }
      }
      // Skip `\$`, `\{`, and command names like `\textbf`.
      i++;
      if (i < raw.length && /[A-Za-z]/.test(raw[i]!)) {
        while (i < raw.length && /[A-Za-z]/.test(raw[i]!)) i++;
      } else {
        i++;
      }
      continue;
    }
    if (c === '$') inMath = !inMath;
    else if (!inMath && isForeign.test(c)) eligible[i] = true;
    i++;
  }

  const runs: ForeignRun[] = [];
  let k = 0;
  while (k < raw.length) {
    if (!eligible[k]) {
      k++;
      continue;
    }
    const start = k;
    let end = k + 1;
    let j = end;
    while (j < raw.length) {
      if (eligible[j]) {
        end = j + 1;
        j++;
      } else if (CONNECTOR.test(raw[j]!) && !eligible[j]) {
        j++;
      } else {
        break;
      }
    }
    runs.push({ start, end, text: raw.slice(start, end) });
    k = end;
  }
  return runs;
}

/** `raw` with every unwrapped foreign run wrapped in `\en{…}` (RTL line) or `\he{…}` (LTR line). */
export function wrapForeignRuns(raw: string, baseDir: TextBaseDir = 'rtl'): string {
  const wrapper = LANG_WRAPPER[foreignLangOf(baseDir)];
  let out = raw;
  const runs = findUnwrappedForeignRuns(raw, baseDir);
  for (let r = runs.length - 1; r >= 0; r--) {
    const { start, end } = runs[r]!;
    out = `${out.slice(0, start)}${wrapper}${out.slice(start, end)}}${out.slice(end)}`;
  }
  return out;
}
