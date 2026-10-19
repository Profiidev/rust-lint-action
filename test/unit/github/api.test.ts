import { readFileSync, readlinkSync } from 'node:fs';
import * as core from '@actions/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getChangedFiles } from '../../../src/git';
import { apiCommit, normalizeRef } from '../../../src/github/api';
import type { GithubContext } from '../../../src/github/context';
import { git } from '../../../src/utils/action';
import { getFileMode } from '../../../src/utils/file';
import { createFakeOctokit } from '../../helpers/fake-octokit';

vi.mock('@actions/core', () => ({
  endGroup: vi.fn(),
  info: vi.fn(),
  setOutput: vi.fn(),
  startGroup: vi.fn()
}));
vi.mock('node:fs', () => ({ readFileSync: vi.fn(), readlinkSync: vi.fn() }));
vi.mock('../../../src/git', () => ({ getChangedFiles: vi.fn() }));
vi.mock('../../../src/utils/file', () => ({ getFileMode: vi.fn() }));
vi.mock('../../../src/utils/action', () => ({ git: vi.fn() }));

const REF = 'GET /repos/{owner}/{repo}/git/ref/{ref}';
const COMMIT = 'GET /repos/{owner}/{repo}/git/commits/{commit_sha}';
const BLOB = 'POST /repos/{owner}/{repo}/git/blobs';
const TREE = 'POST /repos/{owner}/{repo}/git/trees';
const NEW_COMMIT = 'POST /repos/{owner}/{repo}/git/commits';
const PATCH = 'PATCH /repos/{owner}/{repo}/git/refs/{ref}';

const responses = (refType = 'commit') => ({
  [BLOB]: { sha: 'blob-sha' },
  [COMMIT]: { tree: { sha: 'base-tree' } },
  [NEW_COMMIT]: { sha: 'new-commit' },
  [PATCH]: { object: { sha: 'new-commit' } },
  [REF]: { object: { sha: 'head-sha', type: refType } },
  [TREE]: { sha: 'new-tree' }
});

const context = (overrides: Partial<GithubContext> = {}): GithubContext => ({
  actor: 'a',
  branch: 'main',
  event: {},
  eventName: 'push',
  ref: 'refs/heads/main',
  repository: { cloneUrl: 'u', hasFork: false, repoName: 'o/r' },
  token: 't',
  workspace: '/ws',
  ...overrides
});

const b64 = (file: string) =>
  Buffer.from(`content of ${file}`).toString('base64');

beforeEach(() => {
  vi.mocked(readFileSync).mockImplementation((file) =>
    Buffer.from(`content of ${String(file)}`)
  );
  vi.mocked(getFileMode).mockReturnValue('100644');
});

describe('normalizeRef', () => {
  it.each([
    ['heads/main', 'heads/main'],
    ['tags/v1', 'tags/v1'],
    ['refs/heads/main', 'heads/main'],
    ['refs/tags/v1', 'tags/v1'],
    ['refs/pull/1/merge', 'pull/1/merge'],
    ['main', 'heads/main'],
    ['feat/x', 'heads/feat/x']
  ])('%s -> %s', (input, expected) => {
    expect(normalizeRef(input)).toBe(expected);
  });
});

