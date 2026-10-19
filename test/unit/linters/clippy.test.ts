import { afterEach, describe, expect, it, vi } from 'vitest';
import Clippy from '../../../src/linters/clippy';
import { describeVerifySetup, fixture, output, runMock } from './shared';

vi.mock('../../../src/utils/action', () => ({ run: vi.fn() }));
vi.mock('../../../src/utils/command-exists', () => ({ default: vi.fn() }));

const CLIPPY_ERRORS = fixture('clippy-errors.jsonl');
const CLIPPY_MIXED = fixture('clippy-mixed.jsonl');
const CLIPPY_WARNINGS = fixture('clippy-warnings.jsonl');
const summaryLine = (level: string, message: string) =>
  JSON.stringify({
    message: { code: null, level, message, spans: [] },
    reason: 'compiler-message'
  });

describe('Clippy', () => {
  it('has a linter name', () => {
    expect(Clippy.linterName).toBe('clippy');
  });

  describeVerifySetup(Clippy, {
    defaultPrefix: '',
    missingMessage: 'cargo is not installed',
    requiredCommand: 'cargo',
    versionCommand: 'cargo clippy --version'
  });

  describe('lint', () => {
    it('throws when extensions are not exactly ["rs"]', () => {
      const msg = 'clippy error: File extensions are not configurable';
      expect(() => Clippy.lint('/repo', ['rs', 'toml'])).toThrow(msg);
      expect(() => Clippy.lint('/repo', ['toml'])).toThrow(msg);
      expect(() => Clippy.lint('/repo', [])).toThrow(msg);
      expect(runMock).not.toHaveBeenCalled();
    });

    it('runs clippy without fix and returns run output', () => {
      const result = output(0, '{}');
      runMock.mockReturnValue(result);
      expect(Clippy.lint('/repo', ['rs'])).toBe(result);
      expect(runMock).toHaveBeenCalledExactlyOnceWith(
        ' cargo clippy  --message-format json ',
        { dir: '/repo', ignoreErrors: true }
      );
    });

    it('removes --allow-dirty when not fixing', () => {
      runMock.mockReturnValue(output(0));
      Clippy.lint('/repo', ['rs'], '--allow-dirty -- -D warnings', false, 'p');
      expect(runMock).toHaveBeenCalledWith(
        'p cargo clippy  --message-format json  -- -D warnings',
        { dir: '/repo', ignoreErrors: true }
      );
    });

    it('keeps --allow-dirty and adds --fix when fixing', () => {
      runMock.mockReturnValue(output(0));
      Clippy.lint('/repo', ['rs'], '--allow-dirty', true, 'p');
      expect(runMock).toHaveBeenCalledWith(
        'p cargo clippy --fix --message-format json --allow-dirty',
        { dir: '/repo', ignoreErrors: true }
      );
    });
  });

  describe('parseOutput', () => {
    const originalPlatform = process.platform;
    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('reports success for a clean build', () => {
      const stdout = '{"reason":"build-finished","success":true}';
      expect(Clippy.parseOutput('/repo', output(0, stdout))).toEqual({
        error: [],
        isSuccess: true,
        warning: []
      });
    });

    it('parses warnings only', () => {
      const result = Clippy.parseOutput('/repo', output(0, CLIPPY_WARNINGS));
      expect(result).toEqual({
        error: [],
        isSuccess: false,
        warning: [
          {
            firstLine: 6,
            lastLine: 6,
            message: 'length comparison to zero',
            path: 'src/main.rs'
          }
        ]
      });
    });

    it('puts errors into error and ignores failure notes', () => {
      const result = Clippy.parseOutput('/repo', output(101, CLIPPY_ERRORS));
      expect(result).toEqual({
        error: [
          {
            firstLine: 2,
            lastLine: 2,
            message: 'mismatched types',
            path: 'src/main.rs'
          }
        ],
        isSuccess: false,
        warning: []
      });
    });

    it('splits mixed errors and warnings', () => {
      const result = Clippy.parseOutput('/repo', output(101, CLIPPY_MIXED));
      expect(result.error).toEqual([
        {
          firstLine: 4,
          lastLine: 4,
          message: 'equal expressions as operands to `==`',
          path: 'src/main.rs'
        }
      ]);
      expect(result.warning).toEqual([
        {
          firstLine: 6,
          lastLine: 6,
          message: 'length comparison to zero',
          path: 'src/main.rs'
        }
      ]);
      expect(result.isSuccess).toBe(false);
    });

    it('ignores summary lines with code null and skips blank lines', () => {
      const stdout = [
        summaryLine('warning', '1 warning emitted'),
        '',
        '   ',
        summaryLine('error', 'aborting due to 1 previous error'),
        '{"reason":"build-finished","success":false}',
        ''
      ].join('\n');
      expect(Clippy.parseOutput('/repo', output(0, stdout))).toEqual({
        error: [],
        isSuccess: true,
        warning: []
      });
    });

    it('fails on nonzero status without parsed issues', () => {
      const stdout = summaryLine('error', 'could not compile `app`');
      expect(Clippy.parseOutput('/repo', output(101, stdout)).isSuccess).toBe(
        false
      );
    });

    it('fails on empty stdout with nonzero status', () => {
      expect(Clippy.parseOutput('/repo', output(null, ''))).toEqual({
        error: [],
        isSuccess: false,
        warning: []
      });
    });

    it('throws with cause on invalid JSON', () => {
      let thrown: unknown = undefined;
      try {
        Clippy.parseOutput('/repo', output(101, 'error: not json'));
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toMatch(
        /^Error parsing clippy JSON output: .+\. Output: "error: not json"$/u
      );
      expect((thrown as Error).cause).toBeInstanceOf(SyntaxError);
    });

    it('parses raw JSON with escaped quotes and paths on win32', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      // Real cargo line: the rendered field contains escaped quotes (`println!(\"{}\", y)`)
      expect(CLIPPY_MIXED).toContain(String.raw`\"{}\"`);
      const windowsLine = String.raw`{"reason":"compiler-message","message":{"code":{"code":"clippy::len_zero"},"level":"warning","message":"length comparison to zero","rendered":"warning: \"x\"","spans":[{"file_name":"src\\main.rs","line_start":3,"line_end":4}]}}`;
      const result = Clippy.parseOutput(
        String.raw`C:\repo`,
        output(101, `${CLIPPY_MIXED}\n${windowsLine}`)
      );
      expect(result.error).toHaveLength(1);
      expect(result.warning).toEqual([
        {
          firstLine: 6,
          lastLine: 6,
          message: 'length comparison to zero',
          path: 'src/main.rs'
        },
        {
          firstLine: 3,
          lastLine: 4,
          message: 'length comparison to zero',
          path: String.raw`src\main.rs`
        }
      ]);
    });
  });
});
