import { describe, expect, it } from 'vitest';
import { splitScriptLines } from './prompter';

describe('splitScriptLines', () => {
  it('splits at sentence ends and line breaks, never inside math', () => {
    expect(splitScriptLines('נגדיר את $f(x)=x. 2$ ונגזור. ואז נבדוק!\nשורה חדשה')).toEqual([
      'נגדיר את $f(x)=x. 2$ ונגזור.',
      'ואז נבדוק!',
      'שורה חדשה',
    ]);
    expect(splitScriptLines('a: b\n\n c')).toEqual(['a:', 'b', 'c']);
    expect(splitScriptLines('3.14 is pi.')).toEqual(['3.14 is pi.']);
  });
});
