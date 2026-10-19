import { describe, expect, it, vi } from 'vitest';
import Autopep8 from '../../../src/linters/autopep8';
import { describeVerifySetup, fixture, output, runMock } from './shared';

vi.mock('../../../src/utils/action', () => ({ run: vi.fn() }));
vi.mock('../../../src/utils/command-exists', () => ({ default: vi.fn() }));

const DIR = '/repo';
const RAW_DIFF = fixture('autopep8.diff');
const NORMALIZED_DIFF = RAW_DIFF.replaceAll('original/./', '').replaceAll(
  'fixed/./',
  ''
);

describe('Autopep8', () => {
  it('has a linter name', () => {
    expect(Autopep8.linterName).toBe('autopep8');
  });

  describeVerifySetup(Autopep8, {
    defaultPrefix: '',
    missingMessage: 'Python is not installed',
    requiredCommand: 'python',
    versionCommand: 'autopep8 --version'
  });

  describe('lint', () => {
    it('runs autopep8 in diff mode and rewrites diff headers', () => {
      runMock.mockReturnValue(output(2, RAW_DIFF, ''));
      const result = Autopep8.lint(DIR, ['py']);
      expect(runMock).toHaveBeenCalledExactlyOnceWith(
        ' autopep8 -d --exit-code  -r "."',
        { dir: DIR, ignoreErrors: true }
      );
      expect(result).toEqual(output(2, NORMALIZED_DIFF, ''));
      expect(result.stdout).toContain('--- src/app.py\n+++ src/app.py');
    });

    it('rewrites Windows style headers', () => {
      runMock.mockReturnValue(
        output(2, '--- original/.\\src\\a.py\n+++ fixed/.\\src\\a.py')
      );
      expect(Autopep8.lint(DIR, ['py']).stdout).toBe(
        '--- src\\a.py\n+++ src\\a.py'
      );
    });

    it('runs in-place with args and prefix when fixing', () => {
      runMock.mockReturnValue(output(0));
      expect(
        Autopep8.lint(DIR, ['py'], '--aggressive', true, 'poetry run')
      ).toEqual(output(0));
      expect(runMock).toHaveBeenCalledWith(
        'poetry run autopep8 -i --aggressive -r "."',
        { dir: DIR, ignoreErrors: true }
      );
    });
  });

  describe('parseOutput', () => {
    it('returns success for empty diff', () => {
      expect(Autopep8.parseOutput(DIR, output(0, ''))).toEqual({
        error: [],
        isSuccess: true,
        warning: []
      });
    });

    it('fails on nonzero status without a diff', () => {
      expect(Autopep8.parseOutput(DIR, output(1, '')).isSuccess).toBe(false);
    });

    it('creates one error per chunk joined with relativeDir', () => {
      expect(
        Autopep8.parseOutput(DIR, output(2, NORMALIZED_DIFF), 'svc')
      ).toEqual({
        error: [
          {
            firstLine: 1,
            lastLine: 5,
            message: ' import os\n-def f( a ):\n+def f(a):\n     return a\n ',
            path: 'svc/src/app.py'
          },
          {
            firstLine: 5,
            lastLine: 7,
            message: '-x=1\n+x = 1\n y = 2',
            path: 'svc/pkg/models.py'
          }
        ],
        isSuccess: false,
        warning: []
      });
    });

    it('defaults relativeDir to "."', () => {
      expect(
        Autopep8.parseOutput(DIR, output(2, NORMALIZED_DIFF)).error[0].path
      ).toBe('src/app.py');
    });
  });
});
