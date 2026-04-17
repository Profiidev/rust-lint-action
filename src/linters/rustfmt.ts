import { run } from '../utils/action';
import commandExists from '../utils/command-exists';
import { type LintResult, initLintResult } from '../utils/lint-result';

const PARSE_REGEX = /([\s\S]*?):(\d*):$([\s\S]*)/m;

/**
 * https://github.com/rust-lang/rustfmt
 */
export default class RustFmt {
  static linterName = 'rustfmt';

  /**
   * Verifies that all required programs are installed. Throws an error if programs are missing
   * @param dir - Directory to run the linting program in
   * @param prefix - Prefix to the lint command
   */
  static async verifySetup(_dir: string, _prefix = ''): Promise<void> {
    // Verify that cargo format is installed
    if (!(await commandExists('cargo-fmt'))) {
      throw new Error('Cargo format is not installed');
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
    args = '-- --color=never',
    fix = false,
    prefix = ''
  ): { status: number | null; stdout: string; stderr: string } {
    if (extensions.length !== 1 || extensions[0] !== 'rs') {
      throw new Error(
        `${this.linterName} error: File extensions are not configurable`
      );
    }
    const fixArg = fix ? '' : '--check';
    return run(`${prefix} cargo fmt ${fixArg} ${args}`, {
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
    if (!output.stdout) {
      return lintResult;
    }

    const diffs = output.stdout.split(/^Diff in /gm).slice(1);
    for (const diff of diffs) {
      const [match, pathFull, line, message] = PARSE_REGEX.exec(diff) || [];
      if (!match) {
        continue;
      }
      // Split on dir works for windows UNC paths, the substring strips out the
      // Left over '/' or '\\'
      const path = pathFull.split(dir)[1].substring(1);
      const lineNr = Number.parseInt(line, 10);
      lintResult.error.push({
        firstLine: lineNr,
        lastLine: lineNr,
        message,
        path
      });
    }

    return lintResult;
  }
}
