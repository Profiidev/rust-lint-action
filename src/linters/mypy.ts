import { existsSync } from 'node:fs';
import nodePath from 'node:path';
import * as core from '@actions/core';
import { run } from '../utils/action';
import commandExists from '../utils/command-exists';
import {
  type LintIssue,
  type LintResult,
  initLintResult
} from '../utils/lint-result';

const PARSE_REGEX =
  /^(?<pathFull>.*):(?<line>[0-9]+): (?<level>\w*): (?<text>.*)$/gm;

/**
 * https://mypy.readthedocs.io/en/stable/
 */
export default class Mypy {
  public static linterName = 'mypy';

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
      run(`${prefix} mypy --version`, { dir });
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
    if (fix) {
      core.warning(`${this.linterName} does not support auto-fixing`);
    }

    // Only lint the whole directory if no path was passed in the args
    const specifiedPath = args.split(' ').some((arg) => existsSync(arg));
    const extraArgs = specifiedPath ? '' : ` ${dir}`;

    return run(`${prefix} mypy ${args}${extraArgs}`, {
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
  public static parseOutput(
    dir: string,
    output: { status: number | null; stdout: string; stderr: string }
  ): LintResult {
    const lintResult = initLintResult();
    lintResult.isSuccess = output.status === 0;

    for (const match of output.stdout.matchAll(PARSE_REGEX)) {
      // oxlint-disable-next-line no-unsafe-type-assertion
      const { pathFull, line, level, text } = match.groups as Record<
        string,
        string
      >;
      const leadingSep = `.${nodePath.sep}`;
      const path = pathFull.startsWith(leadingSep)
        ? pathFull.substring(2)
        : pathFull;
      const lineNr = Number.parseInt(line, 10);

      const result: LintIssue = {
        firstLine: lineNr,
        lastLine: lineNr,
        message: text,
        path
      };

      if (level === 'error') {
        lintResult.error.push(result);
      } else if (level === 'warning') {
        lintResult.warning.push(result);
      }
    }

    return lintResult;
  }
}
