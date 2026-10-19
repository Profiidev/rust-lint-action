import { describe, expect, it, vi } from 'vitest';
import Ruff from '../../../src/linters/ruff';
import { describeVerifySetup, fixture, output, runMock } from './shared';

vi.mock('../../../src/utils/action', () => ({ run: vi.fn() }));
vi.mock('../../../src/utils/command-exists', () => ({ default: vi.fn() }));

const RUFF_GITLAB = fixture('ruff-gitlab.json');
const DIR = '/repo';
const MESSAGE = 'unformatted: File would be reformatted';

describe('Ruff', () => {
  it('has a linter name', () => {
    expect(Ruff.linterName).toBe('ruff');
  });

  describeVerifySetup(Ruff, {
    defaultPrefix: '',
    missingMessage: 'Python is not installed',
    requiredCommand: 'python',
    versionCommand: 'ruff --version'
  });

  describe('lint', () => {
    it('runs ruff format --check with gitlab output', () => {
      const result = output(0, '[]');
      runMock.mockReturnValue(result);
      expect(Ruff.lint(DIR, ['py'])).toBe(result);
      expect(runMock).toHaveBeenCalledExactlyOnceWith(
        ' ruff format --preview --output-format gitlab --check ',
        { dir: DIR, ignoreErrors: true }
      );
    });

    it('drops --check when fixing and passes args and prefix', () => {
      runMock.mockReturnValue(output(0, '[]'));
      Ruff.lint(DIR, ['py'], 'src', true, 'uv run');
      expect(runMock).toHaveBeenCalledWith(
        'uv run ruff format --preview --output-format gitlab  src',
        { dir: DIR, ignoreErrors: true }
      );
    });
  });

  describe('parseOutput', () => {
    it('treats empty stdout as an empty report', () => {
      expect(Ruff.parseOutput(DIR, output(0, ''))).toEqual({
        error: [],
        isSuccess: true,
        warning: []
      });
      expect(Ruff.parseOutput(DIR, output(2, '')).isSuccess).toBe(false);
    });

    it('maps major issues to errors joined with relativeDir', () => {
      expect(Ruff.parseOutput(DIR, output(1, RUFF_GITLAB), 'api')).toEqual({
        error: [
          {
            firstLine: 1,
            lastLine: 4,
            message: MESSAGE,
            path: 'api/src/app.py'
          },
          {
            firstLine: 12,
            lastLine: 15,
            message: MESSAGE,
            path: 'api/pkg/models.py'
          }
        ],
        isSuccess: false,
        warning: []
      });
    });

    it('maps non-major issues to warnings with default relativeDir', () => {
      const stdout = JSON.stringify([
        {
          description: 'minor issue',
          location: {
            path: 'a.py',
            positions: { begin: { line: 3 }, end: { line: 3 } }
          },
          severity: 'minor'
        }
      ]);
      expect(Ruff.parseOutput(DIR, output(0, stdout))).toEqual({
        error: [],
        isSuccess: true,
        warning: [
          { firstLine: 3, lastLine: 3, message: 'minor issue', path: 'a.py' }
        ]
      });
    });
  });
});
