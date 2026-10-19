import { describe, expect, it, vi } from 'vitest';
import OxLint from '../../../src/linters/oxlint';
import { describeVerifySetup, fixture, output, runMock } from './shared';

vi.mock('../../../src/utils/action', () => ({ run: vi.fn() }));
vi.mock('../../../src/utils/command-exists', () => ({ default: vi.fn() }));

const OXLINT_ERRORS = fixture('oxlint-errors.json');
const OXLINT = fixture('oxlint.json');
const DIR = '/repo';

describe('OxLint', () => {
  it('has a linter name', () => {
    expect(OxLint.linterName).toBe('oxlint');
  });

  describeVerifySetup(OxLint, {
    defaultPrefix: 'npx --no-install',
    missingMessage: 'npm is not installed',
    requiredCommand: 'npm',
    versionCommand: 'oxlint --version'
  });

  describe('lint', () => {
    it('runs oxlint with json output and default prefix', () => {
      const result = output(0);
      runMock.mockReturnValue(result);
      expect(OxLint.lint(DIR, ['ts'])).toBe(result);
      expect(runMock).toHaveBeenCalledExactlyOnceWith(
        'npx --no-install oxlint  -f json ',
        { dir: DIR, ignoreErrors: true }
      );
    });

    it('adds --fix, args and custom prefix', () => {
      runMock.mockReturnValue(output(0));
      OxLint.lint(DIR, ['ts'], '--deny-warnings', true, 'bunx');
      expect(runMock).toHaveBeenCalledWith(
        'bunx oxlint --fix -f json --deny-warnings',
        { dir: DIR, ignoreErrors: true }
      );
    });
  });

  describe('parseOutput', () => {
    it('returns status based result on empty stdout', () => {
      expect(OxLint.parseOutput(DIR, output(0, ''))).toEqual({
        error: [],
        isSuccess: true,
        warning: []
      });
      expect(OxLint.parseOutput(DIR, output(1, '')).isSuccess).toBe(false);
    });

    it('returns success for a clean report', () => {
      const stdout = JSON.stringify({ diagnostics: [], number_of_files: 3 });
      expect(OxLint.parseOutput(DIR, output(0, stdout))).toEqual({
        error: [],
        isSuccess: true,
        warning: []
      });
    });

    it('parses warnings and composes help/url into the message', () => {
      // Oxlint exits 0 for warnings only, any diagnostic still fails the result
      expect(OxLint.parseOutput(DIR, output(0, OXLINT))).toEqual({
        error: [],
        isSuccess: false,
        warning: [
          {
            firstLine: 2,
            lastLine: 2,
            message:
              '`debugger` statement is not allowed (code: eslint(no-debugger))\nRemove the debugger statement\nMore info: https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-debugger.html',
            path: 'bad.ts'
          },
          {
            firstLine: 1,
            lastLine: 1,
            message:
              "Variable 'x' is declared but never used. Unused variables should start with a '_'. (code: eslint(no-unused-vars))\nConsider removing this declaration.\nMore info: https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-unused-vars.html",
            path: 't.ts'
          }
        ]
      });
    });

    it('parses errors, including parse errors without code/help/url', () => {
      expect(OxLint.parseOutput(DIR, output(1, OXLINT_ERRORS))).toEqual({
        error: [
          {
            firstLine: 1,
            lastLine: 1,
            // Parse errors have no code/help/url, only the message remains
            message: 'Unexpected token',
            path: 'broken.js'
          },
          {
            firstLine: 1,
            lastLine: 1,
            message:
              'Expected === and instead saw == (code: eslint(eqeqeq))\nPrefer === operator\nMore info: https://oxc.rs/docs/guide/usage/linter/rules/eslint/eqeqeq.html',
            path: 'e.js'
          }
        ],
        isSuccess: false,
        warning: []
      });
    });

    it('omits missing parts and defaults missing/empty labels to line 1', () => {
      const stdout = JSON.stringify({
        diagnostics: [
          {
            code: 'eslint(x)',
            filename: 'a.ts',
            labels: [],
            message: 'only code',
            severity: 'error'
          },
          {
            filename: 'b.ts',
            help: 'do this',
            message: 'only help',
            severity: 'warning'
          },
          {
            filename: 'c.ts',
            help: '',
            labels: [{ span: { line: 9 } }],
            message: 'only url',
            severity: 'warning',
            url: 'https://oxc.rs'
          }
        ]
      });
      expect(OxLint.parseOutput(DIR, output(1, stdout))).toEqual({
        error: [
          {
            firstLine: 1,
            lastLine: 1,
            message: 'only code (code: eslint(x))',
            path: 'a.ts'
          }
        ],
        isSuccess: false,
        warning: [
          {
            firstLine: 1,
            lastLine: 1,
            message: 'only help\ndo this',
            path: 'b.ts'
          },
          {
            firstLine: 9,
            lastLine: 9,
            message: 'only url\nMore info: https://oxc.rs',
            path: 'c.ts'
          }
        ]
      });
    });

    it('skips info diagnostics without failing', () => {
      const stdout = JSON.stringify({
        diagnostics: [
          {
            code: 'x',
            filename: 'a.ts',
            help: 'h',
            labels: [{ span: { line: 1 } }],
            message: 'info',
            severity: 'info',
            url: 'u'
          }
        ]
      });
      expect(OxLint.parseOutput(DIR, output(0, stdout))).toEqual({
        error: [],
        isSuccess: true,
        warning: []
      });
    });
  });
});
