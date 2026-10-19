import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';
import type * as Main from '../../src/main';
import type { LintResult } from '../../src/utils/lint-result';
import { setupActionEnv, stubEvent, stubInputs } from '../helpers/action-env';
import {
  type RecordedRequest,
  type Responder,
  startFakeApiServer
} from '../helpers/fake-api-server';
import { type TestRepo, createRepo, git, tempDir } from '../helpers/git-repo';

/** Linter registry seen by main.ts; each test fills it with stub linters */
const registry = vi.hoisted(() => ({}) as Record<string, any>);
vi.mock('../../src/linters', () => ({ default: registry }));

const ok: LintResult = { error: [], isSuccess: true, warning: [] };
const failing: LintResult = {
  error: [{ firstLine: 2, lastLine: 3, message: 'bad', path: 'a.txt' }],
  isSuccess: false,
  warning: [{ firstLine: 1, lastLine: 1, message: 'meh', path: 'b.txt' }]
};

/**
 * Registers a stub linter. `fix` runs when the linter is called with auto-fix enabled, simulating
 * a linter rewriting files
 */
const addLinter = (
  id: string,
  {
    result = ok,
    fix
  }: { result?: LintResult; fix?: (dir: string) => void } = {}
) => {
  const linter = {
    lint: vi.fn(
      (dir: string, _ext: string[], _args?: string, autoFix?: boolean) => {
        if (autoFix && fix) {
          fix(dir);
        }
        return { status: 0, stderr: '', stdout: '' };
      }
    ),
    linterName: id.toUpperCase(),
    parseOutput: vi.fn(() => result),
    verifySetup: vi.fn(async () => undefined)
  };
  registry[id] = linter;
  stubInputs({ [id]: 'true', [`${id}_extensions`]: 'txt' });
  return linter;
};

const append = (file: string, text: string) => (dir: string) =>
  writeFileSync(
    path.join(dir, file),
    readFileSync(path.join(dir, file), 'utf8') + text
  );

let main: typeof Main;
let server: Awaited<ReturnType<typeof startFakeApiServer>>;
let respond: Responder;
let env: ReturnType<typeof setupActionEnv>;
let repo: TestRepo;

/** GitHub git data API responses for apiCommit */
const gitDataApi: Responder = ({ method, url }) => {
  if (url.includes('/git/ref/')) {
    return { body: { object: { sha: 'head-sha', type: 'commit' } } };
  }
  if (method === 'GET' && url.includes('/git/commits/')) {
    return { body: { tree: { sha: 'base-tree' } } };
  }
  if (url.endsWith('/git/blobs')) {
    return { body: { sha: 'blob-sha' }, status: 201 };
  }
  if (url.endsWith('/git/trees')) {
    return { body: { sha: 'new-tree' }, status: 201 };
  }
  if (url.endsWith('/git/commits')) {
    return { body: { sha: 'new-commit' }, status: 201 };
  }
  if (url.includes('/git/refs/')) {
    return { body: { object: { sha: 'new-commit' } } };
  }
  return undefined;
};

beforeAll(async () => {
  server = await startFakeApiServer((req) => respond(req));
  // @actions/github reads GITHUB_API_URL once at import
  process.env.GITHUB_API_URL = server.url;
  main = await import('../../src/main');
  delete process.env.GITHUB_API_URL;
});

afterAll(async () => server.close());

beforeEach(() => {
  for (const key of Object.keys(registry)) {
    Reflect.deleteProperty(registry, key);
  }
  respond = gitDataApi;
  server.requests.length = 0;
  env = setupActionEnv();
  repo = createRepo({ 'a.txt': 'a\n', 'b.txt': 'b\n' });
  process.chdir(repo.dir);
  vi.stubEnv('GITHUB_API_URL', server.url);
  stubInputs({
    auto_fix: 'false',
    check_name: '${linter}',
    commit: 'true',
    commit_message: 'chore: fix code style issues with ${linter}',
    continue_on_error: 'true',
    forgejo: 'false',
    git_no_verify: 'false',
    git_sign_commits: 'false',
    git_user_email: 'action@github.com',
    git_user_name: 'GitHub Action',
    github_token: 'tok',
    neutral_check_on_warning: 'false'
  });
  stubEvent(
    env.root,
    'push',
    {
      ref: 'refs/heads/main',
      repository: {
        clone_url: `file://${repo.remote}`,
        full_name: 'owner/repo'
      }
    },
    { workspace: repo.dir }
  );
});