describe('apiCommit', () => {
  it('commits all changed files and updates the ref', async () => {
    vi.mocked(getChangedFiles).mockReturnValue(['a.rs', 'bin/run.sh']);
    vi.mocked(getFileMode)
      .mockReturnValueOnce('100644')
      .mockReturnValueOnce('100755');
    const { calls, octokit } = createFakeOctokit(responses());

    await apiCommit(octokit, context(), 'fix lint');

    expect(calls).toEqual([
      { method: REF, params: { owner: 'o', ref: 'heads/main', repo: 'r' } },
      {
        method: COMMIT,
        params: { commit_sha: 'head-sha', owner: 'o', repo: 'r' }
      },
      {
        method: BLOB,
        params: {
          content: b64('/ws/a.rs'),
          encoding: 'base64',
          owner: 'o',
          repo: 'r'
        }
      },
      {
        method: BLOB,
        params: {
          content: b64('/ws/bin/run.sh'),
          encoding: 'base64',
          owner: 'o',
          repo: 'r'
        }
      },
      {
        method: TREE,
        params: {
          base_tree: 'base-tree',
          owner: 'o',
          repo: 'r',
          tree: [
            { mode: '100644', path: 'a.rs', sha: 'blob-sha', type: 'blob' },
            {
              mode: '100755',
              path: 'bin/run.sh',
              sha: 'blob-sha',
              type: 'blob'
            }
          ]
        }
      },
      {
        method: NEW_COMMIT,
        params: {
          message: 'fix lint',
          owner: 'o',
          parents: ['head-sha'],
          repo: 'r',
          tree: 'new-tree'
        }
      },
      {
        method: PATCH,
        params: { owner: 'o', ref: 'heads/main', repo: 'r', sha: 'new-commit' }
      }
    ]);
    expect(getFileMode).toHaveBeenCalledWith('/ws/a.rs', true);
    expect(core.setOutput).toHaveBeenCalledWith('blobs', [
      'blob-sha',
      'blob-sha'
    ]);
    expect(core.startGroup).toHaveBeenCalledWith(
      'Creating blobs for 2 changed files…'
    );
    expect(core.endGroup).toHaveBeenCalled();
    expect(git).toHaveBeenCalledWith(['pull', 'origin', 'refs/heads/main']);
  });

  it.each(['pull_request', 'pull_request_target'])(
    'uses the PR head ref for %s',
    async (eventName) => {
      vi.mocked(getChangedFiles).mockReturnValue([]);
      const { calls, octokit } = createFakeOctokit(responses());
      await apiCommit(
        octokit,
        context({
          event: { pull_request: { head: { ref: 'feature' } } },
          eventName,
          ref: 'refs/pull/1/merge'
        }),
        'm'
      );
      expect(calls[0].params.ref).toBe('heads/feature');
    }
  );

  it('falls back to context.ref for a PR without head ref', async () => {
    vi.mocked(getChangedFiles).mockReturnValue([]);
    const { calls, octokit } = createFakeOctokit(responses());
    await apiCommit(
      octokit,
      context({ eventName: 'pull_request', ref: 'refs/pull/1/merge' }),
      'm'
    );
    expect(calls[0].params.ref).toBe('pull/1/merge');
  });

  it('ignores the PR head ref for push events', async () => {
    vi.mocked(getChangedFiles).mockReturnValue([]);
    const { calls, octokit } = createFakeOctokit(responses());
    await apiCommit(
      octokit,
      context({
        event: { pull_request: { head: { ref: 'feature' } } },
        ref: 'main'
      }),
      'm'
    );
    expect(calls[0].params.ref).toBe('heads/main');
  });

  it('throws for a ref not pointing to a commit', async () => {
    const { calls, octokit } = createFakeOctokit(responses('tag'));
    await expect(apiCommit(octokit, context(), 'm')).rejects.toThrow(
      'Unsupported ref type: tag'
    );
    expect(calls).toHaveLength(1);
    expect(getChangedFiles).not.toHaveBeenCalled();
  });

  it('stops when there are no changed files', async () => {
    vi.mocked(getChangedFiles).mockReturnValue([]);
    const { calls, octokit } = createFakeOctokit(responses());
    await apiCommit(octokit, context(), 'm');
    expect(calls.map((c) => c.method)).toEqual([REF, COMMIT]);
    expect(core.info).toHaveBeenCalledWith('No changes to commit');
    expect(core.setOutput).not.toHaveBeenCalled();
    expect(git).not.toHaveBeenCalled();
  });

  it('deletes files removed from the working tree without reading them', async () => {
    vi.mocked(getChangedFiles).mockReturnValue(['gone.rs']);
    vi.mocked(getFileMode).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const { calls, octokit } = createFakeOctokit(responses());
    await apiCommit(octokit, context(), 'm');
    expect(calls.map((c) => c.method)).toEqual([
      REF,
      COMMIT,
      TREE,
      NEW_COMMIT,
      PATCH
    ]);
    const deleted = {
      mode: '100644',
      path: 'gone.rs',
      sha: null,
      type: 'blob'
    };
    expect(calls[2].params.tree).toEqual([deleted]);
    // The null sha must survive serialization for the API to delete the entry
    expect(JSON.stringify(calls[2].params.tree)).toContain('"sha":null');
    expect(readFileSync).not.toHaveBeenCalled();
    expect(readlinkSync).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith('gone.rs was deleted');
    expect(core.setOutput).toHaveBeenCalledWith('blobs', [null]);
  });

  it('uploads the link target for symlinks', async () => {
    vi.mocked(getChangedFiles).mockReturnValue(['link']);
    vi.mocked(getFileMode).mockReturnValue('120000');
    vi.mocked(readlinkSync).mockReturnValue('target.rs');
    const { calls, octokit } = createFakeOctokit(responses());
    await apiCommit(octokit, context(), 'm');
    expect(readlinkSync).toHaveBeenCalledWith('/ws/link');
    expect(readFileSync).not.toHaveBeenCalled();
    expect(calls[2]).toEqual({
      method: BLOB,
      params: {
        content: Buffer.from('target.rs').toString('base64'),
        encoding: 'base64',
        owner: 'o',
        repo: 'r'
      }
    });
    expect(calls[3].params.tree).toEqual([
      { mode: '120000', path: 'link', sha: 'blob-sha', type: 'blob' }
    ]);
  });

  it('reports blob creation failures', async () => {
    vi.mocked(getChangedFiles).mockReturnValue(['a.rs']);
    const { octokit } = createFakeOctokit(responses());
    octokit.request.mockImplementation(async (route: string) => {
      if (route === BLOB) {
        throw new Error('blob failed');
      }
      return { data: responses()[route as keyof ReturnType<typeof responses>] };
    });
    await expect(apiCommit(octokit, context(), 'm')).rejects.toThrow(
      'blob failed'
    );
  });
});
