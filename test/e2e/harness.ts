import { spawn, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import {
  type RecordedRequest,
  type Responder,
  startFakeApiServer
} from '../helpers/fake-api-server';
import { type TestRepo, createRepo, tempDir } from '../helpers/git-repo';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const FIXTURES = path.join(import.meta.dirname, 'fixtures');
export const DIST = path.join(ROOT, 'dist/index.js');
export const REPO_NAME = 'o/r';
export const TOKEN = 'e2e-token';

export type Lang = 'node' | 'python' | 'rust';
export type Variant = 'broken' | 'clean';

/**
 * Returns whether `cmd` runs successfully (in `cwd`). With `E2E_REQUIRE_TOOLS=1` (CI) a missing tool
 * throws, so the suite fails instead of being skipped silently
 */
export const requireTool = (cmd: string, cwd = ROOT): boolean => {
  const ok =
    spawnSync('sh', ['-c', cmd], { cwd, stdio: 'ignore' }).status === 0;
  if (!ok && process.env.E2E_REQUIRE_TOOLS === '1') {
    throw new Error(`Required e2e tool is missing: \`${cmd}\``);
  }
  return ok;
};

/** Checks a binary of the node fixture (installed with `npm ci` in `fixtures/node`) */
export const requireNodeTool = (bin: string): boolean =>
  requireTool(`npx --no-install ${bin} --version`, path.join(FIXTURES, 'node'));

const readTree = (dir: string, prefix = ''): Record<string, string> => {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      Object.assign(files, readTree(path.join(dir, entry.name), rel));
    } else {
      files[rel] = readFileSync(path.join(dir, entry.name), 'utf8');
    }
  }
  return files;
};

/** Fixture files: the clean variant, with the broken files laid over it for `broken` */
export const fixtureFiles = (
  lang: Lang,
  variant: Variant,
  subdir = ''
): Record<string, string> => {
  const files = {
    ...readTree(path.join(FIXTURES, lang, 'clean')),
    ...(variant === 'broken'
      ? readTree(path.join(FIXTURES, lang, 'broken'))
      : {})
  };
  return Object.fromEntries(
    Object.entries(files).map(([file, content]) => [
      path.join(subdir, file),
      content
    ])
  );
};

/**
 * Creates a git repo (with a bare `origin`) holding a fixture, optionally inside `subdir`. The node
 * fixture gets its installed `node_modules` linked in (ignored by git)
 */
export const fixtureRepo = (
  lang: Lang,
  variant: Variant,
  subdir = ''
): TestRepo => {
  const repo = createRepo(fixtureFiles(lang, variant, subdir));
  if (lang === 'node') {
    symlinkSync(
      path.join(FIXTURES, 'node/node_modules'),
      path.join(repo.dir, subdir, 'node_modules')
    );
  }
  return repo;
};

/** Defaults of all action inputs, as the runner applies them */
export const actionDefaults = (): Record<string, string> => {
  const defaults: Record<string, string> = {};
  let input = '';
  for (const line of readFileSync(path.join(ROOT, 'action.yml'), 'utf8').split(
    '\n'
  )) {
    if (line.startsWith('runs:')) {
      break;
    }
    const name = /^ {2}(?<name>\w+):\s*$/.exec(line)?.groups?.name;
    if (name) {
      input = name;
    }
    const value = /^ {4}default:\s*(?<value>.*)$/.exec(line)?.groups?.value;
    if (input && value !== undefined) {
      defaults[input] = value
        .replace(/^'(?<inner>.*)'$/, '$<inner>')
        .replace('${{ github.token }}', TOKEN);
    }
  }
  return defaults;
};

/** Parses a file written with the `name<<delimiter` file command format */
export const parseFileCommand = (file: string): Record<string, string> => {
  const result: Record<string, string> = {};
  const content = readFileSync(file, 'utf8');
  for (const m of content.matchAll(
    /^(?<name>.+?)<<(?<delim>.+)\n(?<value>[\s\S]*?)\n\k<delim>$/gm
  )) {
    result[m.groups!.name] = m.groups!.value;
  }
  return result;
};

export type EventName = 'pull_request' | 'push' | 'workflow_run';

export interface RunOptions {
  /** Inputs overriding the action.yml defaults */
  inputs?: Record<string, string>;
  event?: EventName;
  /** Head branch for `pull_request` events (must exist on origin) */
  prBranch?: string;
  /** `head_sha` for `workflow_run` events */
  workflowRunSha?: string;
  /** Custom API responses (on top of the defaults for the git data routes) */
  respond?: Responder;
  /** Run the post step afterwards (default true, like the runner) */
  post?: boolean;
  /** Pass the fake API server as the `api_url` input (needed for the Forgejo client) */
  apiUrlInput?: boolean;
}

export interface StepResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface RunResult extends StepResult {
  /** All API requests of the main and post step */
  requests: RecordedRequest[];
  /** API requests made by the post step only */
  postRequests: RecordedRequest[];
  post?: StepResult;
  state: Record<string, string>;
  outputs: Record<string, string>;
}

const exec = async (cwd: string, env: NodeJS.ProcessEnv): Promise<StepResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [DIST], { cwd, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ exitCode, stderr, stdout }));
  });

/** Responses for the git data API used by signed commits */
const gitDataResponder =
  (headSha: string): Responder =>
  ({ method, url }) => {
    if (method === 'GET' && url.includes('/git/ref/')) {
      return { body: { object: { sha: headSha, type: 'commit' } } };
    }
    if (method === 'GET' && url.includes('/git/commits/')) {
      return { body: { sha: headSha, tree: { sha: 'base-tree-sha' } } };
    }
    if (method === 'POST' && url.endsWith('/git/blobs')) {
      return { body: { sha: 'blob-sha' } };
    }
    if (method === 'POST' && url.endsWith('/git/trees')) {
      return { body: { sha: 'tree-sha' } };
    }
    if (method === 'POST' && url.endsWith('/git/commits')) {
      return { body: { sha: 'commit-sha' } };
    }
    if (method === 'PATCH' && url.includes('/git/refs/')) {
      return { body: { object: { sha: 'commit-sha' } } };
    }
    return undefined;
  };

