import { run } from '../utils/action';
import commandExists from '../utils/command-exists';
import { type LintResult, initLintResult } from '../utils/lint-result';

/**
 * https://github.com/sveltejs/prettier-plugin-svelte
 */
export default class Svelte {
  static linterName = 'svelte';

  /**
   * Verifies that all required programs are installed. Throws an error if programs are missing
   * @param dir - Directory to run the linting program in
   * @param prefix - Prefix to the lint command
   */
  static async verifySetup(dir: string, prefix = ''): Promise<void> {
    // Verify that NPM is installed (required to execute Prettier)
    if (!(await commandExists('npm'))) {
      throw new Error('NPM is not installed');
    }

    // Verify that SV is installed
    const commandPrefix = prefix || 'npx -y';
    try {
      run(`${commandPrefix} sv -v`, { dir });
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
    const commandPrefix = prefix || 'npx --no-install';
    return run(`${commandPrefix} sv check --output machine-verbose ${args}`, {
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

    if (lintResult.isSuccess || !output.stdout) {
      return lintResult;
    }

    const lints = output.stdout
      .split(/\n/)
      .map((lint) => {
        try {
          return JSON.parse(lint.substring(lint.indexOf(' ') + 1));
        } catch {
          return undefined;
        }
      })
      .filter((lint) => lint);

    lintResult.error = lints
      .filter((lint) => lint.type === 'ERROR')
      .map((lint) => ({
        firstLine: lint.start.line,
        lastLine: lint.end.line,
        message: lint.message,
        path: lint.filename
      }));

    lintResult.warning = lints
      .filter((lint) => lint.type === 'WARNING')
      .map((lint) => ({
        firstLine: lint.start.line,
        lastLine: lint.end.line,
        message: lint.message,
        path: lint.filename
      }));

    return lintResult;
  }
}