afterEach(() => {
  env.restore();
  repo.cleanup();
});

const requests = (filter: (r: RecordedRequest) => boolean = () => true) =>
  server.requests.filter(filter).map(({ method, url }) => `${method} ${url}`);
const remoteHead = () => git(repo.remote, 'rev-parse main');
const failureMessage =
  'Linting failures detected. See check runs with annotations for details.';

const writeResults = (checks: unknown) => {
  const file = path.join(env.root, 'results.json');
  writeFileSync(file, JSON.stringify({ checks }));
  return file;
};
const workflowRun = () =>
  stubEvent(env.root, 'workflow_run', {
    repository: { full_name: 'owner/repo' },
    workflow_run: { head_sha: 'pr-sha' }
  });

const autoFixInputs = (inputs: Record<string, string> = {}) =>
  stubInputs({
    auto_fix: 'true',
    commit_message: 'fix: ${linter} (${linter})',
    ...inputs
  });

describe('formatCheckName', () => {
  it('replaces every placeholder and trims', () => {
    expect(main.formatCheckName('${linter} ${dir}', 'ESLint', 'web')).toBe(
      'ESLint web'
    );
    expect(main.formatCheckName('${linter} ${dir}', 'ESLint', '.')).toBe(
      'ESLint'
    );
    expect(
      main.formatCheckName('${linter}/${linter} (${dir}${dir})', 'L', 'd')
    ).toBe('L/L (dd)');
    expect(main.formatCheckName('static', 'L', 'd')).toBe('static');
  });
});

describe('toIssues', () => {
  it('returns an empty list for non-arrays', () => {
    for (const value of [undefined, null, 'x', 1, { length: 1 }]) {
      expect(main.toIssues(value)).toEqual([]);
    }
  });

  it('coerces untrusted fields', () => {
    expect(
      main.toIssues([
        null,
        { firstLine: '4', message: 5, path: 7 },
        { firstLine: 'x', lastLine: 0, message: null },
        { firstLine: 2, lastLine: '9', message: 'm', path: 'p', extra: 1 }
      ])
    ).toEqual([
      { firstLine: 1, lastLine: 1, message: '', path: '' },
      { firstLine: 4, lastLine: 4, message: '5', path: '7' },
      { firstLine: 1, lastLine: 1, message: '', path: '' },
      { firstLine: 2, lastLine: 9, message: 'm', path: 'p' }
    ]);
  });
});

