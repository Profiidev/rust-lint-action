import { describe, expect, it } from 'vitest';
import { parseErrorsFromDiff } from '../../../src/utils/diff';

describe('parseErrorsFromDiff', () => {
  it('returns no errors for an empty diff', () => {
    expect(parseErrorsFromDiff('')).toEqual([]);
  });

  it('creates one issue per chunk across files', () => {
    const diff = [
      'diff --git a/src/a.rs b/src/a.rs',
      '--- a/src/a.rs',
      '+++ b/src/a.rs',
      '@@ -1,2 +1,2 @@',
      '-fn a(){}',
      '+fn a() {}',
      ' x',
      '@@ -10,1 +10,1 @@',
      '-y',
      '+z',
      'diff --git a/b.rs b/b.rs',
      '--- a/b.rs',
      '+++ b/b.rs',
      '@@ -5,3 +5,1 @@',
      '-p',
      '-q',
      ' r',
      ''
    ].join('\n');
    expect(parseErrorsFromDiff(diff)).toEqual([
      {
        firstLine: 1,
        lastLine: 3,
        message: '-fn a(){}\n+fn a() {}\n x',
        path: 'src/a.rs'
      },
      { firstLine: 10, lastLine: 11, message: '-y\n+z', path: 'src/a.rs' },
      { firstLine: 5, lastLine: 8, message: '-p\n-q\n r', path: 'b.rs' }
    ]);
  });

  it('uses an empty path when the target file is missing', () => {
    const diff = ['@@ -1 +1 @@', '-a', '+b', ''].join('\n');
    expect(parseErrorsFromDiff(diff)).toEqual([
      { firstLine: 1, lastLine: 2, message: '-a\n+b', path: '' }
    ]);
  });
});
