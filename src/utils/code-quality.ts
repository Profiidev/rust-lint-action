import path from 'node:path';
import type { LintIssue, LintResult } from './lint-result';

/**
 * Issue in the GitLab Code Quality format, emitted by ruff, ty and basedpyright
 */
interface CodeQualityIssue {
  description: string;
  severity: 'info' | 'minor' | 'major' | 'critical' | 'blocker';
  location: {
    path: string;
    positions: {
      begin: { line: number };
      end: { line: number };
    };
  };
}

/**
 * Converts a GitLab Code Quality report into a lint result. Paths are made relative to the
 * workspace by prefixing them with the linter directory
 * @param {CodeQualityIssue[]} report - Parsed Code Quality report
 * @param {string} relativeDir - Directory the linter was run in, relative to the workspace
 * @returns {LintResult} - Lint result, `isSuccess` still has to be set by the caller
 */
export const codeQualityToLintResult = (
  report: CodeQualityIssue[],
  relativeDir: string,
  errorSeverities: string[] = ['major', 'critical', 'blocker']
): LintResult => {
  const toIssue = (c: CodeQualityIssue): LintIssue => ({
    firstLine: c.location.positions.begin.line,
    lastLine: c.location.positions.end.line,
    message: c.description,
    path: path.join(relativeDir, c.location.path)
  });

  return {
    error: report
      .filter((c) => errorSeverities.includes(c.severity))
      .map(toIssue),
    isSuccess: true,
    warning: report
      .filter((c) => !errorSeverities.includes(c.severity))
      .map(toIssue)
  };
};
