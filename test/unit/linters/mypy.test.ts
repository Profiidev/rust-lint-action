import type * as Fs from 'node:fs';
import { existsSync } from 'node:fs';
import * as core from '@actions/core';
import { describe, expect, it, vi } from 'vitest';
import Mypy from '../../../src/linters/mypy';
import { describeVerifySetup, fixture, output, runMock } from './shared';

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof Fs>()),
  existsSync: vi.fn()
}));
vi.mock('@actions/core', () => ({ warning: vi.fn() }));
vi.mock('../../../src/utils/action', () => ({ run: vi.fn() }));
vi.mock('../../../src/utils/command-exists', () => ({ default: vi.fn() }));

const MYPY = fixture('mypy.txt');
const existsSyncMock = vi.mocked(existsSync);
const DIR = '/repo';

describe('Mypy', () => {
  it('has a linter name', () => {
    expect(Mypy.linterName).toBe('mypy');
  });

  describeVerifySetup(Mypy, {
    defaultPrefix: '',
    missingMessage: 'Python is not installed',
    requiredCommand: 'python',
    versionCommand: 'mypy --version'
  });

  describe('lint', () => {
    it('appends dir when no arg is an existing path', () => {
      existsSyncMock.mockReturnValue(false);
      const result = output(0);
      runMock.mockReturnValue(result);
      expect(Mypy.lint(DIR, ['py'], '--strict')).toBe(result);
      expect(existsSyncMock).toHaveBeenCalledExactlyOnceWith('/repo/--strict');
      expect(runMock).toHaveBeenCalledExactlyOnceWith(' mypy --strict /repo', {
        dir: DIR,
        ignoreErrors: true
      });
      expect(core.warning).not.toHaveBeenCalled();
    });

    it('does not treat empty args as a path', () => {
      // Would match the cwd if empty args were checked
      existsSyncMock.mockReturnValue(true);
      runMock.mockReturnValue(output(0));
      Mypy.lint(DIR, ['py']);
      expect(existsSyncMock).not.toHaveBeenCalled();
      expect(runMock).toHaveBeenCalledWith(' mypy  /repo', {
        dir: DIR,
        ignoreErrors: true
      });
    });

    it('does not append dir when an arg is an existing path', () => {
      existsSyncMock.mockImplementation((p) => p === '/repo/src');
      runMock.mockReturnValue(output(0));
      Mypy.lint(DIR, ['py'], '--strict src', false, 'poetry run');
      // Paths are resolved against the linter dir, not the process cwd
      expect(existsSyncMock).toHaveBeenNthCalledWith(1, '/repo/--strict');
      expect(existsSyncMock).toHaveBeenNthCalledWith(2, '/repo/src');
      expect(runMock).toHaveBeenCalledWith('poetry run mypy --strict src', {
        dir: DIR,
        ignoreErrors: true
      });
    });

    it('warns when fix is requested', () => {
      existsSyncMock.mockReturnValue(false);
      runMock.mockReturnValue(output(0));
      Mypy.lint(DIR, ['py'], '', true);
      expect(core.warning).toHaveBeenCalledWith(
        'mypy does not support auto-fixing'
      );
    });
  });

  describe('parseOutput', () => {
    it('returns success for a clean run', () => {
      const stdout = 'Success: no issues found in 4 source files';
      expect(Mypy.parseOutput(DIR, output(0, stdout))).toEqual({
        error: [],
        isSuccess: true,
        warning: []
      });
    });

    it('parses errors and warnings, drops notes and strips ./ prefix', () => {
      expect(Mypy.parseOutput(DIR, output(1, MYPY))).toEqual({
        error: [
          {
            firstLine: 3,
            lastLine: 3,
            message:
              'Incompatible types in assignment (expression has type "str", variable has type "int")  [assignment]',
            path: 'src/app.py'
          },
          {
            firstLine: 20,
            lastLine: 20,
            message:
              'Function is missing a return type annotation  [no-untyped-def]',
            path: 'src/util.py'
          }
        ],
        isSuccess: false,
        warning: [
          {
            firstLine: 12,
            lastLine: 12,
            message: 'unused "type: ignore" comment  [unused-ignore]',
            path: 'src/util.py'
          }
        ]
      });
    });

    it('fails on nonzero status without parsed issues', () => {
      const stdout = 'mypy: error: Cannot find config file';
      expect(Mypy.parseOutput(DIR, output(2, stdout))).toEqual({
        error: [],
        isSuccess: false,
        warning: []
      });
    });
  });
});
