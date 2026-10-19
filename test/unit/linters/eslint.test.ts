import { describe, expect, it, vi } from 'vitest';
import ESLint from '../../../src/linters/eslint';
import { describeVerifySetup, fixture, output, runMock } from './shared';

vi.mock('../../../src/utils/action', () => ({ run: vi.fn() }));
vi.mock('../../../src/utils/command-exists', () => ({ default: vi.fn() }));

const ESLINT = fixture('eslint.json');
const DIR = '/home/runner/work/app';

describe('ESLint', () => {
  it('has a linter name', () => {
    expect(ESLint.linterName).toBe('ESLint');
  });

  describeVerifySetup(ESLint, {
    defaultPrefix: 'npx --no-install',
    missingMessage: 'NPM is not installed',
    requiredCommand: 'npm',
    versionCommand: 'eslint -v'
  });

  describe('lint', () => {
    it('runs eslint with default prefix and extensions', () => {
      const result = output(0, '[]');
      runMock.mockReturnValue(result);
      expect(ESLint.lint(DIR, ['js', 'ts'])).toBe(result);
      expect(runMock).toHaveBeenCalledExactlyOnceWith(
        'npx --no-install eslint --ext .js,.ts  --no-color --format json  "."',
        { dir: DIR, ignoreErrors: true }
      );
    });

    it('adds --fix, args and custom prefix', () => {
      runMock.mockReturnValue(output(0, '[]'));
      ESLint.lint(DIR, ['js'], '--max-warnings 0', true, 'yarn');
      expect(runMock).toHaveBeenCalledWith(
        'yarn eslint --ext .js --fix --no-color --format json --max-warnings 0 "."',
        { dir: DIR, ignoreErrors: true }
      );
    });
  });

  describe('parseOutput', () => {
    it('returns success for a clean run', () => {
      const stdout = JSON.stringify([
        { filePath: `${DIR}/src/a.js`, messages: [] }
      ]);
      expect(ESLint.parseOutput(DIR, output(0, stdout))).toEqual({
        error: [],
        isSuccess: true,
        warning: []
      });
    });

    it('maps severity 1 to warnings and 2 to errors', () => {
      const result = ESLint.parseOutput(DIR, output(1, ESLINT));
      expect(result).toEqual({
        error: [
          {
            firstLine: 1,
            lastLine: 1,
            message:
              "'foo' is assigned a value but never used (no-unused-vars)",
            path: 'src/index.js'
          },
          {
            firstLine: 5,
            lastLine: 5,
            message: "Expected '===' and instead saw '==' (eqeqeq)",
            path: 'src/lib/util.js'
          }
        ],
        isSuccess: false,
        warning: [
          {
            firstLine: 3,
            lastLine: 3,
            message: 'Unexpected console statement (no-console)',
            path: 'src/index.js'
          }
        ]
      });
    });

    it('reports warnings only with status 0', () => {
      const stdout = JSON.stringify([
        {
          filePath: `${DIR}/a.js`,
          messages: [
            { line: 2, message: 'No semicolon', ruleId: 'semi', severity: 1 }
          ]
        }
      ]);
      const result = ESLint.parseOutput(DIR, output(0, stdout));
      expect(result.isSuccess).toBe(true);
      expect(result.error).toEqual([]);
      expect(result.warning).toEqual([
        {
          firstLine: 2,
          lastLine: 2,
          message: 'No semicolon (semi)',
          path: 'a.js'
        }
      ]);
    });

    it('ignores messages with other severities', () => {
      const stdout = JSON.stringify([
        {
          filePath: `${DIR}/a.js`,
          messages: [{ line: 1, message: 'off', ruleId: 'x', severity: 0 }]
        }
      ]);
      expect(ESLint.parseOutput(DIR, output(1, stdout))).toEqual({
        error: [],
        isSuccess: false,
        warning: []
      });
    });

    it('throws on fatal messages', () => {
      const stdout = JSON.stringify([
        {
          filePath: `${DIR}/a.js`,
          messages: [
            {
              column: 12,
              fatal: true,
              line: 2,
              message: 'Parsing error: Unexpected token )',
              ruleId: null,
              severity: 2
            }
          ]
        }
      ]);
      expect(() => ESLint.parseOutput(DIR, output(2, stdout))).toThrow(
        'ESLint error: Parsing error: Unexpected token )'
      );
    });

    it('throws with cause on invalid JSON', () => {
      const stdout = 'Oops! Something went wrong! :(';
      let thrown: unknown = undefined;
      try {
        ESLint.parseOutput(DIR, output(2, stdout));
      } catch (error) {
        thrown = error;
      }
      expect((thrown as Error).message).toMatch(
        /^Error parsing ESLint JSON output: .+\. Output: "Oops! Something went wrong! :\("$/u
      );
      expect((thrown as Error).cause).toBeInstanceOf(SyntaxError);
    });
  });
});
