import parseDiff from 'parse-diff';
import type { LintIssue } from './lint-result';

/**
 * Parses linting errors from a unified diff
 * @param {string} diff - Unified diff
 * @returns {LintIssue[]} - Array of parsed errors
 */
export const parseErrorsFromDiff = (diff: string): LintIssue[] => {
  const errors: LintIssue[] = [];
  const files = parseDiff(diff);
  for (const file of files) {
    const { chunks, to: path } = file;
    for (const chunk of chunks) {
      const { oldStart, oldLines, changes } = chunk;
      const chunkDiff = changes.map((change) => change.content).join('\n');
      errors.push({
        firstLine: oldStart,
        lastLine: oldStart + oldLines,
        message: chunkDiff,
        path: path ?? ''
      });
    }
  }
  return errors;
};
