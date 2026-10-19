import * as core from '@actions/core';
import { describe, expect, it, vi } from 'vitest';
import { Checks, type StatusOptions } from '../../../src/github/status';
import type { LintIssue, LintResult } from '../../../src/utils/lint-result';
import { createFakeOctokit } from '../../helpers/fake-octokit';

vi.mock('@actions/core', () => ({
  getState: vi.fn(),
  info: vi.fn(),
  saveState: vi.fn(),
  warning: vi.fn()
}));

const issue = (n: number): LintIssue => ({
  firstLine: n,
  lastLine: n + 1,
  message: `msg ${n}`,
  path: `f${n}.rs`
});
const issues = (n: number) => Array.from({ length: n }, (_, i) => issue(i));
const lint = (isSuccess: boolean, errors = 0, warnings = 0): LintResult => ({
  error: issues(errors),
  isSuccess,
  warning: issues(warnings)
});

const setup = (opts: Partial<StatusOptions> = {}) => {
  const fake = createFakeOctokit();
  const checks = new Checks({
    forgejo: false,
    neutralCheckOnWarning: false,
    octokit: fake.octokit,
    repoName: 'o/r',
    sha: 'abc',
    ...opts
  });
  return { ...fake, checks };
};

const lastState = () => {
  const { calls } = vi.mocked(core.saveState).mock;
  const [key, value] = calls.at(-1)!;
  expect(key).toBe('checks');
  return JSON.parse(value as string);
};

