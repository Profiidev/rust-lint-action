import * as core from '@actions/core';
import { describe, expect, it, vi } from 'vitest';
import TSC from '../../../src/linters/tsc';
import { describeVerifySetup, fixture, output, runMock } from './shared';

vi.mock('@actions/core', () => ({ warning: vi.fn() }));
vi.mock('../../../src/utils/action', () => ({ run: vi.fn() }));
vi.mock('../../../src/utils/command-exists', () => ({ default: vi.fn() }));

const TSC_OUTPUT = fixture('tsc.txt');
const DIR = '/repo';

describe('TSC', () => {
  it('has a linter name', () => {
    expect(TSC.linterName).toBe('TypeScript');
  });

  describeVerifySetup(TSC, {
    defaultPrefix: 'npx --no-install',
    missingMessage: 'NPM is not installed',
    requiredCommand: 'npm',
    versionCommand: 'tsc -v'
  });

  describe('lint', () => {
    it('runs tsc with the default prefix', () => {
      const result = output(0);
      runMock.mockReturnValue(result);
      expect(TSC.lint(DIR, ['ts'])).toBe(result);
      expect(runMock).toHaveBeenCalledExactlyOnceWith(
        'npx --no-install tsc --noEmit --pretty false ',
        { dir: DIR, ignoreErrors: true }
      );
      expect(core.warning).not.toHaveBeenCalled();
    });

    it('warns when fix is requested and passes args and prefix', () => {
      runMock.mockReturnValue(output(0));
      TSC.lint(DIR, ['ts'], '-p tsconfig.build.json', true, 'yarn');
      expect(core.warning).toHaveBeenCalledWith(
        'TypeScript does not support auto-fixing'
      );
      expect(runMock).toHaveBeenCalledWith(
        'yarn tsc --noEmit --pretty false -p tsconfig.build.json',
        { dir: DIR, ignoreErrors: true }
      );
    });
  });

  describe('parseOutput', () => {
    it('returns success for empty output', () => {
      expect(TSC.parseOutput(DIR, output(0, ''))).toEqual({
        error: [],
        isSuccess: true,
        warning: []
      });
    });

    it('parses errors and strips trailing periods', () => {
      expect(TSC.parseOutput(DIR, output(2, TSC_OUTPUT))).toEqual({
        error: [
          {
            firstLine: 1,
            lastLine: 1,
            message: "TS2322: Type 'string' is not assignable to type 'number'",
            path: 't.ts'
          },
          {
            firstLine: 2,
            lastLine: 2,
            message: "TS7006: Parameter 'y' implicitly has an 'any' type",
            path: 't.ts'
          }
        ],
        isSuccess: false,
        warning: []
      });
    });

    it('fails on nonzero status without parseable errors', () => {
      const stdout = "error TS5058: The specified path does not exist: 'x'.";
      expect(TSC.parseOutput(DIR, output(1, stdout))).toEqual({
        error: [],
        isSuccess: false,
        warning: []
      });
    });
  });
});