describe('publishResults', () => {
  it('throws on events other than workflow_run', async () => {
    await expect(main.publishResults(writeResults([]))).rejects.toThrow(
      '`publish_results` is only supported on `workflow_run` events'
    );
  });

  it('creates sanitized check runs for known linters only', async () => {
    addLinter('stub');
    workflowRun();
    stubInputs({
      check_name: 'Lint ${linter} ${dir}',
      continue_on_error: 'false',
      publish_results: writeResults([
        {
          linterId: 'stub',
          lintResult: {
            error: [{ firstLine: '3', message: 5, path: '../x' }],
            isSuccess: 'true',
            warning: 'not an array'
          }
        },
        { linterId: 'evil', lintResult: ok },
        { linterId: 'toString', lintResult: ok }
      ]),
      stub_dir: 'pkg'
    });

    await main.runAction();

    expect(env.commands('warning')).toEqual([
      'Ignoring results for unknown linter "evil"',
      'Ignoring results for unknown linter "toString"'
    ]);
    expect(requests()).toEqual(['POST /repos/owner/repo/check-runs']);
    expect(server.requests[0].body).toEqual({
      conclusion: 'failure',
      head_sha: 'pr-sha',
      name: 'Lint STUB pkg',
      output: {
        annotations: [
          {
            annotation_level: 'failure',
            end_line: 3,
            message: '5',
            path: '../x',
            start_line: 3
          }
        ],
        summary: 'Lint STUB pkg found 1 error',
        title: '1 error'
      }
    });
    expect(process.exitCode).toBe(1);
    expect(env.commands('error')).toContain(failureMessage);
  });

  it('treats only a literal true as success and tolerates a missing check list', async () => {
    addLinter('stub');
    workflowRun();
    await main.publishResults(
      writeResults([{ linterId: 'stub', lintResult: { isSuccess: true } }])
    );
    expect(server.requests[0].body).toMatchObject({
      conclusion: 'success',
      name: 'STUB'
    });
    expect(process.exitCode).toBeUndefined();

    server.requests.length = 0;
    const file = path.join(env.root, 'empty.json');
    writeFileSync(file, '{}');
    await main.publishResults(file);
    expect(server.requests).toEqual([]);
  });
});

describe('runAction', () => {
  it('queues, starts and completes a check run per linter', async () => {
    addLinter('first', { result: failing });
    addLinter('second');
    stubInputs({ check_name: '${linter} check ${dir}', second_dir: '.' });
    // Both checks are queued concurrently, so ids are tied to names, not arrival order
    respond = ({ body, method }) =>
      method === 'POST'
        ? { body: { id: body.name === 'FIRST check' ? 1 : 2 } }
        : undefined;

    await main.runAction();

    const head = repo.git('rev-parse HEAD');
    expect(requests()).toEqual([
      'POST /repos/owner/repo/check-runs',
      'POST /repos/owner/repo/check-runs',
      'PATCH /repos/owner/repo/check-runs/1',
      'PATCH /repos/owner/repo/check-runs/1',
      'PATCH /repos/owner/repo/check-runs/2',
      'PATCH /repos/owner/repo/check-runs/2'
    ]);
    const bodies = server.requests.map((r) => r.body);
    bodies.splice(
      0,
      2,
      ...bodies.slice(0, 2).toSorted((x, y) => x.name.localeCompare(y.name))
    );
    expect(bodies[0]).toEqual({
      head_sha: head,
      name: 'FIRST check',
      status: 'queued'
    });
    expect(bodies[1].name).toBe('SECOND check');
    expect(bodies[2]).toEqual({ status: 'in_progress' });
    expect(bodies[3]).toEqual({
      conclusion: 'failure',
      output: {
        annotations: [
          {
            annotation_level: 'failure',
            end_line: 3,
            message: 'bad',
            path: 'a.txt',
            start_line: 2
          },
          {
            annotation_level: 'warning',
            end_line: 1,
            message: 'meh',
            path: 'b.txt',
            start_line: 1
          }
        ],
        summary: 'FIRST check found 1 error and 1 warning',
        title: '1 error and 1 warning'
      }
    });
    expect(bodies[5]).toMatchObject({ conclusion: 'success' });
    // The continue_on_error default is true
    expect(process.exitCode).toBeUndefined();
    expect(env.state().checks).toBe(
      JSON.stringify({
        forgejo: false,
        pending: {},
        repoName: 'owner/repo',
        sha: head
      })
    );
  });

  it('passes inputs through to the linter', async () => {
    const linter = addLinter('stub');
    stubInputs({
      stub_args: '--strict',
      stub_command_prefix: 'npx',
      stub_dir: 'sub',
      stub_extensions: 'ts,tsx'
    });
    repo.write('sub/x.ts', '');
    await main.runAction();
    const dir = path.join(repo.dir, 'sub');
    expect(linter.verifySetup).toHaveBeenCalledWith(dir, 'npx');
    expect(linter.lint).toHaveBeenCalledWith(
      dir,
      ['ts', 'tsx'],
      '--strict',
      false,
      'npx'
    );
    expect(linter.parseOutput).toHaveBeenCalledWith(
      repo.dir,
      { status: 0, stderr: '', stdout: '' },
      'sub'
    );
  });

  it('skips linters that are not enabled', async () => {
    const linter = addLinter('stub');
    stubInputs({ stub: 'false' });
    await main.runAction();
    expect(linter.lint).not.toHaveBeenCalled();
    expect(server.requests).toEqual([]);
  });

  it('writes a results file instead of calling the checks API', async () => {
    addLinter('first', { result: failing });
    addLinter('second');
    const file = path.join(env.root, 'results.json');
    stubInputs({ results_file: file });
    await main.runAction();
    expect(server.requests).toEqual([]);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      checks: [
        { linterId: 'first', lintResult: failing },
        { linterId: 'second', lintResult: ok }
      ]
    });
  });

  it('throws when a required GITHUB_* variable is missing', async () => {
    vi.stubEnv('GITHUB_EVENT_NAME', undefined);
    await expect(main.runAction()).rejects.toThrow(
      'Environment variable "GITHUB_EVENT_NAME" is not defined'
    );
  });

  it('throws when the lint directory does not exist', async () => {
    addLinter('stub');
    stubInputs({ stub_dir: 'missing' });
    await expect(main.runAction()).rejects.toThrow(
      `Directory ${path.join(repo.dir, 'missing')} for STUB doesn't exist`
    );
  });

  it('fails the run on lint failures unless continue_on_error is set', async () => {
    addLinter('stub', { result: failing });
    stubInputs({ continue_on_error: 'false' });
    await main.runAction();
    expect(process.exitCode).toBe(1);
    expect(env.commands('error')).toEqual([failureMessage]);
  });

  it('does not fail the run when every linter succeeds', async () => {
    addLinter('stub');
    stubInputs({ continue_on_error: 'false' });
    await main.runAction();
    expect(process.exitCode).toBeUndefined();
  });
});

