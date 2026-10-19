import checkForCommand from 'command-exists';
import { describe, expect, it, vi } from 'vitest';
import commandExists from '../../../src/utils/command-exists';

vi.mock('command-exists', () => ({ default: vi.fn() }));

const check = vi.mocked(checkForCommand) as unknown as ReturnType<typeof vi.fn>;

describe('commandExists', () => {
  it('returns true when the command resolves', async () => {
    check.mockResolvedValue('cargo');
    await expect(commandExists('cargo')).resolves.toBe(true);
    expect(check).toHaveBeenCalledWith('cargo');
  });

  it('returns false when the command rejects', async () => {
    check.mockRejectedValue(null);
    await expect(commandExists('nope')).resolves.toBe(false);
  });

  it('returns false when the check throws synchronously', async () => {
    check.mockImplementation(() => {
      throw new Error('bad');
    });
    await expect(commandExists('nope')).resolves.toBe(false);
  });
});
