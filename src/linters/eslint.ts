import { run } from '../utils/action';
import commandExists from '../utils/command-exists';
import {
  type LintIssue,
  type LintResult,
  initLintResult
} from '../utils/lint-result';
import { removeTrailingPeriod } from '../utils/string';

/**
 * https://eslint.org
 */
export default class ESLint {
  public static linterName = 'ESLint';

  /**
   * Verifies that all required programs are installed. Throws an error if programs are missing
   * @param dir - Directory to run the linting program in
   * @param prefix - Prefix to the lint command
   */
  public static async verifySetup(dir: string, prefix = ''): Promise<void> {
    if (!(await commandExists('npm'))) {
      throw new Error('NPM is not installed');
    }

    const commandPrefix = prefix || 'npx --no-install';
    try {
      run(`${commandPrefix} eslint -v`, { dir });
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
  public static lint(
    dir: string,
    extensions: string[],
    args = '',
    fix = false,
    prefix = ''
  ): { status: number | null; stdout: string; stderr: string } {
    const extensionsArg = extensions.map((ext) => `.${ext}`).join(',');
    const fixArg = fix ? '--fix' : '';

    const commandPrefix = prefix || 'npx --no-install';
    return run(
      `${commandPrefix} eslint --ext ${extensionsArg} ${fixArg} --no-color --format json ${args} "."`,
      {
        dir,
        ignoreErrors: true
      }
    );
  }

  /**
   * Parses the output of the lint command. Determines the success of the lint process and the
   * severity of the identified code style violations
   * @param dir - Directory in which the linter has been run
   * @param output - Output of the lint command
   * @returns Parsed lint result
   */
  public static parseOutput(
    dir: string,
    output: { status: number | null; stdout: string; stderr: string }
  ): LintResult {
    const lintResult = initLintResult();
    lintResult.isSuccess = output.status === 0;

    // oxlint-disable-next-line init-declarations
    let outputJson: any;
    try {
      outputJson = JSON.parse(output.stdout);
    } catch (error: any) {
      throw new Error(
        `Error parsing ${this.linterName} JSON output: ${error.message}. Output: "${output.stdout}"`,
        { cause: error }
      );
    }

    for (const violation of outputJson) {
      const { filePath, messages } = violation;
      const path = filePath.substring(dir.length + 1);

      for (const msg of messages) {
        const { fatal, line, message, ruleId, severity } = msg;

        if (fatal) {
          throw new Error(`${this.linterName} error: ${message}`);
        }

        const entry: LintIssue = {
          firstLine: line,
          lastLine: line,
          message: `${removeTrailingPeriod(message)} (${ruleId})`,
          path
        };

        if (severity === 1) {
          lintResult.warning.push(entry);
        } else if (severity === 2) {
          lintResult.error.push(entry);
        }
      }
    }

    return lintResult;
  }
}