describe('pull requests from forks', () => {
  const annotationsError =
    'This action does not have permission to create annotations on forks. Set `results_file`, upload it as an artifact and publish it from a `workflow_run` workflow with `publish_results`. See the README for details.';
  const pushError =
    'This action does not have permission to push to forks. You may want to run it only on `push` events.';
  let forkRoot: string;

  beforeEach(() => {
    forkRoot = tempDir();
    const fork = path.join(forkRoot, 'fork.git');
    git(repo.dir, `clone -q --bare "${repo.remote}" "${fork}"`);
    repo.git(`push -q "${fork}" main:feature`);
    stubEvent(
      env.root,
      'pull_request',
      {
        pull_request: {
          head: {
            ref: 'feature',
            repo: { clone_url: `file://${fork}`, full_name: 'someone/repo' }
          }
        },
        repository: {
          clone_url: `file://${repo.remote}`,
          full_name: 'owner/repo'
        }
      },
      { ref: 'refs/pull/1/merge', workspace: repo.dir }
    );
    addLinter('stub');
  });

  afterEach(() => rmSync(forkRoot, { force: true, recursive: true }));

  it('explains how to publish annotations without results_file', async () => {
    await main.runAction();
    expect(env.commands('error')).toEqual([annotationsError]);
    expect(repo.git('remote')).toBe('fork\norigin');
  });

  it('does not complain with results_file', async () => {
    stubInputs({ results_file: path.join(env.root, 'results.json') });
    await main.runAction();
    expect(env.commands('error')).toEqual([]);
    expect(existsSync(path.join(env.root, 'results.json'))).toBe(true);
  });

  it('explains that auto-fixes cannot be pushed', async () => {
    stubInputs({
      auto_fix: 'true',
      results_file: path.join(env.root, 'results.json')
    });
    await main.runAction();
    expect(env.commands('error')).toEqual([pushError]);
  });
});

