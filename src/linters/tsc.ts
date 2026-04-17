import * as core from '@actions/core';
import { run } from '../utils/action';
import commandExists from '../utils/command-exists';
import { type LintResult, initLintResult } from '../utils/lint-result';
import { removeTrailingPeriod } from '../utils/string';

/**
 * https://www.typescriptlang.org/docs/handbook/compiler-options.html
 */
export default class TSC {
  static linterName = 'TypeScript';

  /**
   * Verifies that all required programs are installed. Throws an error if programs are missing
   * @param dir - Directory to run the linting program in
   * @param prefix - Prefix to the lint command
   */
  static async verifySetup(dir: string, prefix = ''): Promise<void> {
    // Verify that NPM is installed (required to execute ESLint)
    if (!(await commandExists('npm'))) {
      throw new Error('NPM is not installed');
    }

    // Verify that ESLint is installed
    const commandPrefix = prefix || 'npx --no-install';
    try {
      run(`${commandPrefix} tsc -v`, { dir });
    } catch (error: any) {
      throw new Error(`${this.linterName} is not installed`, { cause: error });
    }
  }

  /**
   * Runs the linting program and returns the command output
   * @param dir - Directory to run the linter in
   * @param extensions - File extensions which should be linted
   * @param args - Additional arguments to pass to the linter
   * @param fix - Whether the linter should attempt to fix code style issues automatically
   * @param prefix - Prefix to the lint command
   * @returns Output of the lint command
   */
  static lint(
    dir: string,
    extensions: string[],
    args = '',
    fix = false,
    prefix = ''
  ): { status: number | null; stdout: string; stderr: string } {
    if (fix) {
      core.warning(`${this.linterName} does not support auto-fixing`);
    }

    const commandPrefix = prefix || 'npx --no-install';
    return run(`${commandPrefix} tsc --noEmit --pretty false ${args}`, {
      dir,
      ignoreErrors: true
    });
  }

  /**
   * Parses the output of the lint command. Determines the success of the lint process and the
   * severity of the identified code style violations
   * @param dir - Directory in which the linter has been run
   * @param output - Output of the lint command
   * @returns Parsed lint result
   */
  static parseOutput(
    dir: string,
    output: { status: number | null; stdout: string; stderr: string }
  ): LintResult {
    const lintResult = initLintResult();
    lintResult.isSuccess = output.status === 0;

    // Example: file1.ts(4,25): error TS7005: Variable 'str' implicitly has an 'any' type.
    const regex =
      /^(?<file>.+)\((?<line>\d+),(?<column>\d+)\):\s(?<code>\w+)\s(?<message>.+)$/gm;

    const errors = [];
    const matches = output.stdout.matchAll(regex);

    for (const match of matches) {
      // oxlint-disable-next-line no-unsafe-type-assertion
      const { file, line, column, code, message } = match.groups as any;
      errors.push({ code, column, file, line, message });
    }

    for (const error of errors) {
      const { file, line, message } = error;

      const entry = {
        firstLine: Number(line),
        lastLine: Number(line),
        message: removeTrailingPeriod(message),
        path: file
      };

      lintResult.error.push(entry);
    }

    return lintResult;
  }
}
