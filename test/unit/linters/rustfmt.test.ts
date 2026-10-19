import { describe, expect, it, vi } from 'vitest';
import RustFmt from '../../../src/linters/rustfmt';
import { commandExistsMock, fixture, output, runMock } from './shared';

vi.mock('../../../src/utils/action', () => ({ run: vi.fn() }));
vi.mock('../../../src/utils/command-exists', () => ({ default: vi.fn() }));

const RUSTFMT_CHECK = fixture('rustfmt-check.txt');
const DIR = '/home/runner/work/app';

describe('RustFmt', () => {
  it('has a linter name', () => {
    expect(RustFmt.linterName).toBe('rustfmt');
  });

  describe('verifySetup', () => {
    it('throws when cargo-fmt is missing', async () => {
      commandExistsMock.mockResolvedValue(false);
      await expect(RustFmt.verifySetup(DIR)).rejects.toThrow(
        'Cargo format is not installed'
      );
      expect(commandExistsMock).toHaveBeenCalledWith('cargo-fmt');
    });

    it('resolves without running anything when cargo-fmt exists', async () => {
      commandExistsMock.mockResolvedValue(true);
      await expect(RustFmt.verifySetup(DIR, 'prefix')).resolves.toBeUndefined();
      expect(runMock).not.toHaveBeenCalled();
    });
  });

  describe('lint', () => {
    it('throws when extensions are not exactly ["rs"]', () => {
      const msg = 'rustfmt error: File extensions are not configurable';
      expect(() => RustFmt.lint(DIR, ['rs', 'toml'])).toThrow(msg);
      expect(() => RustFmt.lint(DIR, ['toml'])).toThrow(msg);
      expect(runMock).not.toHaveBeenCalled();
    });

    it('runs cargo fmt --check with default args', () => {
      const result = output(1, 'Diff in');
      runMock.mockReturnValue(result);
      expect(RustFmt.lint(DIR, ['rs'])).toBe(result);
      expect(runMock).toHaveBeenCalledExactlyOnceWith(
        ' cargo fmt --check -- --color=never',
        { dir: DIR, ignoreErrors: true }
      );
    });

    it('runs cargo fmt without --check when fixing, with prefix and args', () => {
      runMock.mockReturnValue(output(0));
      RustFmt.lint(DIR, ['rs'], '--all', true, 'nix develop -c');
      expect(runMock).toHaveBeenCalledWith('nix develop -c cargo fmt  --all', {
        dir: DIR,
        ignoreErrors: true
      });
    });
  });

  describe('parseOutput', () => {
    it('returns success on empty stdout', () => {
      expect(RustFmt.parseOutput(DIR, output(0, ''))).toEqual({
        error: [],
        isSuccess: true,
        warning: []
      });
    });

    it('fails on nonzero status with empty stdout', () => {
      expect(RustFmt.parseOutput(DIR, output(1, '')).isSuccess).toBe(false);
    });

    it('parses each diff chunk with a path relative to dir', () => {
      const result = RustFmt.parseOutput(DIR, output(1, RUSTFMT_CHECK));
      expect(result).toEqual({
        error: [
          {
            firstLine: 1,
            lastLine: 1,
            message: [
              '',
              ' fn main() {',
              '-    let   y : i32= 3;',
              '+    let y: i32 = 3;',
              '     println!("{}", y);',
              ' }',
              ' ',
              ''
            ].join('\n'),
            path: 'src/main.rs'
          },
          {
            firstLine: 6,
            lastLine: 6,
            message: [
              '',
              '-fn helper( a:i32)->i32{ a }',
              '+fn helper(a: i32) -> i32 {',
              '+    a',
              '+}'
            ].join('\n'),
            path: 'src/main.rs'
          }
        ],
        isSuccess: false,
        warning: []
      });
    });

    it('keeps paths outside of dir as printed', () => {
      const stdout = 'Diff in /home/runner/work/other/src/lib.rs:3:\n-a\n+b';
      expect(RustFmt.parseOutput(DIR, output(1, stdout)).error[0].path).toBe(
        '/home/runner/work/other/src/lib.rs'
      );
    });

    it('skips chunks that do not match the expected header', () => {
      const stdout = [
        'Diff in garbage without line number',
        `Diff in ${DIR}/src/lib.rs:7:`,
        '-x',
        '+y'
      ].join('\n');
      expect(RustFmt.parseOutput(DIR, output(1, stdout)).error).toEqual([
        { firstLine: 7, lastLine: 7, message: '\n-x\n+y', path: 'src/lib.rs' }
      ]);
    });

    it('ignores output without any diff header', () => {
      expect(
        RustFmt.parseOutput(DIR, output(1, 'error: could not find Cargo.toml'))
      ).toEqual({ error: [], isSuccess: false, warning: [] });
    });
  });
});
