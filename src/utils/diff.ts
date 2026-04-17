import parseDiff from 'parse-diff';

interface DiffError {
  path: string | undefined;
  firstLine: number;
  lastLine: number;
  message: string;
}

/**
 * Parses linting errors from a unified diff
 * @param {string} diff - Unified diff
 * @returns {DiffError[]} - Array of
 * parsed errors
 */
export const parseErrorsFromDiff = (diff: string): DiffError[] => {
  const errors: DiffError[] = [];
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
        path
      });
    }
  }
  return errors;
};
