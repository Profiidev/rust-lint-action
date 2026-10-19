import { describe, expect, it, vi } from 'vitest';
import OxFmt from '../../../src/linters/oxfmt';
import { describeVerifySetup, fixture, output, runMock } from './shared';

vi.mock('../../../src/utils/action', () => ({ run: vi.fn() }));
vi.mock('../../../src/utils/command-exists', () => ({ default: vi.fn() }));

const OXFMT_CHECK = fixture('oxfmt-check.txt');
const DIR = '/repo';
const issue = (path: string) => ({
  firstLine: 1,
  lastLine: 1,
  message:
    "There are issues with this file's formatting, please run oxfmt to fix the errors",
  path
});

describe('OxFmt', () => {
  it('has a linter name', () => {
    expect(OxFmt.linterName).toBe('oxfmt');
  });

  describeVerifySetup(OxFmt, {
    defaultPrefix: 'npx --no-install',
    missingMessage: 'npm is not installed',
    requiredCommand: 'npm',
    versionCommand: 'oxfmt --version'
  });

  describe('lint', () => {
    it('runs oxfmt --check with the default prefix', () => {
      const result = output(0);
      runMock.mockReturnValue(result);
      expect(OxFmt.lint(DIR, ['ts'])).toBe(result);
      expect(runMock).toHaveBeenCalledExactlyOnceWith(
        'npx --no-install oxfmt --check ',
        { dir: DIR, ignoreErrors: true }
      );
    });

    it('drops --check when fixing and passes args and prefix', () => {
      runMock.mockReturnValue(output(0));
      OxFmt.lint(DIR, ['ts'], 'src', true, 'pnpm exec');
      expect(runMock).toHaveBeenCalledWith('pnpm exec oxfmt  src', {
        dir: DIR,
        ignoreErrors: true
      });
    });
  });

  describe('parseOutput', () => {
    it('returns early on success', () => {
      const stdout =
        'Checking formatting...\n\nAll matched files use the correct format.\nFinished in 5ms on 4 files using 20 threads.';
      expect(OxFmt.parseOutput(DIR, output(0, stdout))).toEqual({
        error: [],
        isSuccess: true,
        warning: []
      });
    });

    it('returns early on failure with empty stdout', () => {
      expect(OxFmt.parseOutput(DIR, output(2, ''))).toEqual({
        error: [],
        isSuccess: false,
        warning: []
      });
    });

    it('filters progress/summary lines and reports file paths', () => {
      expect(OxFmt.parseOutput(DIR, output(1, OXFMT_CHECK))).toEqual({
        error: [issue('bad.ts'), issue('t.ts'), issue('tsconfig.json')],
        isSuccess: false,
        warning: []
      });
    });

    it('handles CRLF line endings', () => {
      expect(
        OxFmt.parseOutput(
          DIR,
          output(1, 'Checking formatting...\r\na.ts (1ms)\r\n')
        ).error
      ).toEqual([issue('a.ts')]);
    });
  });
});
