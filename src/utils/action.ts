import { execFileSync, execSync } from 'node:child_process';
import * as core from '@actions/core';

interface RunOptions {
  dir?: string | null;
  ignoreErrors?: boolean;
  prefix?: string;
}

const RUN_OPTIONS_DEFAULTS: RunOptions = {
  dir: undefined,
  ignoreErrors: false,
  prefix: ''
};

/**
 * Returns the value for an environment variable. If the variable is required but doesn't have a
 * value, an error is thrown
 * @param {string} name - Name of the environment variable
 * @param {boolean} required - Whether an error should be thrown if the variable doesn't have a
 * value
 * @returns {string | null} - Value of the environment variable
 */
export const getEnv = (name: string, required = false): string | undefined => {
  const nameUppercase = name.toUpperCase();
  const value = process.env[nameUppercase];
  if (value === undefined) {
    // Value is either not set (`undefined`) or set to `null`
    if (required) {
      throw new Error(`Environment variable "${nameUppercase}" is not defined`);
    }
    return undefined;
  }
  return value;
};

interface RunOutput {
  status: number | null;
  stdout: string;
  stderr: string;
}

const execute = (
  label: string,
  exec: (cwd: string | undefined) => string,
  options?: RunOptions
): RunOutput => {
  const optionsWithDefaults = {
    ...RUN_OPTIONS_DEFAULTS,
    ...options
  };

  core.debug(label);

  try {
    const stdout = exec(optionsWithDefaults.dir || undefined);
    const output = {
      status: 0,
      stderr: '',
      stdout: stdout.trim()
    };

    core.debug(`Stdout: ${output.stdout}`);

    return output;
  } catch (error: any) {
    if (optionsWithDefaults.ignoreErrors) {
      const output = {
        status: error.status as number | null, // oxlint-disable-line no-unsafe-type-assertion
        stderr: (error.stderr || '').toString().trim(),
        stdout: (error.stdout || '').toString().trim()
      };

      core.debug(`Exit code: ${output.status}`);
      core.debug(`Stdout: ${output.stdout}`);
      core.debug(`Stderr: ${output.stderr}`);

      return output;
    }
    throw error;
  }
};

const EXEC_OPTIONS = {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024
} as const;

/**
 * Executes the provided shell command
 * @param {string} cmd - Shell command to execute
 * @param {RunOptions} [options] - {@see RUN_OPTIONS_DEFAULTS}
 * @returns {{status: number | null, stdout: string, stderr: string}} - Output of the shell command
 */
export const run = (cmd: string, options?: RunOptions): RunOutput =>
  execute(cmd, (cwd) => execSync(cmd, { ...EXEC_OPTIONS, cwd }), options);

/**
 * Executes git with the given arguments without a shell, so untrusted values (branch names,
 * user names, URLs) can't inject shell syntax
 * @param {string[]} args - Git arguments
 * @param {RunOptions} [options] - {@see RUN_OPTIONS_DEFAULTS}
 * @returns {{status: number | null, stdout: string, stderr: string}} - Output of git
 */
export const git = (args: string[], options?: RunOptions): RunOutput =>
  execute(
    `git ${args.join(' ')}`,
    (cwd) => execFileSync('git', args, { ...EXEC_OPTIONS, cwd }),
    options
  );
