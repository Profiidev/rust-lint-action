import { describe, expect, it, vi } from 'vitest';
import Svelte from '../../../src/linters/svelte';
import { describeVerifySetup, fixture, output, runMock } from './shared';

vi.mock('../../../src/utils/action', () => ({ run: vi.fn() }));
vi.mock('../../../src/utils/command-exists', () => ({ default: vi.fn() }));

const SVELTE_CHECK = fixture('svelte-check.txt');
const DIR = '/home/runner/work/app';

describe('Svelte', () => {
  it('has a linter name', () => {
    expect(Svelte.linterName).toBe('svelte');
  });

  // Setup uses `npx -y`, lint uses `npx --no-install`
  describeVerifySetup(Svelte, {
    defaultPrefix: 'npx -y',
    missingMessage: 'NPM is not installed',
    requiredCommand: 'npm',
    versionCommand: 'sv -v'
  });

  describe('lint', () => {
    it('runs sv check with the default --no-install prefix', () => {
      const result = output(0);
      runMock.mockReturnValue(result);
      expect(Svelte.lint(DIR, ['svelte'])).toBe(result);
      expect(runMock).toHaveBeenCalledExactlyOnceWith(
        'npx --no-install sv check --output machine-verbose ',
        { dir: DIR, ignoreErrors: true }
      );
    });

    it('passes args and custom prefix, ignoring fix', () => {
      runMock.mockReturnValue(output(0));
      Svelte.lint(DIR, ['svelte'], '--threshold error', true, 'pnpm exec');
      expect(runMock).toHaveBeenCalledWith(
        'pnpm exec sv check --output machine-verbose --threshold error',
        { dir: DIR, ignoreErrors: true }
      );
    });
  });

  describe('parseOutput', () => {
    it('returns status based result on empty stdout', () => {
      expect(Svelte.parseOutput(DIR, output(0, ''))).toEqual({
        error: [],
        isSuccess: true,
        warning: []
      });
      expect(Svelte.parseOutput(DIR, output(1, '')).isSuccess).toBe(false);
    });

    it('strips the timestamp, drops non-JSON lines and maps ERROR/WARNING', () => {
      // Svelte-check emits 0-based LSP positions, converted to 1-based lines
      expect(Svelte.parseOutput(DIR, output(1, SVELTE_CHECK))).toEqual({
        error: [
          {
            firstLine: 4,
            lastLine: 4,
            message: "Type 'number' is not assignable to type 'string'.",
            path: 'src/routes/+page.svelte'
          },
          {
            firstLine: 1,
            lastLine: 1,
            message:
              "Module '\"svelte/store\"' has no exported member 'wrtable'.",
            path: 'src/lib/store.ts'
          }
        ],
        isSuccess: false,
        warning: [
          {
            firstLine: 11,
            lastLine: 13,
            message:
              '`<div>` with a click handler must have an ARIA role\nhttps://svelte.dev/e/a11y_no_static_element_interactions',
            path: 'src/lib/Button.svelte'
          }
        ]
      });
    });

    it('reports warnings only as failure', () => {
      const stdout =
        '1 {"type":"WARNING","filename":"a.svelte","start":{"line":1,"character":0},"end":{"line":2,"character":0},"message":"w"}';
      const result = Svelte.parseOutput(DIR, output(0, stdout));
      expect(result.isSuccess).toBe(false);
      expect(result.error).toEqual([]);
      expect(result.warning).toEqual([
        { firstLine: 2, lastLine: 3, message: 'w', path: 'a.svelte' }
      ]);
    });

    it('overrides a nonzero status to success when no issues are parsed', () => {
      const stdout = [
        '1702046600243 START "/home/runner/work/app"',
        '1702046600299 COMPLETED 12 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS',
        '1702046600300 {"type":"HINT","filename":"a.svelte"}'
      ].join('\n');
      expect(Svelte.parseOutput(DIR, output(1, stdout))).toEqual({
        error: [],
        isSuccess: true,
        warning: []
      });
    });
  });
});
