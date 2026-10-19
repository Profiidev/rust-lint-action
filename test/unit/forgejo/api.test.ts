import { readFileSync } from 'node:fs';
import * as core from '@actions/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forgejoApiCommit } from '../../../src/forgejo/api';
import { repoChangeFiles } from '../../../src/forgejo-client';
import type { GithubContext } from '../../../src/github/context';
import { run } from '../../../src/utils/action';

vi.mock('@actions/core', () => ({
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn()
}));
vi.mock('node:fs', () => ({ readFileSync: vi.fn() }));
vi.mock('../../../src/utils/action', () => ({ run: vi.fn() }));
vi.mock('../../../src/forgejo-client', () => ({ repoChangeFiles: vi.fn() }));

const changeFiles = vi.mocked(repoChangeFiles) as unknown as ReturnType<
  typeof vi.fn
>;
const SRC = 'a'.repeat(40);
const DST = 'b'.repeat(40);
const ZERO = '0'.repeat(40);

const context = {
  branch: 'feat',
  repository: { repoName: 'o/r' },
  workspace: '/ws'
} as GithubContext;
const b64 = (file: string) =>
  Buffer.from(`content of ${file}`).toString('base64');

const setDiff = (stdout: string) => {
  vi.mocked(run).mockImplementation((cmd) => ({
    status: 0,
    stderr: '',
    stdout: cmd.startsWith('git diff-index') ? stdout : ''
  }));
};

const ok = () => ({ error: undefined, response: { ok: true } });

const commit = async (diff: string) => {
  setDiff(diff);
  changeFiles.mockResolvedValue(ok());
  await forgejoApiCommit(context, 'msg', 'bot@x', 'Bot');
  return changeFiles.mock.calls[0][0].body.files;
};

beforeEach(() => {
  vi.mocked(readFileSync).mockImplementation(
    (file) => `content of ${String(file)}`
  );
});

