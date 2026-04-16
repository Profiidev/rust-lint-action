import { run } from '../utils/action';
import commandExists from '../utils/command-exists';
import { initLintResult, LintResult } from '../utils/lint-result';

export default class OxFmt {
  static get linterName(): string {
    return 'oxfmt';
  }

  /**
   * Verifies that all required programs are installed. Throws an error if programs are missing
   * @param dir - Directory to run the linting program in
   * @param prefix - Prefix to the lint command
   */
  static async verifySetup(dir: string, prefix = ''): Promise<void> {
    // Verify that NPM is installed (required to execute OxFmt)
    if (!(await commandExists('npm'))) {
      throw new Error('npm is not installed');
    }

    // Verify that oxfmt is installed
    const commandPrefix = prefix || 'npx --no-install';
    try {
      run(`${commandPrefix} oxfmt --version`, { dir });
    } catch (err) {
      throw new Error(`${this.linterName} is not installed`);
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
    const fixArg = fix ? '' : '--check';
    return run(`${commandPrefix} oxfmt ${fixArg} ${args}`, {
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

    const lines = output.stdout.split(/\r?\n/);

    const errorPaths = lines
      .map((line) => line.trim())
      .filter(
        (line) =>
          line.length > 0 &&
          !line.startsWith('Checking') &&
          !line.startsWith('Format') &&
          !line.startsWith('Finished')
      )
      .map((line) => {
        // Extract just the path: "src/file.ts (0ms)" -> "src/file.ts"
        return line.split(' ')[0];
      });

    lintResult.error = errorPaths.map((path) => ({
      path,
      firstLine: 1,
      lastLine: 1,
      message:
        "There are issues with this file's formatting, please run Prettier to fix the errors"
    }));

    return lintResult;
  }
}