describe('auto-fix commits', () => {
  it('commits and pushes with git, naming only linters that changed the diff', async () => {
    addLinter('first', { fix: append('a.txt', 'first\n') });
    addLinter('noop', { fix: () => undefined });
    addLinter('second', { fix: append('b.txt', 'second\n') });
    addLinter('disabled', { fix: append('a.txt', 'disabled\n') });
    autoFixInputs({
      disabled_auto_fix: 'false',
      first_auto_fix: 'true',
      noop_auto_fix: 'true',
      second_auto_fix: 'true'
    });
    const before = repo.git('rev-parse HEAD');

    await main.runAction();

    expect(repo.git('log -1 --format=%B')).toBe(
      'fix: FIRST, SECOND (FIRST, SECOND)'
    );
    expect(repo.git('rev-parse HEAD~1')).toBe(before);
    expect(remoteHead()).toBe(repo.git('rev-parse HEAD'));
    expect(git(repo.remote, 'show main:a.txt')).toBe('a\nfirst');
    expect(repo.git('status --porcelain')).toBe('');
    expect(git(repo.dir, 'config --global user.name')).toBe('GitHub Action');
    // Check runs are attached to the commit that was linted
    expect(server.requests[0].body.head_sha).toBe(before);
  });

  it('skips git hooks with git_no_verify', async () => {
    addLinter('stub', { fix: append('a.txt', 'x\n') });
    autoFixInputs({ git_no_verify: 'true', stub_auto_fix: 'true' });
    const hook = path.join(repo.dir, '.git', 'hooks', 'pre-commit');
    writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    await main.runAction();
    expect(remoteHead()).toBe(repo.git('rev-parse HEAD'));
  });

  it('commits through the GitHub API with git_sign_commits', async () => {
    addLinter('stub', { fix: append('a.txt', 'x\n') });
    autoFixInputs({ git_sign_commits: 'true', stub_auto_fix: 'true' });
    const before = remoteHead();

    await main.runAction();

    expect(requests((r) => r.url.includes('/git/'))).toEqual([
      'GET /repos/owner/repo/git/ref/heads%2Fmain',
      'GET /repos/owner/repo/git/commits/head-sha',
      'POST /repos/owner/repo/git/blobs',
      'POST /repos/owner/repo/git/trees',
      'POST /repos/owner/repo/git/commits',
      'PATCH /repos/owner/repo/git/refs/heads%2Fmain'
    ]);
    const commit = server.requests.find(
      (r) => r.method === 'POST' && r.url.endsWith('/git/commits')
    );
    expect(commit?.body.message).toBe('fix: STUB (STUB)');
    expect(commit?.headers.authorization).toBe('token tok');
    // Nothing was committed or pushed with git
    expect(remoteHead()).toBe(before);
    expect(repo.git('rev-parse HEAD')).toBe(before);
  });

  it('commits through the Forgejo API with forgejo and git_sign_commits', async () => {
    addLinter('stub', { fix: append('a.txt', 'x\n') });
    autoFixInputs({
      forgejo: 'true',
      git_sign_commits: 'true',
      git_user_email: 'bot@example.com',
      git_user_name: 'Bot',
      stub_auto_fix: 'true'
    });
    const head = repo.git('rev-parse HEAD');

    await main.runAction();

    expect(requests()).toEqual([
      `POST /repos/owner/repo/statuses/${head}`,
      `POST /repos/owner/repo/statuses/${head}`,
      `POST /repos/owner/repo/statuses/${head}`,
      'POST /repos/owner/repo/contents'
    ]);
    expect(server.requests.map((r) => r.body.state).slice(0, 3)).toEqual([
      'pending',
      'pending',
      'success'
    ]);
    const contents = server.requests.at(3)!;
    expect(contents.headers.authorization).toBe('Bearer tok');
    expect(contents.body).toEqual({
      author: { email: 'bot@example.com', name: 'Bot' },
      branch: 'main',
      files: [
        {
          content: Buffer.from('a\nx\n').toString('base64'),
          operation: 'update',
          path: 'a.txt',
          sha: repo.git('rev-parse HEAD:a.txt')
        }
      ],
      message: 'fix: STUB (STUB)'
    });
    expect(remoteHead()).toBe(head);
  });

  it('sets the Bearer header once across repeated runs', async () => {
    addLinter('stub', { fix: append('a.txt', 'x\n') });
    autoFixInputs({
      forgejo: 'true',
      git_sign_commits: 'true',
      stub_auto_fix: 'true'
    });
    await main.runAction();
    repo.git('checkout -q -- a.txt');
    stubInputs({ github_token: 'tok2' });
    await main.runAction();
    const contents = server.requests.filter((r) => r.url.endsWith('/contents'));
    expect(contents.map((r) => r.headers.authorization)).toEqual([
      'Bearer tok',
      'Bearer tok2'
    ]);
  });

  it('sends Forgejo requests to api_url with a Bearer token', async () => {
    addLinter('stub', { fix: append('a.txt', 'x\n') });
    autoFixInputs({
      api_url: `${server.url}/api/v1`,
      forgejo: 'true',
      git_sign_commits: 'true',
      stub_auto_fix: 'true'
    });
    await main.runAction();
    const contents = server.requests.at(-1);
    expect(contents?.url).toBe('/api/v1/repos/owner/repo/contents');
    expect(contents?.headers.authorization).toBe('Bearer tok');
    expect(server.requests[0].body.target_url).toBe(`${server.url}/api/v1`);
  });

  it.each([
    ['commit is false', { commit: 'false' }],
    ['auto_fix is false', { auto_fix: 'false' }]
  ])('does not commit when %s, even with a dirty tree', async (_, inputs) => {
    addLinter('stub', { fix: append('a.txt', 'x\n') });
    autoFixInputs({ stub_auto_fix: 'true', ...inputs });
    repo.write('b.txt', 'dirty\n');
    const head = repo.git('rev-parse HEAD');
    await main.runAction();
    expect(repo.git('rev-parse HEAD')).toBe(head);
    expect(remoteHead()).toBe(head);
    expect(repo.git('status --porcelain')).toContain('b.txt');
  });

  it('does not commit when the auto-fix changed nothing', async () => {
    addLinter('stub', { fix: () => undefined });
    autoFixInputs({ stub_auto_fix: 'true' });
    const head = repo.git('rev-parse HEAD');
    await main.runAction();
    expect(remoteHead()).toBe(head);
  });
});

