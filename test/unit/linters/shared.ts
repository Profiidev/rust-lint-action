// Shared helpers for linter unit tests. Every test file importing this must mock
// `../../../src/utils/action` and `../../../src/utils/command-exists` itself (vi.mock is per file).
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { Linter } from '../../../src/linters';
import { run } from '../../../src/utils/action';
import commandExists from '../../../src/utils/command-exists';

export const runMock = vi.mocked(run);
export const commandExistsMock = vi.mocked(commandExists);

// Trimmed like `run` trims captured stdout
export const fixture = (name: string): string =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8').trim();

export const output = (status: number | null, stdout = '', stderr = '') => ({
  status,
  stderr,
  stdout
});

interface SetupSpec {
  /** Program checked via commandExists */
  requiredCommand: string;
  /** Error message thrown when the required command is missing */
  missingMessage: string;
  /** Version command without prefix, e.g. `eslint -v` */
  versionCommand: string;
  /** Prefix used when no custom prefix is configured */
  defaultPrefix: string;
}

export const describeVerifySetup = (linter: Linter, spec: SetupSpec) => {
  describe('verifySetup', () => {
    it(`throws when ${spec.requiredCommand} is missing`, async () => {
      commandExistsMock.mockResolvedValue(false);
      await expect(linter.verifySetup('/repo')).rejects.toThrow(
        spec.missingMessage
      );
      expect(commandExistsMock).toHaveBeenCalledWith(spec.requiredCommand);
      expect(runMock).not.toHaveBeenCalled();
    });

    it('throws "not installed" with the run error as cause', async () => {
      commandExistsMock.mockResolvedValue(true);
      const cause = new Error('command not found');
      runMock.mockImplementation(() => {
        throw cause;
      });
      const promise = linter.verifySetup('/repo');
      await expect(promise).rejects.toThrow(
        `${linter.linterName} is not installed`
      );
      await expect(promise).rejects.toHaveProperty('cause', cause);
    });

    it('runs the version command with the default prefix', async () => {
      commandExistsMock.mockResolvedValue(true);
      runMock.mockReturnValue(output(0, '1.0.0'));
      await expect(linter.verifySetup('/repo')).resolves.toBeUndefined();
      expect(runMock).toHaveBeenCalledExactlyOnceWith(
        `${spec.defaultPrefix} ${spec.versionCommand}`,
        { dir: '/repo' }
      );
    });

    it('runs the version command with a custom prefix', async () => {
      commandExistsMock.mockResolvedValue(true);
      runMock.mockReturnValue(output(0, '1.0.0'));
      await linter.verifySetup('/repo', 'pnpm exec');
      expect(runMock).toHaveBeenCalledExactlyOnceWith(
        `pnpm exec ${spec.versionCommand}`,
        { dir: '/repo' }
      );
    });
  });
};
