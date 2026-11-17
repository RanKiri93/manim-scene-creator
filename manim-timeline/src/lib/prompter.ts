/**
 * Script prompter: the script split into lines to read one at a time. A line ends at a line
 * break or after `.`, `?`, `!` or `:` followed by a space; `$...$` math is never split.
 */
export function splitScriptLines(script: string): string[] {
  const out: string[] = [];
  for (const para of script.split(/\r?\n/)) {
    let current = '';
    let inMath = false;
    for (let i = 0; i < para.length; i++) {
      const c = para[i]!;
      current += c;
      if (c === '$') inMath = !inMath;
      if (!inMath && /[.?!:]/.test(c) && (i + 1 === para.length || para[i + 1] === ' ')) {
        if (current.trim()) out.push(current.trim());
        current = '';
      }
    }
    if (current.trim()) out.push(current.trim());
  }
  return out;
}
