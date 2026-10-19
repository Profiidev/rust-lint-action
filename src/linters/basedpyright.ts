import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as core from '@actions/core';
import { run } from '../utils/action';
import { codeQualityToLintResult } from '../utils/code-quality';
import commandExists from '../utils/command-exists';
import type { LintResult } from '../utils/lint-result';

/**
 * https://docs.basedpyright.com
 */
export default class Basedpyright {
  public static linterName = 'basedpyright';

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
      run(`${prefix} basedpyright --version`, { dir });
    } catch (error: any) {
      throw new Error(`${this.linterName} is not installed`, { cause: error });
    }
  }

  /**
   * Runs the linting program and returns the command output. The Code Quality report is written to
   * a file and returned as stdout
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

    const reportDir = mkdtempSync(path.join(tmpdir(), 'basedpyright-'));
    const outputPath = path.join(reportDir, 'report.json');
    const result = run(
      `${prefix} basedpyright --gitlabcodequality ${outputPath} ${args}`,
      {
        dir,
        ignoreErrors: true
      }
    );
    result.stdout = existsSync(outputPath)
      ? readFileSync(outputPath, 'utf8')
      : '';
    rmSync(reportDir, { force: true, recursive: true });
    return result;
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
    const lintResult = codeQualityToLintResult(
      JSON.parse(output.stdout || '[]'),
      relativeDir,
      // Basedpyright reports errors as `blocker` and warnings as `major`
      ['blocker', 'critical']
    );
    lintResult.isSuccess = output.status === 0;
    return lintResult;
  }
}
