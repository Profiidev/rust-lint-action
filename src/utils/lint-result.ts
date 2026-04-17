/**
 * A single linting issue (error or warning).
 */
export interface LintIssue {
  /** Path to the file containing the issue. */
  path: string;
  /** First line of the issue. */
  firstLine: number;
  /** Last line of the issue. */
  lastLine: number;
  /** Issue message. */
  message: string;
}

/**
 * Lint result object.
 */
export interface LintResult {
  /** Whether the result is success. */
  isSuccess: boolean;
  /** Warnings. */
  warning: LintIssue[];
  /** Errors. */
  error: LintIssue[];
}

/**
 * Returns an object for storing linting results
 * @returns {LintResult} - Default object
 */
export const initLintResult = (): LintResult => ({
  error: [],
  isSuccess: true, // Usually determined by the exit code of the linting command
  warning: []
});

/**
 * Returns a text summary of the number of issues found when linting
 * @param {LintResult} lintResult - Parsed linter output
 * @returns {string} - Text summary
 */
export const getSummary = (lintResult: LintResult): string => {
  const nrErrors = lintResult.error.length;
  const nrWarnings = lintResult.warning.length;
  // Build and log a summary of linting errors/warnings
  if (nrWarnings > 0 && nrErrors > 0) {
    return `${nrErrors} error${nrErrors > 1 ? 's' : ''} and ${nrWarnings} warning${
      nrWarnings > 1 ? 's' : ''
    }`;
  }
  if (nrErrors > 0) {
    return `${nrErrors} error${nrErrors > 1 ? 's' : ''}`;
  }
  if (nrWarnings > 0) {
    return `${nrWarnings} warning${nrWarnings > 1 ? 's' : ''}`;
  }
  return 'no issues';
};
