import { describe, expect, it } from 'vitest';
import { codeQualityToLintResult } from '../../../src/utils/code-quality';

const entry = (
  severity: 'info' | 'minor' | 'major' | 'critical' | 'blocker',
  file = 'a.py'
) => ({
  description: `${severity} issue`,
  location: {
    path: file,
    positions: { begin: { line: 2 }, end: { line: 4 } }
  },
  severity
});

describe('codeQualityToLintResult', () => {
  it('returns empty result for an empty report', () => {
    expect(codeQualityToLintResult([], 'dir')).toEqual({
      error: [],
      isSuccess: true,
      warning: []
    });
  });

  it('maps major, critical and blocker to errors by default', () => {
    const result = codeQualityToLintResult(
      [
        entry('major'),
        entry('info'),
        entry('minor'),
        entry('critical'),
        entry('blocker')
      ],
      'sub'
    );
    expect(result.error).toEqual([
      { firstLine: 2, lastLine: 4, message: 'major issue', path: 'sub/a.py' },
      {
        firstLine: 2,
        lastLine: 4,
        message: 'critical issue',
        path: 'sub/a.py'
      },
      { firstLine: 2, lastLine: 4, message: 'blocker issue', path: 'sub/a.py' }
    ]);
    expect(result.warning.map((w) => w.message)).toEqual([
      'info issue',
      'minor issue'
    ]);
    expect(result.isSuccess).toBe(true);
  });

  it('uses a custom list of error severities', () => {
    const result = codeQualityToLintResult(
      [entry('major'), entry('critical'), entry('blocker'), entry('info')],
      'sub',
      ['blocker', 'critical']
    );
    expect(result.error.map((e) => e.message)).toEqual([
      'critical issue',
      'blocker issue'
    ]);
    expect(result.warning.map((w) => w.message)).toEqual([
      'major issue',
      'info issue'
    ]);
  });

  it('joins and normalizes paths', () => {
    const [issue] = codeQualityToLintResult(
      [entry('major', 'pkg/b.py')],
      '.'
    ).error;
    expect(issue.path).toBe('pkg/b.py');
  });
});
