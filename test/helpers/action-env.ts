import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { vi } from 'vitest';
import { tempDir } from './git-repo';

/** Parses a `GITHUB_STATE`/`GITHUB_OUTPUT` file (`key<<delimiter` heredoc format) */
const parseFileCommands = (file: string): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const { groups } of readFileSync(file, 'utf8').matchAll(
    /^(?<key>.+?)<<(?<delim>\S+)\n(?<value>[\s\S]*?)\n\k<delim>$/gm
  )) {
    result[groups!.key] = groups!.value;
  }
  return result;
};

/**
 * Runs the action code like a runner would, without touching the developer's machine: git uses a
 * temp HOME/global config and no system config, state and outputs go to temp files, workflow
 * commands written to stdout are captured. Call `restore` in `afterEach`
 */
export const setupActionEnv = () => {
  const root = tempDir('lint-env-');
  const globalConfig = path.join(root, 'gitconfig');
  const stateFile = path.join(root, 'state');
  const outputFile = path.join(root, 'output');
  for (const file of [globalConfig, stateFile, outputFile]) {
    writeFileSync(file, '');
  }
  vi.stubEnv('HOME', root);
  vi.stubEnv('GIT_CONFIG_GLOBAL', globalConfig);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_TERMINAL_PROMPT', '0');
  vi.stubEnv('GITHUB_STATE', stateFile);
  vi.stubEnv('GITHUB_OUTPUT', outputFile);

  const out: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  const cwd = process.cwd();

  return {
    /** Messages of `::<command>::` workflow commands (error, warning, debug, …) */
    commands: (command: string) =>
      out
        .join('')
        .split(/\r?\n/)
        .filter((line) => line.startsWith(`::${command}::`))
        .map((line) => line.slice(command.length + 4)),
    globalConfig,
    outputs: () => parseFileCommands(outputFile),
    restore: () => {
      process.chdir(cwd);
      process.exitCode = undefined;
      rmSync(root, { force: true, recursive: true });
    },
    root,
    state: () => parseFileCommands(stateFile)
  };
};

/** Sets action inputs the way the runner does (`INPUT_<NAME>`) */
export const stubInputs = (inputs: Record<string, string>) => {
  for (const [name, value] of Object.entries(inputs)) {
    vi.stubEnv(`INPUT_${name.replace(/ /g, '_').toUpperCase()}`, value);
  }
};

/** Writes the webhook event payload and sets the `GITHUB_*` variables describing the run */
export const stubEvent = (
  root: string,
  eventName: string,
  event: unknown,
  { ref = 'refs/heads/main', workspace = process.cwd() } = {}
) => {
  const eventPath = path.join(root, 'event.json');
  writeFileSync(eventPath, JSON.stringify(event));
  vi.stubEnv('GITHUB_ACTOR', 'actor');
  vi.stubEnv('GITHUB_EVENT_NAME', eventName);
  vi.stubEnv('GITHUB_EVENT_PATH', eventPath);
  vi.stubEnv('GITHUB_REF', ref);
  vi.stubEnv('GITHUB_WORKSPACE', workspace);
};
