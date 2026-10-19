import { describe, expect, it, vi } from 'vitest';
import {
  checkOutRemoteBranch,
  commitChanges,
  getChangedFiles,
  getChanges,
  getHeadSha,
  hasChanges,
  pushChanges,
  setUserInfo
} from '../../src/git';
import type { GithubContext, GithubRepository } from '../../src/github/context';
import { git } from '../../src/utils/action';

vi.mock('@actions/core', () => ({ info: vi.fn() }));
vi.mock('../../src/utils/action', () => ({ git: vi.fn() }));

const mockGit = vi.mocked(git);
const out = (stdout: string, status = 0) => ({ status, stderr: '', stdout });
const commands = () => mockGit.mock.calls.map((c) => c[0]);

const context = (
  repository: Partial<GithubRepository> = {},
  eventName = 'push',
  branch = 'feat'
): GithubContext => ({
  actor: 'bot',
  branch,
  event: {},
  eventName,
  ref: `refs/heads/${branch}`,
  repository: {
    cloneUrl: 'https://github.com/o/r.git',
    hasFork: false,
    repoName: 'o/r',
    ...repository
  },
  token: 'tok',
  workspace: '/ws'
});

const ORIGIN_AUTH = [
  'remote',
  'set-url',
  'origin',
  'https://bot:tok@github.com/o/r.git'
];

describe('checkOutRemoteBranch', () => {
  it('uses origin with auth and tracks the branch without a fork', () => {
    checkOutRemoteBranch(context());
    expect(commands()).toEqual([
      ORIGIN_AUTH,
      ['fetch', '--no-tags', '--depth=1', 'origin', 'feat'],
      ['branch', '--force', 'feat', '--track', 'origin/feat'],
      ['checkout', 'feat']
    ]);
  });

  it('adds the fork remote and resets to it', () => {
    checkOutRemoteBranch(
      context({
        forkCloneUrl: 'https://github.com/f/r.git',
        forkName: 'f/r',
        hasFork: true
      })
    );
    expect(commands()).toEqual([
      ['remote', 'add', 'fork', 'https://bot:tok@github.com/f/r.git'],
      ['fetch', '--no-tags', '--depth=1', 'fork', 'feat'],
      ['reset', '--hard', 'fork/feat']
    ]);
  });

  it('uses origin but still resets for a fork without clone url', () => {
    checkOutRemoteBranch(context({ forkName: 'f/r', hasFork: true }));
    expect(commands()).toEqual([
      ORIGIN_AUTH,
      ['fetch', '--no-tags', '--depth=1', 'origin', 'feat'],
      ['reset', '--hard', 'origin/feat']
    ]);
  });

  it('ignores the fork clone url when hasFork is false', () => {
    checkOutRemoteBranch(
      context({ forkCloneUrl: 'https://github.com/f/r.git' })
    );
    expect(commands()[0]).toEqual(ORIGIN_AUTH);
  });

  it('resets instead of tracking for pull_request_target', () => {
    checkOutRemoteBranch(context({}, 'pull_request_target'));
    expect(commands()).toEqual([
      ORIGIN_AUTH,
      ['fetch', '--no-tags', '--depth=1', 'origin', 'feat'],
      ['reset', '--hard', 'origin/feat']
    ]);
  });

  it('url-encodes credentials', () => {
    checkOutRemoteBranch({ ...context(), actor: 'a b', token: 'p@ss' });
    expect(commands()[0]).toEqual([
      'remote',
      'set-url',
      'origin',
      'https://a%20b:p%40ss@github.com/o/r.git'
    ]);
  });

  it('passes a malicious branch name as a single argument', () => {
    const branch = 'x$(touch pwned)`id`;rm -rf /';
    checkOutRemoteBranch(context({}, 'push', branch));
    expect(commands().slice(1)).toEqual([
      ['fetch', '--no-tags', '--depth=1', 'origin', branch],
      ['branch', '--force', branch, '--track', `origin/${branch}`],
      ['checkout', branch]
    ]);
  });
});

describe('commitChanges', () => {
  it.each([
    [false, []],
    [true, ['--no-verify']]
  ])('skipVerification=%s', (skip, suffix) => {
    commitChanges('fix lint', skip);
    expect(commands()).toEqual([['commit', '-a', '-m', 'fix lint', ...suffix]]);
  });

  it('passes a message with shell syntax verbatim as one argument', () => {
    const message = 'fix: "quoted" $(touch pwned) `id` \'single\'\nsecond line';
    commitChanges(message, false);
    expect(commands()).toEqual([['commit', '-a', '-m', message]]);
  });
});

describe('getHeadSha', () => {
  it('returns the trimmed sha', () => {
    mockGit.mockReturnValue(out('abc123\n'));
    expect(getHeadSha()).toBe('abc123');
    expect(commands()).toEqual([['rev-parse', 'HEAD']]);
  });
});

describe('hasChanges', () => {
  it.each([
    [1, true],
    [0, false],
    [128, false],
    [null, false]
  ])('status %s -> %s', (status, expected) => {
    mockGit.mockReturnValue({ status, stderr: '', stdout: '' });
    expect(hasChanges()).toBe(expected);
    expect(mockGit).toHaveBeenCalledWith(
      ['diff-index', '--name-status', '--exit-code', 'HEAD', '--'],
      { ignoreErrors: true }
    );
  });
});

describe('getChanges', () => {
  it('returns the trimmed diff', () => {
    mockGit.mockReturnValue(out(' diff \n', 1));
    expect(getChanges()).toBe('diff');
    expect(mockGit).toHaveBeenCalledWith(
      ['diff', '--exit-code', 'HEAD', '--'],
      {
        ignoreErrors: true
      }
    );
  });
});

describe('pushChanges', () => {
  it.each([
    [false, ['push']],
    [true, ['push', '--no-verify']]
  ])('skipVerification=%s -> %j', (skip, args) => {
    pushChanges(skip);
    expect(commands()).toEqual([args]);
  });
});

describe('setUserInfo', () => {
  it('sets global name and email as single arguments', () => {
    setUserInfo('Lint "Bot" $(id)', 'bot@example.com`id`');
    expect(commands()).toEqual([
      ['config', '--global', 'user.name', 'Lint "Bot" $(id)'],
      ['config', '--global', 'user.email', 'bot@example.com`id`']
    ]);
  });
});

describe('getChangedFiles', () => {
  it('stages everything and splits the names', () => {
    mockGit
      .mockReturnValueOnce(out(''))
      .mockReturnValueOnce(out('a.rs\r\nb/c.rs\n\nd.rs'));
    expect(getChangedFiles()).toEqual(['a.rs', 'b/c.rs', 'd.rs']);
    expect(commands()).toEqual([
      ['add', '-A'],
      ['diff', '--cached', '--name-only', '--no-renames']
    ]);
  });

  it('returns an empty list without changes', () => {
    mockGit.mockReturnValue(out(''));
    expect(getChangedFiles()).toEqual([]);
  });
});