describe('forgejoApiCommit', () => {
  it('sends the request with author, branch and message', async () => {
    const files = await commit('');
    expect(files).toEqual([]);
    expect(vi.mocked(run).mock.calls.map((c) => c[0])).toEqual([
      'git add -A',
      'git diff-index --cached -M -z HEAD'
    ]);
    expect(changeFiles).toHaveBeenCalledWith({
      body: {
        author: { email: 'bot@x', name: 'Bot' },
        branch: 'feat',
        files: [],
        message: 'msg'
      },
      parseAs: 'text',
      path: { owner: 'o', repo: 'r' }
    });
    expect(core.info).toHaveBeenLastCalledWith(
      'Successfully committed changes to Forgejo with message: "msg"'
    );
  });

  it('parses rename, add, delete and modify entries', async () => {
    const diff = [
      `:100644 100644 ${SRC} ${DST} R087`,
      'old.rs',
      'new.rs',
      `:000000 100644 ${ZERO} ${DST} A`,
      'added.rs',
      `:100644 000000 ${SRC} ${ZERO} D`,
      'deleted.rs',
      `:100644 100644 ${SRC} ${ZERO} M`,
      'dir/mod.rs',
      ''
    ].join('\0');
    expect(await commit(diff)).toEqual([
      {
        content: b64('/ws/new.rs'),
        from_path: 'old.rs',
        operation: 'update',
        path: 'new.rs',
        sha: SRC
      },
      { content: b64('/ws/added.rs'), operation: 'create', path: 'added.rs' },
      { operation: 'delete', path: 'deleted.rs', sha: SRC },
      {
        content: b64('/ws/dir/mod.rs'),
        operation: 'update',
        path: 'dir/mod.rs',
        sha: SRC
      }
    ]);
    expect(readFileSync).toHaveBeenCalledTimes(3);
  });

  it('accepts lowercase status letters', async () => {
    expect(
      await commit([`:100644 100644 ${SRC} ${DST} m`, 'x.rs'].join('\0'))
    ).toEqual([
      { content: b64('/ws/x.rs'), operation: 'update', path: 'x.rs', sha: SRC }
    ]);
  });

  it.each(['T', 'U', 'X'])(
    'warns about unsupported status %s',
    async (status) => {
      const diff = [
        `:100644 120000 ${SRC} ${DST} ${status}`,
        'link',
        `:100644 100644 ${SRC} ${DST} M`,
        'y.rs'
      ].join('\0');
      expect(await commit(diff)).toEqual([
        {
          content: b64('/ws/y.rs'),
          operation: 'update',
          path: 'y.rs',
          sha: SRC
        }
      ]);
      expect(core.warning).toHaveBeenCalledWith(
        `Unsupported file status: ${status} for file link`
      );
    }
  );

  it('skips chunks that are not metadata lines', async () => {
    const diff = [
      'garbage',
      '   ',
      `:100644 100644 ${SRC} ${DST} C050`,
      `:100644 100644 ${SRC} ${DST} M`,
      'z.rs'
    ].join('\0');
    expect(await commit(diff)).toEqual([
      { content: b64('/ws/z.rs'), operation: 'update', path: 'z.rs', sha: SRC }
    ]);
  });

  describe('errors', () => {
    beforeEach(() => setDiff(''));

    it('throws with the error and logs it as JSON', async () => {
      changeFiles.mockResolvedValue({
        error: { message: 'bad' },
        response: { ok: false, status: 422, statusText: 'Unprocessable' }
      });
      await expect(forgejoApiCommit(context, 'm', 'e', 'n')).rejects.toThrow(
        'Failed to commit changes to Forgejo: {"message":"bad"} Response: Unprocessable'
      );
      expect(core.error).toHaveBeenCalledWith(
        'Forgejo API response: 422 Unprocessable: {"message":"bad"}'
      );
    });

    it('throws without a response', async () => {
      changeFiles.mockResolvedValue({ error: 'network', response: undefined });
      await expect(forgejoApiCommit(context, 'm', 'e', 'n')).rejects.toThrow(
        'Failed to commit changes to Forgejo: "network" Response: Unknown error'
      );
      expect(core.error).not.toHaveBeenCalled();
    });

    it('throws when there is neither error nor response', async () => {
      changeFiles.mockResolvedValue({ error: undefined, response: undefined });
      await expect(forgejoApiCommit(context, 'm', 'e', 'n')).rejects.toThrow(
        'Failed to commit changes to Forgejo:  Response: Unknown error'
      );
    });

    it('throws for a non-ok response without error and empty status text', async () => {
      changeFiles.mockResolvedValue({
        error: undefined,
        response: {
          ok: false,
          status: 500,
          statusText: '',
          text: async () => ''
        }
      });
      await expect(forgejoApiCommit(context, 'm', 'e', 'n')).rejects.toThrow(
        'Failed to commit changes to Forgejo:  Response: Unknown error'
      );
      expect(core.error).toHaveBeenCalledWith('Forgejo API response: 500 : ""');
    });

    it('fails on error even with an ok response', async () => {
      changeFiles.mockResolvedValue({
        error: 'x',
        response: {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => 'fine'
        }
      });
      await expect(forgejoApiCommit(context, 'm', 'e', 'n')).rejects.toThrow(
        'Response: OK'
      );
    });

    it('logs a text error without reading the already consumed body', async () => {
      const response = new Response('consumed', {
        status: 409,
        statusText: 'Conflict'
      });
      await response.text();
      changeFiles.mockResolvedValue({ error: 'sha mismatch', response });
      await expect(forgejoApiCommit(context, 'm', 'e', 'n')).rejects.toThrow(
        'Failed to commit changes to Forgejo: "sha mismatch" Response: Conflict'
      );
      expect(core.error).toHaveBeenCalledWith(
        'Forgejo API response: 409 Conflict: sha mismatch'
      );
    });
  });
});
