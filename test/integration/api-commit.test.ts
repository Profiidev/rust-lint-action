import { chmodSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { client } from '../../src/forgejo-client/client.gen';
import { forgejoApiCommit } from '../../src/forgejo/api';
import { apiCommit, normalizeRef } from '../../src/github/api';
import type { GithubContext } from '../../src/github/context';
import { setupActionEnv } from '../helpers/action-env';
import { startFakeApiServer } from '../helpers/fake-api-server';
import { createFakeOctokit } from '../helpers/fake-octokit';
import { type TestRepo, createRepo, git, tempDir } from '../helpers/git-repo';

let env: ReturnType<typeof setupActionEnv>;
let repo: TestRepo;

beforeEach(() => {
  env = setupActionEnv();
  repo = createRepo({
    'a.txt': 'a\n',
    'b.txt': 'b\n',
    'rename-me.txt': 'a file long enough to be detected as a rename\n'
  });
  process.chdir(repo.dir);
});

afterEach(() => {
  env.restore();
  repo.cleanup();
});

const b64 = (text: string) => Buffer.from(text).toString('base64');

const context = (overrides: Partial<GithubContext> = {}): GithubContext => ({
  actor: 'actor',
  branch: 'main',
  event: {},
  eventName: 'push',
  ref: 'refs/heads/main',
  repository: {
    cloneUrl: `file://${repo.remote}`,
    hasFork: false,
    repoName: 'owner/repo'
  },
  token: 'tok',
  workspace: repo.dir,
  ...overrides
});

const octokitFor = (refType = 'commit') =>
  createFakeOctokit({
    'GET /repos/{owner}/{repo}/git/commits/{commit_sha}': {
      tree: { sha: 'base-tree' }
    },
    'GET /repos/{owner}/{repo}/git/ref/{ref}': {
      object: { sha: 'head-sha', type: refType }
    },
    'PATCH /repos/{owner}/{repo}/git/refs/{ref}': {
      object: { sha: 'new-commit' }
    },
    'POST /repos/{owner}/{repo}/git/blobs': { sha: 'blob-sha' },
    'POST /repos/{owner}/{repo}/git/commits': { sha: 'new-commit' },
    'POST /repos/{owner}/{repo}/git/trees': { sha: 'new-tree' }
  });

/** Added, modified, deleted, executable and symlink changes in the working tree */
const makeChanges = () => {
  repo.write('a.txt', 'modified\n');
  rmSync(path.join(repo.dir, 'b.txt'));
  repo.write('new.txt', 'added\n');
  repo.write('run.sh', '#!/bin/sh\n');
  chmodSync(path.join(repo.dir, 'run.sh'), 0o755);
  symlinkSync('a.txt', path.join(repo.dir, 'link'));
};

describe('apiCommit', () => {
  it('creates blobs, tree, commit and ref for every kind of change', async () => {
    makeChanges();
    const { calls, octokit } = octokitFor();
    // The commit the API would create, so the final pull has something to fetch
    const clone = path.join(tempDir(), 'clone');
    try {
      git(repo.dir, `clone -q "${repo.remote}" "${clone}"`);
      for (const file of ['a.txt', 'b.txt', 'new.txt', 'run.sh', 'link']) {
        rmSync(path.join(clone, file), { force: true });
      }
      writeFileSync(path.join(clone, 'a.txt'), 'modified\n');
      writeFileSync(path.join(clone, 'new.txt'), 'added\n');
      writeFileSync(path.join(clone, 'run.sh'), '#!/bin/sh\n');
      chmodSync(path.join(clone, 'run.sh'), 0o755);
      symlinkSync('a.txt', path.join(clone, 'link'));
      git(clone, 'add -A');
      git(clone, '-c user.name=x -c user.email=x@x commit -q -m api');
      git(clone, 'push -q origin main');
      const remoteSha = git(clone, 'rev-parse HEAD');

      await apiCommit(octokit, context(), 'fix: lint');

      expect(repo.git('rev-parse HEAD')).toBe(remoteSha);
      expect(repo.git('status --porcelain')).toBe('');
    } finally {
      rmSync(path.dirname(clone), { force: true, recursive: true });
    }

    expect(calls.map((c) => c.method)).toEqual([
      'GET /repos/{owner}/{repo}/git/ref/{ref}',
      'GET /repos/{owner}/{repo}/git/commits/{commit_sha}',
      ...Array.from(
        { length: 4 },
        () => 'POST /repos/{owner}/{repo}/git/blobs'
      ),
      'POST /repos/{owner}/{repo}/git/trees',
      'POST /repos/{owner}/{repo}/git/commits',
      'PATCH /repos/{owner}/{repo}/git/refs/{ref}'
    ]);
    expect(calls[0].params).toEqual({
      owner: 'owner',
      ref: 'heads/main',
      repo: 'repo'
    });
    expect(calls[1].params.commit_sha).toBe('head-sha');

    // Deleted b.txt gets no blob request; the symlink blob holds its target
    expect(calls.slice(2, 6).map((c) => c.params.content)).toEqual([
      b64('modified\n'),
      b64('a.txt'),
      b64('added\n'),
      b64('#!/bin/sh\n')
    ]);
    expect(calls[2].params.encoding).toBe('base64');

    expect(calls[6].params).toEqual({
      base_tree: 'base-tree',
      owner: 'owner',
      repo: 'repo',
      tree: [
        { mode: '100644', path: 'a.txt', sha: 'blob-sha', type: 'blob' },
        { mode: '100644', path: 'b.txt', sha: null, type: 'blob' },
        { mode: '120000', path: 'link', sha: 'blob-sha', type: 'blob' },
        { mode: '100644', path: 'new.txt', sha: 'blob-sha', type: 'blob' },
        { mode: '100755', path: 'run.sh', sha: 'blob-sha', type: 'blob' }
      ]
    });
    expect(calls[7].params).toEqual({
      message: 'fix: lint',
      owner: 'owner',
      parents: ['head-sha'],
      repo: 'repo',
      tree: 'new-tree'
    });
    expect(calls[8].params).toEqual({
      owner: 'owner',
      ref: 'heads/main',
      repo: 'repo',
      sha: 'new-commit'
    });
    expect(env.outputs().blobs).toBe(
      JSON.stringify(['blob-sha', null, 'blob-sha', 'blob-sha', 'blob-sha'])
    );
    expect(env.commands('debug')).toContain('git pull origin refs/heads/main');
  });

  it('throws when the final pull fails, after the ref was updated', async () => {
    repo.write('a.txt', 'modified\n');
    repo.git(`remote set-url origin "${path.join(repo.dir, 'missing.git')}"`);
    const { calls, octokit } = octokitFor();
    await expect(apiCommit(octokit, context(), 'msg')).rejects.toThrow(
      /git pull origin refs\/heads\/main/
    );
    expect(calls.at(-1)?.method).toBe(
      'PATCH /repos/{owner}/{repo}/git/refs/{ref}'
    );
  });

  it('uses the PR head branch for pull_request events', async () => {
    repo.git('checkout -q -b feature');
    repo.git('push -q origin feature');
    repo.write('a.txt', 'modified\n');
    const { calls, octokit } = octokitFor();
    await apiCommit(
      octokit,
      context({
        event: { pull_request: { head: { ref: 'feature' } } },
        eventName: 'pull_request_target',
        ref: 'refs/pull/1/merge'
      }),
      'msg'
    );
    expect(calls[0].params.ref).toBe('heads/feature');
    expect(calls.at(-1)?.params.ref).toBe('heads/feature');
  });

  it('falls back to the context ref when a PR event has no head ref', async () => {
    const { calls, octokit } = octokitFor();
    await apiCommit(
      octokit,
      context({ event: {}, eventName: 'pull_request', ref: 'main' }),
      'msg'
    );
    expect(calls[0].params.ref).toBe('heads/main');
  });

  it('returns without creating anything when nothing changed', async () => {
    const { calls, octokit } = octokitFor();
    await apiCommit(octokit, context(), 'msg');
    expect(calls).toHaveLength(2);
    expect(env.commands('debug')).not.toContain(
      'git pull origin refs/heads/main'
    );
  });

  it('rejects refs that do not point to a commit', async () => {
    const { calls, octokit } = octokitFor('tag');
    await expect(apiCommit(octokit, context(), 'msg')).rejects.toThrow(
      'Unsupported ref type: tag'
    );
    expect(calls).toHaveLength(1);
  });

  it('normalizeRef accepts every ref format', () => {
    expect(normalizeRef('refs/heads/x')).toBe('heads/x');
    expect(normalizeRef('refs/tags/v1')).toBe('tags/v1');
    expect(normalizeRef('heads/x')).toBe('heads/x');
    expect(normalizeRef('tags/v1')).toBe('tags/v1');
    expect(normalizeRef('x')).toBe('heads/x');
  });
});

describe('forgejoApiCommit', () => {
  let server: Awaited<ReturnType<typeof startFakeApiServer>>;
  let status = 201;
  let errorBody: unknown = 'boom';

  beforeEach(async () => {
    status = 201;
    errorBody = 'boom';
    server = await startFakeApiServer(() =>
      status === 201 ? undefined : { body: errorBody, status }
    );
    client.setConfig({ baseUrl: server.url });
  });

  afterEach(async () => server.close());

  it('sends add, modify, delete and rename operations', async () => {
    const shaOf = (file: string) => repo.git(`rev-parse HEAD:${file}`);
    const [aSha, bSha, renameSha] = ['a.txt', 'b.txt', 'rename-me.txt'].map(
      shaOf
    );
    repo.write('a.txt', 'modified\n');
    rmSync(path.join(repo.dir, 'b.txt'));
    repo.write('new.txt', 'added\n');
    repo.git('mv rename-me.txt renamed.txt');

    await forgejoApiCommit(
      context({ branch: 'feature' }),
      'fix: lint',
      'bot@example.com',
      'Lint Bot'
    );

    expect(server.requests).toHaveLength(1);
    const [request] = server.requests;
    expect(request.method).toBe('POST');
    expect(request.url).toBe('/repos/owner/repo/contents');
    expect(request.body).toEqual({
      author: { email: 'bot@example.com', name: 'Lint Bot' },
      branch: 'feature',
      files: [
        {
          content: b64('modified\n'),
          operation: 'update',
          path: 'a.txt',
          sha: aSha
        },
        { operation: 'delete', path: 'b.txt', sha: bSha },
        { content: b64('added\n'), operation: 'create', path: 'new.txt' },
        {
          content: b64('a file long enough to be detected as a rename\n'),
          from_path: 'rename-me.txt',
          operation: 'update',
          path: 'renamed.txt',
          sha: renameSha
        }
      ],
      message: 'fix: lint'
    });
  });

  it('warns about unsupported changes such as type changes', async () => {
    rmSync(path.join(repo.dir, 'a.txt'));
    symlinkSync('b.txt', path.join(repo.dir, 'a.txt'));
    await forgejoApiCommit(context(), 'msg', 'e', 'n');
    expect(env.commands('warning')).toContain(
      'Unsupported file status: T for file a.txt'
    );
    expect(server.requests[0].body.files).toEqual([]);
  });

  it('throws and logs the text body on a non-2xx response', async () => {
    status = 500;
    repo.write('a.txt', 'modified\n');
    await expect(forgejoApiCommit(context(), 'msg', 'e', 'n')).rejects.toThrow(
      'Failed to commit changes to Forgejo: "boom" Response: Internal Server Error'
    );
    expect(env.commands('error')).toContain(
      'Forgejo API response: 500 Internal Server Error: boom'
    );
  });

  it('serializes JSON error bodies in the log', async () => {
    status = 422;
    errorBody = { message: 'sha mismatch' };
    repo.write('a.txt', 'modified\n');
    await expect(forgejoApiCommit(context(), 'msg', 'e', 'n')).rejects.toThrow(
      'Response: Unprocessable Entity'
    );
    expect(env.commands('error')).toContain(
      'Forgejo API response: 422 Unprocessable Entity: {"message":"sha mismatch"}'
    );
  });

  it('logs an empty object for an empty error body', async () => {
    status = 500;
    errorBody = '';
    repo.write('a.txt', 'modified\n');
    await expect(forgejoApiCommit(context(), 'msg', 'e', 'n')).rejects.toThrow(
      'Failed to commit changes to Forgejo: {} Response: Internal Server Error'
    );
    expect(env.commands('error')).toEqual([
      'Forgejo API response: 500 Internal Server Error: {}'
    ]);
  });

  it('fails without logging a response when the server is unreachable', async () => {
    await server.close();
    server = await startFakeApiServer();
    const { url } = server;
    await server.close();
    server = await startFakeApiServer();
    client.setConfig({ baseUrl: url });
    repo.write('a.txt', 'modified\n');
    await expect(forgejoApiCommit(context(), 'msg', 'e', 'n')).rejects.toThrow(
      /Failed to commit changes to Forgejo/
    );
    expect(env.commands('error')).toEqual([]);
  });
});