describe('Checks (GitHub)', () => {
  it('queues check runs and saves their ids', async () => {
    const { calls, checks } = setup();
    await checks.queue(['clippy', 'rustfmt']);
    expect(calls).toEqual([
      {
        method: 'checks.create',
        params: {
          head_sha: 'abc',
          name: 'clippy',
          owner: 'o',
          repo: 'r',
          status: 'queued'
        }
      },
      {
        method: 'checks.create',
        params: {
          head_sha: 'abc',
          name: 'rustfmt',
          owner: 'o',
          repo: 'r',
          status: 'queued'
        }
      }
    ]);
    expect(core.saveState).toHaveBeenCalledOnce();
    expect(lastState()).toEqual({
      forgejo: false,
      pending: { clippy: 1, rustfmt: 2 },
      repoName: 'o/r',
      sha: 'abc'
    });
  });

  it('saves state even when nothing is queued', async () => {
    const { checks } = setup();
    await checks.queue([]);
    expect(lastState().pending).toEqual({});
  });

  it('starts a queued check', async () => {
    const { calls, checks } = setup();
    await checks.queue(['clippy']);
    await checks.start('clippy');
    expect(calls.at(-1)).toEqual({
      method: 'checks.update',
      params: { check_run_id: 1, owner: 'o', repo: 'r', status: 'in_progress' }
    });
  });

  it('does nothing when starting an unknown check', async () => {
    const { calls, checks } = setup();
    await checks.start('clippy');
    expect(calls).toEqual([]);
  });

  it('completes a queued check by updating it', async () => {
    const { calls, checks } = setup();
    await checks.queue(['clippy']);
    vi.mocked(core.saveState).mockClear();
    await checks.complete('clippy', lint(false, 1, 1), '1 error and 1 warning');
    expect(calls.at(-1)).toEqual({
      method: 'checks.update',
      params: {
        check_run_id: 1,
        conclusion: 'failure',
        owner: 'o',
        output: {
          annotations: [
            {
              annotation_level: 'failure',
              end_line: 1,
              message: 'msg 0',
              path: 'f0.rs',
              start_line: 0
            },
            {
              annotation_level: 'warning',
              end_line: 1,
              message: 'msg 0',
              path: 'f0.rs',
              start_line: 0
            }
          ],
          summary: 'clippy found 1 error and 1 warning',
          title: '1 error and 1 warning'
        },
        repo: 'r'
      }
    });
    expect(lastState().pending).toEqual({});
  });

  it('creates the check when completing one that was never queued', async () => {
    const { calls, checks } = setup();
    await checks.complete('clippy', lint(true), 'no issues');
    expect(calls).toEqual([
      {
        method: 'checks.create',
        params: {
          conclusion: 'success',
          head_sha: 'abc',
          name: 'clippy',
          owner: 'o',
          output: {
            annotations: [],
            summary: 'clippy found no issues',
            title: 'No issues'
          },
          repo: 'r'
        }
      }
    ]);
  });

  it('caps annotations at 50', async () => {
    const { calls, checks } = setup();
    await checks.complete('clippy', lint(false, 30, 30), 'many');
    const { annotations } = calls[0].params.output;
    expect(annotations).toHaveLength(50);
    expect(
      annotations.filter((a: any) => a.annotation_level === 'failure')
    ).toHaveLength(30);
    expect(core.info).toHaveBeenCalledWith(
      'There are more than 50 errors/warnings from clippy. Annotations are created for the first 50 issues only.'
    );
  });

  it('does not log the cap for exactly 50 annotations', async () => {
    const { calls, checks } = setup();
    await checks.complete('clippy', lint(false, 50), 'many');
    expect(calls[0].params.output.annotations).toHaveLength(50);
    expect(core.info).not.toHaveBeenCalledWith(
      expect.stringContaining('more than 50')
    );
  });

  it.each([
    [false, false, 0, 0, 'failure'],
    [false, true, 0, 0, 'failure'],
    [false, true, 0, 1, 'failure'],
    [true, false, 0, 0, 'success'],
    [true, true, 0, 0, 'success'],
    [true, false, 0, 2, 'success'],
    [true, true, 0, 2, 'neutral'],
    [true, true, 1, 0, 'neutral']
  ])(
    'isSuccess=%s neutral=%s errors=%i warnings=%i -> %s',
    async (isSuccess, neutralCheckOnWarning, errors, warnings, conclusion) => {
      const { calls, checks } = setup({ neutralCheckOnWarning });
      await checks.complete('clippy', lint(isSuccess, errors, warnings), 's');
      expect(calls[0].params.conclusion).toBe(conclusion);
    }
  );

  it('fails remaining checks only', async () => {
    const { calls, checks } = setup();
    await checks.queue(['clippy', 'rustfmt']);
    await checks.complete('clippy', lint(true), 'no issues');
    calls.length = 0;
    await checks.failRemaining();
    expect(calls).toEqual([
      {
        method: 'checks.update',
        params: {
          check_run_id: 2,
          conclusion: 'failure',
          owner: 'o',
          output: {
            summary:
              'rustfmt did not finish. See the workflow logs for details.',
            title: 'Did not finish'
          },
          repo: 'r'
        }
      }
    ]);
    expect(core.info).toHaveBeenCalledWith('Marking rustfmt as failed');
  });

  it('does nothing in failRemaining when all checks completed', async () => {
    const { calls, checks } = setup();
    await checks.failRemaining();
    expect(calls).toEqual([]);
  });

  it('creates a failing check when a pending check has no id', async () => {
    vi.mocked(core.getState).mockReturnValue(
      JSON.stringify({
        forgejo: false,
        pending: { clippy: 0 },
        repoName: 'o/r',
        sha: 'def'
      })
    );
    const fake = createFakeOctokit();
    const checks = Checks.restore({
      neutralCheckOnWarning: false,
      octokit: fake.octokit
    })!;
    await checks.failRemaining();
    expect(fake.calls).toEqual([
      {
        method: 'checks.create',
        params: expect.objectContaining({
          conclusion: 'failure',
          head_sha: 'def',
          name: 'clippy'
        })
      }
    ]);
  });
});

const status = (
  context: string,
  state: string,
  description: string,
  targetUrl?: string
) => ({
  method: 'repos.createCommitStatus',
  params: {
    context,
    description,
    owner: 'o',
    repo: 'r',
    sha: 'abc',
    state,
    target_url: targetUrl
  }
});

