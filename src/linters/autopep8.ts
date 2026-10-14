import path from 'node:path';
import { run } from '../utils/action';
import commandExists from '../utils/command-exists';
import { parseErrorsFromDiff } from '../utils/diff';
import { type LintResult, initLintResult } from '../utils/lint-result';

/**
 * https://github.com/hhatto/autopep8
 */
export default class Autopep8 {
  public static linterName = 'autopep8';

  /**
   * Verifies that all required programs are installed. Throws an error if programs are missing
   * @param dir - Directory to run the linting program in
   * @param prefix - Prefix to the lint command
   */
  public static async verifySetup(dir: string, prefix = ''): Promise<void> {
    if (!(await commandExists('python'))) {
      throw new Error('Python is not installed');
    }

    try {
      run(`${prefix} autopep8 --version`, { dir });
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
    const fixArg = fix ? '-i' : '-d --exit-code';

    const output = run(`${prefix} autopep8 ${fixArg} ${args} -r "."`, {
      dir,
      ignoreErrors: true
    });

    // Normalize diff paths across OSes
    output.stdout = output.stdout.replace(
      /^(?<sign>---|\+\+\+) (?:original|fixed)\/\.[\\/]/gm,
      '$<sign> '
    );

    return output;
  }

  /**
   * Parses the output of the lint command. Determines the success of the lint process and the
   * severity of the identified code style violations
   * @param dir - Directory in which the linter has been run
   * @param output - Output of the lint command
   * @param relativeDir - Directory in which the linter has been run, relative to the workspace
   * @returns Parsed lint result
   */
  public static parseOutput(
    dir: string,
    output: { status: number | null; stdout: string; stderr: string },
    relativeDir = '.'
  ): LintResult {
    const lintResult = initLintResult();
    lintResult.error = parseErrorsFromDiff(output.stdout);
    for (const error of lintResult.error) {
      error.path = path.join(relativeDir, error.path);
    }
    lintResult.isSuccess = output.status === 0;
    return lintResult;
  }
}