describe('runPost', () => {
  it('fails the check runs left over by the main step', async () => {
    vi.stubEnv(
      'STATE_checks',
      JSON.stringify({
        forgejo: false,
        pending: { A: 5, B: 0 },
        repoName: 'owner/repo',
        sha: 'abc'
      })
    );
    await main.runPost();
    expect(requests().toSorted()).toEqual([
      'PATCH /repos/owner/repo/check-runs/5',
      'POST /repos/owner/repo/check-runs'
    ]);
    const update = server.requests.find((r) => r.method === 'PATCH');
    expect(update?.body).toEqual({
      conclusion: 'failure',
      output: {
        summary: 'A did not finish. See the workflow logs for details.',
        title: 'Did not finish'
      }
    });
    const create = server.requests.find((r) => r.method === 'POST');
    expect(create?.body).toMatchObject({ head_sha: 'abc', name: 'B' });
  });

  it('fails leftover Forgejo commit statuses with api_url as target', async () => {
    stubInputs({ api_url: 'https://forgejo.example/api/v1' });
    vi.stubEnv(
      'STATE_checks',
      JSON.stringify({
        forgejo: true,
        pending: { A: 0 },
        repoName: 'owner/repo',
        sha: 'abc'
      })
    );
    await main.runPost();
    expect(requests()).toEqual(['POST /repos/owner/repo/statuses/abc']);
    expect(server.requests[0].body).toEqual({
      context: 'A',
      description: 'did not finish',
      state: 'failure',
      target_url: 'https://forgejo.example/api/v1'
    });
  });

  it('does nothing without saved state', async () => {
    await main.runPost();
    expect(server.requests).toEqual([]);
  });
});
