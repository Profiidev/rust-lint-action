import type * as Fs from 'node:fs';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type * as Os from 'node:os';
import { tmpdir } from 'node:os';
import * as core from '@actions/core';
import { describe, expect, it, vi } from 'vitest';
import Basedpyright from '../../../src/linters/basedpyright';
import { describeVerifySetup, fixture, output, runMock } from './shared';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof Fs>();
  return {
    ...actual,
    existsSync: vi.fn(),
    mkdtempSync: vi.fn(),
    rmSync: vi.fn(),
    // Delegates by default so fixtures can still be read
    readFileSync: vi.fn(actual.readFileSync)
  };
});
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof Os>()),
  tmpdir: vi.fn()
}));
vi.mock('@actions/core', () => ({ warning: vi.fn() }));
vi.mock('../../../src/utils/action', () => ({ run: vi.fn() }));
vi.mock('../../../src/utils/command-exists', () => ({ default: vi.fn() }));

const DIR = '/repo';
const REPORT = fixture('basedpyright-report.json');
const REPORT_PATH = '/tmp/basedpyright-abc123/report.json';

const stubTempDir = (reportExists: boolean) => {
  vi.mocked(tmpdir).mockReturnValue('/tmp');
  vi.mocked(mkdtempSync).mockReturnValue('/tmp/basedpyright-abc123');
  vi.mocked(existsSync).mockReturnValue(reportExists);
};

describe('Basedpyright', () => {
  it('has a linter name', () => {
    expect(Basedpyright.linterName).toBe('basedpyright');
  });

  describeVerifySetup(Basedpyright, {
    defaultPrefix: '',
    missingMessage: 'Python is not installed',
    requiredCommand: 'python',
    versionCommand: 'basedpyright --version'
  });

  describe('lint', () => {
    it('writes the report to a temp dir and returns it as stdout', () => {
      stubTempDir(true);
      vi.mocked(readFileSync).mockReturnValue(REPORT);
      runMock.mockReturnValue(output(1, 'human readable summary', ''));

      expect(Basedpyright.lint(DIR, ['py'])).toEqual(output(1, REPORT, ''));
      expect(mkdtempSync).toHaveBeenCalledWith('/tmp/basedpyright-');
      expect(existsSync).toHaveBeenCalledWith(REPORT_PATH);
      expect(readFileSync).toHaveBeenCalledWith(REPORT_PATH, 'utf8');
      expect(rmSync).toHaveBeenCalledExactlyOnceWith(
        '/tmp/basedpyright-abc123',
        {
          force: true,
          recursive: true
        }
      );
      expect(vi.mocked(rmSync).mock.invocationCallOrder[0]).toBeGreaterThan(
        vi.mocked(readFileSync).mock.invocationCallOrder.at(-1)!
      );
      expect(runMock).toHaveBeenCalledExactlyOnceWith(
        ` basedpyright --gitlabcodequality ${REPORT_PATH} `,
        { dir: DIR, ignoreErrors: true }
      );
      expect(core.warning).not.toHaveBeenCalled();
    });

    it('returns empty stdout when no report was written', () => {
      stubTempDir(false);
      runMock.mockReturnValue(output(2, 'crash', 'boom'));

      expect(
        Basedpyright.lint(DIR, ['py'], '--level error', false, 'uv run')
      ).toEqual(output(2, '', 'boom'));
      expect(readFileSync).not.toHaveBeenCalledWith(REPORT_PATH, 'utf8');
      expect(rmSync).toHaveBeenCalledWith('/tmp/basedpyright-abc123', {
        force: true,
        recursive: true
      });
      expect(runMock).toHaveBeenCalledWith(
        `uv run basedpyright --gitlabcodequality ${REPORT_PATH} --level error`,
        { dir: DIR, ignoreErrors: true }
      );
    });

    it('warns when fix is requested', () => {
      stubTempDir(false);
      runMock.mockReturnValue(output(0));
      Basedpyright.lint(DIR, ['py'], '', true);
      expect(core.warning).toHaveBeenCalledWith(
        'basedpyright does not support auto-fixing'
      );
    });
  });

  describe('parseOutput', () => {
    it('treats empty stdout as an empty report', () => {
      expect(Basedpyright.parseOutput(DIR, output(0, ''))).toEqual({
        error: [],
        isSuccess: true,
        warning: []
      });
      expect(Basedpyright.parseOutput(DIR, output(1, '')).isSuccess).toBe(
        false
      );
    });

    it('maps blocker/critical to error and other severities to warning, joined with relativeDir', () => {
      const result = Basedpyright.parseOutput(DIR, output(1, REPORT), 'py');
      expect(result.isSuccess).toBe(false);
      expect(result.error).toEqual([
        {
          firstLine: 2,
          lastLine: 2,
          // Indentation in the second line uses non-breaking spaces
          message:
            'Type "Literal[\'a\']" is not assignable to declared type "int"\n\u00A0\u00A0"Literal[\'a\']" is not assignable to "int"',
          path: 'py/m.py'
        }
      ]);
      expect(result.warning).toHaveLength(6);
      expect(result.warning[0]).toEqual({
        firstLine: 1,
        lastLine: 1,
        message: 'Import "os" is not accessed',
        path: 'py/m.py'
      });
    });

    it('maps critical to error', () => {
      const stdout = JSON.stringify([
        {
          description: 'critical issue',
          location: {
            path: 'a.py',
            positions: { begin: { line: 1 }, end: { line: 1 } }
          },
          severity: 'critical'
        }
      ]);
      expect(Basedpyright.parseOutput(DIR, output(1, stdout)).error).toEqual([
        { firstLine: 1, lastLine: 1, message: 'critical issue', path: 'a.py' }
      ]);
    });

    it('defaults relativeDir to "."', () => {
      const result = Basedpyright.parseOutput(DIR, output(1, REPORT));
      expect(result.warning[0].path).toBe('m.py');
    });
  });
});