const eventPayload = (repo: TestRepo, options: RunOptions) => {
  const repository = {
    clone_url: `file://${repo.remote}`,
    full_name: REPO_NAME
  };
  switch (options.event ?? 'push') {
    case 'pull_request': {
      return {
        number: 1,
        pull_request: {
          head: { ref: options.prBranch, repo: repository }
        },
        repository
      };
    }
    case 'workflow_run': {
      return { repository, workflow_run: { head_sha: options.workflowRunSha } };
    }
    default: {
      return { ref: 'refs/heads/main', repository };
    }
  }
};

/**
 * Runs the built action (main step, then post step) in the repo exactly like the runner: inputs
 * as `INPUT_*` with action.yml defaults applied, event payload file, file commands and state
 */
export const runAction = async (
  repo: TestRepo,
  options: RunOptions = {}
): Promise<RunResult> => {
  const headSha = repo.git('rev-parse HEAD');
  const custom = options.respond ?? (() => undefined);
  let checkRunId = 0;
  const server = await startFakeApiServer((req) => {
    if (req.method === 'POST' && req.url.endsWith('/check-runs')) {
      checkRunId += 1;
      return custom(req) ?? { body: { id: checkRunId } };
    }
    return custom(req) ?? gitDataResponder(headSha)(req);
  });
  const tmp = tempDir('lint-e2e-');
  const eventPath = path.join(tmp, 'event.json');
  writeFileSync(eventPath, JSON.stringify(eventPayload(repo, options)));
  const gitConfig = path.join(tmp, 'gitconfig');
  writeFileSync(gitConfig, '');

  const inputs = {
    ...actionDefaults(),
    ...(options.apiUrlInput ? { api_url: server.url } : {}),
    ...options.inputs
  };
  // Start from a clean environment: the runner of this test suite may set its own GITHUB_* vars
  const base = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(?:INPUT_|STATE_|GITHUB_|RUNNER_|ACTIONS_)/.test(key)
    )
  );
  const env = (step: string): NodeJS.ProcessEnv => {
    const stepDir = path.join(tmp, step);
    mkdirSync(stepDir);
    for (const file of ['state', 'output', 'summary', 'env', 'path']) {
      writeFileSync(path.join(stepDir, file), '');
    }
    return {
      ...base,
      ...Object.fromEntries(
        Object.entries(inputs).map(([k, v]) => [`INPUT_${k.toUpperCase()}`, v])
      ),
      GITHUB_ACTIONS: 'true',
      GITHUB_ACTOR: 'e2e-actor',
      GITHUB_API_URL: server.url,
      GITHUB_ENV: path.join(stepDir, 'env'),
      GITHUB_EVENT_NAME: options.event ?? 'push',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_OUTPUT: path.join(stepDir, 'output'),
      GITHUB_PATH: path.join(stepDir, 'path'),
      GITHUB_REF:
        options.event === 'pull_request'
          ? 'refs/pull/1/merge'
          : 'refs/heads/main',
      GITHUB_REPOSITORY: REPO_NAME,
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_STATE: path.join(stepDir, 'state'),
      GITHUB_STEP_SUMMARY: path.join(stepDir, 'summary'),
      GITHUB_WORKSPACE: repo.dir,
      // `git config --global` of the action must not touch the real global config
      GIT_CONFIG_GLOBAL: gitConfig,
      GIT_CONFIG_NOSYSTEM: '1',
      RUNNER_TEMP: tmp
    };
  };

  try {
    const mainEnv = env('main');
    const main = await exec(repo.dir, mainEnv);
    const state = parseFileCommand(mainEnv.GITHUB_STATE!);
    const outputs = parseFileCommand(mainEnv.GITHUB_OUTPUT!);
    const mainCount = server.requests.length;
    let post: StepResult | undefined = undefined;
    if (options.post !== false) {
      post = await exec(repo.dir, {
        ...env('post'),
        ...Object.fromEntries(
          Object.entries(state).map(([k, v]) => [`STATE_${k}`, v])
        )
      });
    }
    return {
      ...main,
      outputs,
      post,
      postRequests: server.requests.slice(mainCount),
      requests: [...server.requests],
      state
    };
  } finally {
    await server.close();
  }
};

/**
 * Final state of each check run, keyed by name: the create payload merged with all updates. Check
 * run ids are handed out in request order (see `runAction`), so they can be recovered the same way
 */
export const checkRuns = (
  requests: RecordedRequest[]
): Record<string, Record<string, any>> => {
  const byId: Record<string, any>[] = [];
  const byName: Record<string, Record<string, any>> = {};
  for (const { body, method, url } of requests) {
    if (method === 'POST' && url.endsWith('/check-runs')) {
      byName[body.name] = { ...body };
      byId.push(byName[body.name]);
    }
    const id = /\/check-runs\/(?<id>\d+)$/.exec(url)?.groups?.id;
    if (method === 'PATCH' && id) {
      Object.assign(byId[Number(id) - 1], body);
    }
  }
  return byName;
};

/** Commit statuses (Forgejo mode) in request order */
export const commitStatuses = (requests: RecordedRequest[]) =>
  requests
    .filter((r) => r.method === 'POST' && r.url.includes('/statuses/'))
    .map((r) => r.body);
