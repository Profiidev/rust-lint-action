import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../helpers/git-repo';
import {
  TOKEN,
  checkRuns,
  commitStatuses,
  fixtureFiles,
  fixtureRepo,
  requireNodeTool,
  runAction
} from './harness';

const FIX_MESSAGE = 'chore: fix code style issues with oxfmt';
const remote =
  (repo: { git: (c: string) => string; remote: string }) => (cmd: string) =>
    repo.git(`--git-dir "${repo.remote}" ${cmd}`);

describe('post step', () => {
  it('fails checks the crashed main step left behind', async () => {
    // The directory check throws before the linter is looked up, so no tool is needed
    const repo = fixtureRepo('rust', 'clean');
    const result = await runAction(repo, {
      inputs: { rustfmt: 'true', rustfmt_dir: 'missing' }
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('::error::Directory');
    expect(result.post?.exitCode).toBe(0);
    expect(result.postRequests).toEqual([
      expect.objectContaining({
        method: 'PATCH',
        url: '/repos/o/r/check-runs/1'
      })
    ]);
    expect(checkRuns(result.requests).rustfmt).toMatchObject({
      conclusion: 'failure',
      output: { title: 'Did not finish' }
    });
  });

  it('does nothing after a successful run', async () => {
    const repo = fixtureRepo('rust', 'clean');
    const result = await runAction(repo);
    expect(result.exitCode).toBe(0);
    expect(result.post?.exitCode).toBe(0);
    expect(result.requests).toEqual([]);
  });
});

describe.skipIf(!requireNodeTool('oxfmt') || !requireNodeTool('eslint'))(
  'scenarios',
  () => {
    it('round-trips results_file through publish_results', async () => {
      const repo = fixtureRepo('node', 'broken');
      const file = path.join(tempDir('lint-results-'), 'results.json');
      const first = await runAction(repo, {
        inputs: { oxfmt: 'true', results_file: file }
      });
      expect(first.exitCode).toBe(0);
      expect(first.requests).toEqual([]);
      const results = JSON.parse(readFileSync(file, 'utf8'));
      expect(results.checks).toMatchObject([
        { linterId: 'oxfmt', lintResult: { isSuccess: false } }
      ]);

      const second = await runAction(repo, {
        event: 'workflow_run',
        inputs: { publish_results: file },
        workflowRunSha: 'f'.repeat(40)
      });
      expect(second.exitCode).toBe(0);
      expect(checkRuns(second.requests).oxfmt).toMatchObject({
        conclusion: 'failure',
        head_sha: 'f'.repeat(40),
        output: {
          annotations: [expect.objectContaining({ path: 'src/app.js' })]
        }
      });
    });

    it('fails the run with continue_on_error=false', async () => {
      const repo = fixtureRepo('node', 'broken');
      const result = await runAction(repo, {
        inputs: { continue_on_error: 'false', oxfmt: 'true' }
      });
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('::error::Linting failures detected');
      expect(checkRuns(result.requests).oxfmt.conclusion).toBe('failure');
    });

    it('keeps the run green with continue_on_error=false when clean', async () => {
      const repo = fixtureRepo('node', 'clean');
      const result = await runAction(repo, {
        inputs: { continue_on_error: 'false', oxfmt: 'true' }
      });
      expect(result.exitCode).toBe(0);
    });

    it('concludes neutral on warnings with neutral_check_on_warning', async () => {
      for (const [neutral, conclusion] of [
        ['true', 'neutral'],
        ['false', 'success']
      ]) {
        const repo = fixtureRepo('node', 'clean');
        repo.write('src/warn.js', 'debugger;\n');
        repo.git('add -A');
        repo.git('commit -q -m warn');
        const result = await runAction(repo, {
          inputs: {
            eslint: 'true',
            eslint_args: "--rule 'no-debugger: warn'",
            neutral_check_on_warning: neutral
          }
        });
        expect(checkRuns(result.requests).ESLint).toMatchObject({
          conclusion,
          output: {
            annotations: [
              expect.objectContaining({
                annotation_level: 'warning',
                path: 'src/warn.js',
                start_line: 1
              })
            ]
          }
        });
      }
    });

    it('fills ${dir} in the check_name template', async () => {
      const repo = fixtureRepo('node', 'broken', 'web');
      const result = await runAction(repo, {
        inputs: {
          check_name: '${linter} (${dir})',
          oxfmt: 'true',
          oxfmt_dir: 'web'
        }
      });
      expect(Object.keys(checkRuns(result.requests))).toEqual(['oxfmt (web)']);
      expect(checkRuns(result.requests)['oxfmt (web)'].conclusion).toBe(
        'failure'
      );
    });

    it('creates a signed commit through the GitHub git data API', async () => {
      const repo = fixtureRepo('node', 'broken');
      const result = await runAction(repo, {
        inputs: { auto_fix: 'true', git_sign_commits: 'true', oxfmt: 'true' }
      });
      expect(result.exitCode).toBe(0);
      const git = result.requests.filter((r) => r.url.includes('/git/'));
      expect(git.map((r) => `${r.method} ${r.url}`)).toEqual([
        'GET /repos/o/r/git/ref/heads%2Fmain',
        `GET /repos/o/r/git/commits/${repo.git('rev-parse HEAD')}`,
        'POST /repos/o/r/git/blobs',
        'POST /repos/o/r/git/trees',
        'POST /repos/o/r/git/commits',
        'PATCH /repos/o/r/git/refs/heads%2Fmain'
      ]);
      const [blob, tree, commit, ref] = git.slice(2);
      const content = Buffer.from(blob.body.content, 'base64').toString();
      expect(content).toContain('export const result = total;');
      expect(tree.body).toMatchObject({
        base_tree: 'base-tree-sha',
        tree: [
          { mode: '100644', path: 'src/app.js', sha: 'blob-sha', type: 'blob' }
        ]
      });
      expect(commit.body).toMatchObject({
        message: FIX_MESSAGE,
        parents: [repo.git('rev-parse HEAD')],
        tree: 'tree-sha'
      });
      expect(ref.body).toMatchObject({ sha: 'commit-sha' });
      // The commit is made by the API, nothing is pushed with git
      expect(remote(repo)('rev-list --count main')).toBe('1');
    });

    it('uses commit statuses and the change-files API on Forgejo', async () => {
      const repo = fixtureRepo('node', 'broken');
      const sha = repo.git('rev-parse HEAD');
      const result = await runAction(repo, {
        apiUrlInput: true,
        inputs: {
          auto_fix: 'true',
          forgejo: 'true',
          git_sign_commits: 'true',
          oxfmt: 'true'
        }
      });
      expect(result.exitCode).toBe(0);
      expect(result.requests.some((r) => r.url.includes('check-runs'))).toBe(
        false
      );
      expect(
        result.requests
          .filter((r) => r.url.includes('/statuses/'))
          .map((r) => r.url)
      ).toEqual(Array(3).fill(`/repos/o/r/statuses/${sha}`));
      expect(commitStatuses(result.requests)).toEqual([
        expect.objectContaining({
          context: 'oxfmt',
          state: 'pending',
          description: 'queued'
        }),
        expect.objectContaining({
          context: 'oxfmt',
          state: 'pending',
          description: 'running'
        }),
        // Auto-fixed before the result is parsed
        expect.objectContaining({
          context: 'oxfmt',
          description: 'oxfmt found no issues',
          state: 'success',
          target_url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:/)
        })
      ]);
      const change = result.requests.find(
        (r) => r.method === 'POST' && r.url === '/repos/o/r/contents'
      );
      expect(change?.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(change?.body).toMatchObject({
        author: { email: 'action@github.com', name: 'GitHub Action' },
        branch: 'main',
        files: [{ operation: 'update', path: 'src/app.js' }],
        message: FIX_MESSAGE
      });
      expect(
        Buffer.from(change?.body.files[0].content, 'base64').toString()
      ).toContain('export const result = total;');
    });

    it('checks out and pushes to the head branch of a pull_request', async () => {
      const repo = fixtureRepo('node', 'clean');
      repo.git('checkout -q -b feature');
      repo.write('src/app.js', fixtureFiles('node', 'broken')['src/app.js']);
      repo.git('commit -q -am broken');
      repo.git('push -q origin feature');
      const featureSha = repo.git('rev-parse HEAD');
      // Like actions/checkout on a PR: detached head, not on the PR branch
      repo.git('checkout -q --detach main');
      repo.git('branch -q -D feature');

      const result = await runAction(repo, {
        event: 'pull_request',
        inputs: { auto_fix: 'true', oxfmt: 'true' },
        prBranch: 'feature'
      });
      expect(result.exitCode).toBe(0);
      expect(checkRuns(result.requests).oxfmt.head_sha).toBe(featureSha);
      const origin = remote(repo);
      expect(origin('log -1 --format=%s feature')).toBe(FIX_MESSAGE);
      expect(origin('rev-parse feature~1')).toBe(featureSha);
      expect(origin('show feature:src/app.js')).toContain(
        'export const result = total;'
      );
      expect(origin('rev-list --count main')).toBe('1');
    });
  }
);
