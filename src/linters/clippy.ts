import { run } from '../utils/action';
import commandExists from '../utils/command-exists';
import { initLintResult, LintResult } from '../utils/lint-result';

/**
 * https://rust-lang.github.io/rust-clippy/
 */
export default class Clippy {
  static get linterName(): string {
    return 'clippy';
  }

  /**
   * Verifies that all required programs are installed. Throws an error if programs are missing
   * @param dir - Directory to run the linting program in
   * @param prefix - Prefix to the lint command
   */
  static async verifySetup(dir: string, prefix = ''): Promise<void> {
    // Verify that cargo is installed (required to execute clippy)
    if (!(await commandExists('cargo'))) {
       throw new Error('cargo is not installed');
    }

    // Verify that clippy is installed
    try {
      run(`${prefix} cargo clippy --version`, { dir });
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
    if (extensions.length !== 1 || extensions[0] !== 'rs') {
      throw new Error(
        `${this.linterName} error: File extensions are not configurable`
      );
    }

    // clippy will throw an error if `--allow-dirty` is used when `--fix` isn't.
    // in order to have tests run consistently and to help out users we remove `--allow-dirty`
    // when not in fix
    const localArgs = fix ? args : args.replace('--allow-dirty', '');

    const fixArg = fix ? '--fix' : '';
    return run(
      `${prefix} cargo clippy ${fixArg} --message-format json ${localArgs}`,
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
  static parseOutput(
    dir: string,
    output: { status: number | null; stdout: string; stderr: string }
  ): LintResult {
    const lintResult = initLintResult();

    const lines = output.stdout.split('\n').map((line) => {
      let parsedLine;
      try {
        let normalizedLine = line;
        if (process.platform === 'win32') {
          normalizedLine = line.replace(/\\/gi, '\\\\');
        }
        parsedLine = JSON.parse(normalizedLine);
      } catch (err: any) {
        throw Error(
          `Error parsing ${this.name} JSON output: ${err.message}. Output: "${output.stdout}"`
        );
      }
      return parsedLine;
    });

    lines.forEach((line) => {
      if (line.reason === 'compiler-message') {
        if (line.message.level === 'warning') {
          const { code, message, spans } = line.message;
          // don't add the message counting the warnings
          if (code !== null) {
            lintResult.warning.push({
              path: spans[0].file_name,
              firstLine: spans[0].line_start,
              lastLine: spans[0].line_end,
              message
            });
          }
        } else if (line.message.level === 'error') {
          const { code, message, spans } = line.message;
          // don't add the message counting the errors
          if (code !== null) {
            lintResult.warning.push({
              path: spans[0].file_name,
              firstLine: spans[0].line_start,
              lastLine: spans[0].line_end,
              message
            });
          }
        }
      }
    });

    lintResult.isSuccess =
      output.status === 0 &&
      lintResult.warning.length === 0 &&
      lintResult.error.length === 0;

    return lintResult;
  }
}