describe('Checks (Forgejo)', () => {
  it('queues, starts and completes commit statuses', async () => {
    const { calls, checks } = setup({
      forgejo: true,
      targetUrl: 'https://ci/run'
    });
    await checks.queue(['clippy']);
    expect(lastState()).toEqual({
      forgejo: true,
      pending: { clippy: 0 },
      repoName: 'o/r',
      sha: 'abc'
    });
    await checks.start('clippy');
    await checks.complete('clippy', lint(true), 'no issues');
    expect(calls).toEqual([
      status('clippy', 'pending', 'queued', 'https://ci/run'),
      status('clippy', 'pending', 'running', 'https://ci/run'),
      status('clippy', 'success', 'clippy found no issues', 'https://ci/run')
    ]);
    expect(lastState().pending).toEqual({});
  });

  it('starts even when not queued', async () => {
    const { calls, checks } = setup({ forgejo: true });
    await checks.start('clippy');
    expect(calls).toEqual([status('clippy', 'pending', 'running')]);
  });

  it.each([
    [true, false, 1, 1, 'success'],
    [false, false, 0, 0, 'success'],
    [false, true, 0, 2, 'success'],
    [false, false, 0, 2, 'failure'],
    [false, true, 1, 0, 'failure'],
    [false, true, 1, 1, 'failure']
  ])(
    'isSuccess=%s neutral=%s errors=%i warnings=%i -> %s',
    async (isSuccess, neutralCheckOnWarning, errors, warnings, state) => {
      const { calls, checks } = setup({ forgejo: true, neutralCheckOnWarning });
      await checks.complete('clippy', lint(isSuccess, errors, warnings), 's');
      expect(calls[0].params.state).toBe(state);
    }
  );

  it('fails remaining statuses', async () => {
    const { calls, checks } = setup({ forgejo: true });
    await checks.queue(['clippy']);
    calls.length = 0;
    await checks.failRemaining();
    expect(calls).toEqual([status('clippy', 'failure', 'did not finish')]);
  });
});

describe('Checks error handling', () => {
  it('swallows errors in every method and logs a warning', async () => {
    const { checks, octokit } = setup();
    octokit.rest.checks.create.mockRejectedValue(new Error('nope'));
    await checks.queue(['clippy']);
    expect(lastState().pending).toEqual({});
    await checks.complete('clippy', lint(true), 'no issues');
    expect(core.warning).toHaveBeenCalledTimes(2);
    expect(core.warning).toHaveBeenCalledWith(
      'Could not update check clippy: nope'
    );
  });

  it('keeps the check pending when completing fails', async () => {
    const { checks, octokit } = setup();
    await checks.queue(['clippy']);
    octokit.rest.checks.update.mockRejectedValue(new Error('down'));
    await checks.start('clippy');
    await checks.complete('clippy', lint(true), 'no issues');
    await checks.failRemaining();
    expect(vi.mocked(core.warning).mock.calls).toEqual([
      ['Could not update check clippy: down'],
      ['Could not update check clippy: down'],
      ['Could not update check clippy: down']
    ]);
    expect(lastState().pending).toEqual({ clippy: 1 });
  });

  it('swallows Forgejo errors', async () => {
    const { checks, octokit } = setup({ forgejo: true });
    octokit.rest.repos.createCommitStatus.mockRejectedValue(new Error('x'));
    await checks.queue(['a']);
    await checks.start('a');
    expect(lastState().pending).toEqual({});
    expect(core.warning).toHaveBeenCalledTimes(2);
  });
});

describe('Checks.restore', () => {
  it('returns undefined when nothing was saved', () => {
    vi.mocked(core.getState).mockReturnValue('');
    expect(
      Checks.restore({ neutralCheckOnWarning: false, octokit: {} as any })
    ).toBeUndefined();
    expect(core.getState).toHaveBeenCalledWith('checks');
  });

  it('restores saved options and pending checks', async () => {
    vi.mocked(core.getState).mockReturnValue(
      JSON.stringify({
        forgejo: false,
        pending: { a: 3, b: 4 },
        repoName: 'x/y',
        sha: 's'
      })
    );
    const fake = createFakeOctokit();
    const checks = Checks.restore({
      neutralCheckOnWarning: false,
      octokit: fake.octokit
    })!;
    await checks.failRemaining();
    expect(
      fake.calls.map((c) => [
        c.method,
        c.params.check_run_id,
        c.params.owner,
        c.params.repo
      ])
    ).toEqual([
      ['checks.update', 3, 'x', 'y'],
      ['checks.update', 4, 'x', 'y']
    ]);
  });

  it('restores Forgejo mode with target url', async () => {
    vi.mocked(core.getState).mockReturnValue(
      JSON.stringify({
        forgejo: true,
        pending: { a: 0 },
        repoName: 'x/y',
        sha: 's'
      })
    );
    const fake = createFakeOctokit();
    const checks = Checks.restore({
      neutralCheckOnWarning: false,
      octokit: fake.octokit,
      targetUrl: 'u'
    })!;
    await checks.failRemaining();
    expect(fake.calls).toEqual([
      {
        method: 'repos.createCommitStatus',
        params: {
          context: 'a',
          description: 'did not finish',
          owner: 'x',
          repo: 'y',
          sha: 's',
          state: 'failure',
          target_url: 'u'
        }
      }
    ]);
  });
});
