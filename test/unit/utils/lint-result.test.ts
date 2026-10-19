import { describe, expect, it } from 'vitest';
import {
  type LintIssue,
  getSummary,
  initLintResult
} from '../../../src/utils/lint-result';

const issue: LintIssue = { firstLine: 1, lastLine: 1, message: 'm', path: 'p' };
const issues = (n: number) => Array.from({ length: n }, () => issue);
const result = (errors: number, warnings: number) => ({
  error: issues(errors),
  isSuccess: true,
  warning: issues(warnings)
});

describe('initLintResult', () => {
  it('returns an empty successful result', () => {
    expect(initLintResult()).toEqual({
      error: [],
      isSuccess: true,
      warning: []
    });
  });

  it('returns a fresh object each time', () => {
    expect(initLintResult().error).not.toBe(initLintResult().error);
  });
});

describe('getSummary', () => {
  it.each([
    [0, 0, 'no issues'],
    [1, 0, '1 error'],
    [2, 0, '2 errors'],
    [0, 1, '1 warning'],
    [0, 3, '3 warnings'],
    [1, 1, '1 error and 1 warning'],
    [2, 1, '2 errors and 1 warning'],
    [1, 2, '1 error and 2 warnings'],
    [5, 7, '5 errors and 7 warnings']
  ])('%i errors, %i warnings -> %s', (errors, warnings, expected) => {
    expect(getSummary(result(errors, warnings))).toBe(expected);
  });
});
