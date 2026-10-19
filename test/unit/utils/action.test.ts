import { execFileSync, execSync } from 'node:child_process';
import * as core from '@actions/core';
import { describe, expect, it, vi } from 'vitest';
import { getEnv, git, run } from '../../../src/utils/action';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
  execSync: vi.fn()
}));
vi.mock('@actions/core', () => ({ debug: vi.fn() }));

const exec = vi.mocked(execSync);
const execFile = vi.mocked(execFileSync);

describe('getEnv', () => {
  it('reads the uppercased variable', () => {
    vi.stubEnv('LINT_TEST_VAR', 'value');
    expect(getEnv('lint_test_var')).toBe('value');
  });

  it('returns undefined for a missing optional variable', () => {
    expect(getEnv('lint_test_missing')).toBeUndefined();
  });

  it('throws for a missing required variable', () => {
    expect(() => getEnv('lint_test_missing', true)).toThrow(
      'Environment variable "LINT_TEST_MISSING" is not defined'
    );
  });

  it('returns an empty string as is when required', () => {
    vi.stubEnv('LINT_TEST_EMPTY', '');
    expect(getEnv('lint_test_empty', true)).toBe('');
  });
});

describe('run', () => {
  it('trims stdout and passes default options', () => {
    exec.mockReturnValue('  out\n');
    expect(run('echo out')).toEqual({ status: 0, stderr: '', stdout: 'out' });
    expect(exec).toHaveBeenCalledWith('echo out', {
      cwd: undefined,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024
    });
  });

  it('passes dir as cwd', () => {
    exec.mockReturnValue('');
    run('ls', { dir: '/some/dir' });
    expect(exec.mock.calls[0][1]).toMatchObject({ cwd: '/some/dir' });
  });

  it('maps a null dir to undefined cwd', () => {
    exec.mockReturnValue('');
    run('ls', { dir: null });
    expect(exec.mock.calls[0][1]).toMatchObject({ cwd: undefined });
  });

  it('rethrows without ignoreErrors', () => {
    const error = Object.assign(new Error('boom'), { status: 1 });
    exec.mockImplementation(() => {
      throw error;
    });
    expect(() => run('false')).toThrow(error);
  });

  it('returns trimmed output with ignoreErrors', () => {
    exec.mockImplementation(() => {
      throw Object.assign(new Error('boom'), {
        status: 2,
        stderr: Buffer.from(' err \n'),
        stdout: ' out \n'
      });
    });
    expect(run('false', { ignoreErrors: true })).toEqual({
      status: 2,
      stderr: 'err',
      stdout: 'out'
    });
  });

  it('handles missing stdout/stderr and a null status', () => {
    exec.mockImplementation(() => {
      throw Object.assign(new Error('killed'), { status: null });
    });
    expect(run('sleep', { ignoreErrors: true })).toEqual({
      status: null,
      stderr: '',
      stdout: ''
    });
  });
});

describe('git', () => {
  it('runs git without a shell and trims stdout', () => {
    execFile.mockReturnValue(' abc \n');
    const args = ['commit', '-m', 'a "b" $(touch x) `id`'];
    expect(git(args)).toEqual({ status: 0, stderr: '', stdout: 'abc' });
    expect(execFile).toHaveBeenCalledWith('git', args, {
      cwd: undefined,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024
    });
    expect(exec).not.toHaveBeenCalled();
    expect(core.debug).toHaveBeenCalledWith(
      'git commit -m a "b" $(touch x) `id`'
    );
  });

  it('passes dir as cwd', () => {
    execFile.mockReturnValue('');
    git(['status'], { dir: '/repo' });
    expect(execFile.mock.calls[0][2]).toMatchObject({ cwd: '/repo' });
  });

  it('rethrows without ignoreErrors', () => {
    const error = Object.assign(new Error('fatal'), { status: 128 });
    execFile.mockImplementation(() => {
      throw error;
    });
    expect(() => git(['push'])).toThrow(error);
  });

  it('returns trimmed output with ignoreErrors', () => {
    execFile.mockImplementation(() => {
      throw Object.assign(new Error('diff'), {
        status: 1,
        stderr: ' e \n',
        stdout: Buffer.from(' o \n')
      });
    });
    expect(git(['diff'], { ignoreErrors: true })).toEqual({
      status: 1,
      stderr: 'e',
      stdout: 'o'
    });
  });
});
