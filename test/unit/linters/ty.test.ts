import { describe, expect, it, vi } from 'vitest';
import TY from '../../../src/linters/ty';
import { describeVerifySetup, fixture, output, runMock } from './shared';

vi.mock('../../../src/utils/action', () => ({ run: vi.fn() }));
vi.mock('../../../src/utils/command-exists', () => ({ default: vi.fn() }));

const TY_GITLAB = fixture('ty-gitlab.json');
const DIR = '/repo';

describe('TY', () => {
  it('has a linter name', () => {
    expect(TY.linterName).toBe('ty');
  });

  describeVerifySetup(TY, {
    defaultPrefix: '',
    missingMessage: 'Python is not installed',
    requiredCommand: 'python',
    versionCommand: 'ty --version'
  });

  describe('lint', () => {
    it('runs ty check with gitlab output', () => {
      const result = output(0, '[]');
      runMock.mockReturnValue(result);
      expect(TY.lint(DIR, ['py'])).toBe(result);
      expect(runMock).toHaveBeenCalledExactlyOnceWith(
        ' ty check --output-format gitlab  ',
        { dir: DIR, ignoreErrors: true }
      );
    });

    it('adds --fix, args and prefix', () => {
      runMock.mockReturnValue(output(0, '[]'));
      TY.lint(DIR, ['py'], 'src', true, 'uvx');
      expect(runMock).toHaveBeenCalledWith(
        'uvx ty check --output-format gitlab --fix src',
        { dir: DIR, ignoreErrors: true }
      );
    });
  });

  describe('parseOutput', () => {
    it('treats empty stdout as an empty report', () => {
      expect(TY.parseOutput(DIR, output(0, ''))).toEqual({
        error: [],
        isSuccess: true,
        warning: []
      });
    });

    it('fails on nonzero status without issues', () => {
      expect(TY.parseOutput(DIR, output(2, '[]'))).toEqual({
        error: [],
        isSuccess: false,
        warning: []
      });
    });

    it('maps major to error, others to warning, joined with relativeDir', () => {
      expect(TY.parseOutput(DIR, output(1, TY_GITLAB), 'backend')).toEqual({
        error: [
          {
            firstLine: 2,
            lastLine: 2,
            message:
              'invalid-assignment: Object of type `Literal["a"]` is not assignable to `int`',
            path: 'backend/src/app.py'
          }
        ],
        isSuccess: false,
        warning: [
          {
            firstLine: 7,
            lastLine: 7,
            message:
              'unused-ignore-comment: Unused blanket `type: ignore` directive',
            path: 'backend/src/util.py'
          }
        ]
      });
    });

    it('defaults relativeDir to "."', () => {
      expect(TY.parseOutput(DIR, output(1, TY_GITLAB)).error[0].path).toBe(
        'src/app.py'
      );
    });
  });
});
