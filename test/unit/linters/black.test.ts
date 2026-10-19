import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import Black from '../../../src/linters/black';
import { describeVerifySetup, fixture, output, runMock } from './shared';

vi.mock('../../../src/utils/action', () => ({ run: vi.fn() }));
vi.mock('../../../src/utils/command-exists', () => ({ default: vi.fn() }));

const BLACK = fixture('black.diff');
const DIR = '/repo';

describe('Black', () => {
  it('has a linter name', () => {
    expect(Black.linterName).toBe('black');
  });

  describeVerifySetup(Black, {
    defaultPrefix: '',
    missingMessage: 'Python is not installed',
    requiredCommand: 'python',
    versionCommand: 'black --version'
  });

  describe('lint', () => {
    it('runs black --check --diff with an include regex', () => {
      const result = output(1, BLACK);
      runMock.mockReturnValue(result);
      expect(Black.lint(DIR, ['py', 'pyi'])).toBe(result);
      expect(runMock).toHaveBeenCalledExactlyOnceWith(
        String.raw` black --check --diff --include "^.*\.(py|pyi)$"  "."`,
        { dir: DIR, ignoreErrors: true }
      );
    });

    it('drops check flags when fixing and passes args and prefix', () => {
      runMock.mockReturnValue(output(0));
      Black.lint(DIR, ['py'], '-l 100', true, 'poetry run');
      expect(runMock).toHaveBeenCalledWith(
        String.raw`poetry run black  --include "^.*\.(py)$" -l 100 "."`,
        { dir: DIR, ignoreErrors: true }
      );
    });

    it('makes absolute diff header paths relative to dir', () => {
      const abs = path.join(DIR, 'pkg', 'app.py');
      runMock.mockReturnValue(
        output(1, `--- ${abs}\t2024-01-01\n+++ ${abs}\t2024-01-01\n@@ -1 +1 @@`)
      );
      const rel = path.join('pkg', 'app.py');
      expect(Black.lint(DIR, ['py']).stdout).toBe(
        `--- ${rel}\t2024-01-01\n+++ ${rel}\t2024-01-01\n@@ -1 +1 @@`
      );
    });
  });

  describe('parseOutput', () => {
    it('returns success for empty diff', () => {
      expect(Black.parseOutput(DIR, output(0, ''))).toEqual({
        error: [],
        isSuccess: true,
        warning: []
      });
    });

    it('fails on nonzero status without a diff', () => {
      expect(Black.parseOutput(DIR, output(123, '')).isSuccess).toBe(false);
    });

    it('creates one error per chunk joined with relativeDir', () => {
      expect(Black.parseOutput(DIR, output(1, BLACK), 'svc')).toEqual({
        error: [
          {
            firstLine: 1,
            lastLine: 5,
            message:
              '-x = {  \'a\':37,\'b\':42,\n-\'c\':927}\n+x = {"a": 37, "b": 42, "c": 927}\n \n def f(a):',
            path: 'svc/src/app.py'
          },
          {
            firstLine: 10,
            lastLine: 13,
            message:
              ' class User:\n-    name: str=None\n+    name: str = None\n     age: int',
            path: 'svc/pkg/models.py'
          }
        ],
        isSuccess: false,
        warning: []
      });
    });

    it('defaults relativeDir to "."', () => {
      expect(Black.parseOutput(DIR, output(1, BLACK)).error[1].path).toBe(
        'pkg/models.py'
      );
    });
  });
});
