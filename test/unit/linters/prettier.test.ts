import { describe, expect, it, vi } from 'vitest';
import Prettier from '../../../src/linters/prettier';
import { describeVerifySetup, fixture, output, runMock } from './shared';

vi.mock('../../../src/utils/action', () => ({ run: vi.fn() }));
vi.mock('../../../src/utils/command-exists', () => ({ default: vi.fn() }));

const PRETTIER_CHECK_CLEAN_STDOUT = fixture('prettier-check-clean.stdout.txt');
const PRETTIER_CHECK_DIRTY_STDERR = fixture('prettier-check-dirty.stderr.txt');
const PRETTIER_CHECK_DIRTY_STDOUT = fixture('prettier-check-dirty.stdout.txt');
const DIR = '/repo';
const MESSAGE =
  "There are issues with this file's formatting, please run Prettier to fix the errors";
const issue = (path: string) => ({
  firstLine: 1,
  lastLine: 1,
  message: MESSAGE,
  path
});

describe('Prettier', () => {
  it('has a linter name', () => {
    expect(Prettier.linterName).toBe('prettier');
  });

  describeVerifySetup(Prettier, {
    defaultPrefix: 'npx --no-install',
    missingMessage: 'NPM is not installed',
    requiredCommand: 'npm',
    versionCommand: 'prettier -v'
  });

  describe('lint', () => {
    it('runs prettier --check with a glob of the extensions', () => {
      const result = output(0);
      runMock.mockReturnValue(result);
      expect(Prettier.lint(DIR, ['ts', 'json'])).toBe(result);
      expect(runMock).toHaveBeenCalledExactlyOnceWith(
        'npx --no-install prettier --check "**/*.{ts,json}" ',
        { dir: DIR, ignoreErrors: true }
      );
    });

    it('runs prettier --write with args and custom prefix when fixing', () => {
      runMock.mockReturnValue(output(0));
      Prettier.lint(DIR, ['md'], '--no-semi', true, 'pnpm exec');
      expect(runMock).toHaveBeenCalledWith(
        'pnpm exec prettier --write "**/*.{md}" --no-semi',
        { dir: DIR, ignoreErrors: true }
      );
    });
  });

  describe('parseOutput', () => {
    it('returns success for a clean run, ignoring stdout', () => {
      expect(
        Prettier.parseOutput(DIR, output(0, PRETTIER_CHECK_CLEAN_STDOUT))
      ).toEqual({ error: [], isSuccess: true, warning: [] });
    });

    it('fails on nonzero status without [warn] lines', () => {
      expect(
        Prettier.parseOutput(DIR, output(2, '', '[error] No files matching'))
      ).toEqual({ error: [], isSuccess: false, warning: [] });
    });

    it('parses unformatted files from stderr (real output)', () => {
      expect(
        Prettier.parseOutput(
          DIR,
          output(1, PRETTIER_CHECK_DIRTY_STDOUT, PRETTIER_CHECK_DIRTY_STDERR)
        )
      ).toEqual({
        error: [issue('bad.ts'), issue('t.ts'), issue('tsconfig.json')],
        isSuccess: false,
        warning: []
      });
    });

    it('handles CRLF, surrounding whitespace and empty [warn] lines', () => {
      const stderr =
        '[warn]  src/a b.ts  \r\n[warn] \r\nnoise\r\n[warn] Code style issues found in the above file. Run Prettier with --write to fix.';
      expect(Prettier.parseOutput(DIR, output(1, '', stderr)).error).toEqual([
        issue('src/a b.ts')
      ]);
    });
  });
});
