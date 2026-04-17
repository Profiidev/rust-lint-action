import { run } from '../utils/action';
import commandExists from '../utils/command-exists';
import { type LintResult, initLintResult } from '../utils/lint-result';

interface OxLintResult {
  diagnostics: OxLintDiagnostic[];
}

interface OxLintDiagnostic {
  message: string;
  severity: 'error' | 'warning' | 'info';
  code: string;
  url: string;
  help: string;
  filename: string;
  labels: OxLintLabel[];
}

interface OxLintLabel {
  span: OxLintSpan;
}

interface OxLintSpan {
  line: number;
}

export default class OxLint {
  static linterName = 'oxlint';

  /**
   * Verifies that all required programs are installed. Throws an error if programs are missing
   * @param dir - Directory to run the linting program in
   * @param prefix - Prefix to the lint command
   */
  static async verifySetup(dir: string, prefix = ''): Promise<void> {
    // Verify that NPM is installed (required to execute OxLint)
    if (!(await commandExists('npm'))) {
      throw new Error('npm is not installed');
    }

    // Verify that oxlint is installed
    const commandPrefix = prefix || 'npx --no-install';
    try {
      run(`${commandPrefix} oxlint --version`, { dir });
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
    const fixArg = fix ? '--fix' : '';
    return run(`${commandPrefix} oxlint ${fixArg} -f json ${args}`, {
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

    const result: OxLintResult = JSON.parse(output.stdout);

    for (const diagnostic of result.diagnostics) {
      if (diagnostic.severity === 'info') {
        continue;
      }

      lintResult.isSuccess = false;
      lintResult[diagnostic.severity].push({
        firstLine: diagnostic.labels[0].span.line,
        lastLine: diagnostic.labels[0].span.line,
        message: `${diagnostic.message} (code: ${diagnostic.code})\n${diagnostic.help}\nMore info: ${diagnostic.url}`,
        path: diagnostic.filename
      });
    }

    return lintResult;
  }
}
