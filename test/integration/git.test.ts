import { chmodSync, existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
import type { GithubContext } from '../../src/github/context';
import { setupActionEnv } from '../helpers/action-env';
import { type TestRepo, createRepo, git, tempDir } from '../helpers/git-repo';

let env: ReturnType<typeof setupActionEnv>;
let repo: TestRepo;

beforeEach(() => {
  env = setupActionEnv();
  repo = createRepo({ 'a.txt': 'a\n', 'b.txt': 'b\n', 'c.txt': 'c\n' });
  process.chdir(repo.dir);
});

afterEach(() => {
  env.restore();
  repo.cleanup();
});

const hook = (name: string, script: string) => {
  const file = path.join(repo.dir, '.git', 'hooks', name);
  repo.write(path.join('.git', 'hooks', name), `#!/bin/sh\n${script}\n`);
  chmodSync(file, 0o755);
};

const context = (
  overrides: Partial<GithubContext['repository']> & {
    eventName?: string;
    branch?: string;
  } = {}
): GithubContext => {
  const {
    eventName = 'pull_request',
    branch = 'feature',
    ...repository
  } = overrides;
  return {
    actor: 'actor',
    branch,
    event: {},
    eventName,
    ref: `refs/heads/${branch}`,
    repository: {
      cloneUrl: `file://${repo.remote}`,
      hasFork: false,
      repoName: 'owner/repo',
      ...repository
    },
    token: 'tok',
    workspace: repo.dir
  };
};

/** Pushes a `feature` branch with one extra commit to `target` and returns its SHA */
const pushFeature = (target: string, file = 'feature.txt') => {
  repo.git('checkout -q -b feature');
  repo.write(file, 'feature\n');
  repo.git('add -A');
  repo.git('commit -q -m feature');
  const sha = repo.git('rev-parse HEAD');
  repo.git(`push -q "${target}" feature`);
  repo.git('checkout -q main');
  repo.git('branch -q -D feature');
  return sha;
};

describe('change detection', () => {
  it('reports no changes on a clean tree', () => {
    expect(hasChanges()).toBe(false);
    expect(getChanges()).toBe('');
  });

  it('detects modifications and returns the diff', () => {
    repo.write('a.txt', 'changed\n');
    expect(hasChanges()).toBe(true);
    expect(getChanges()).toContain('+changed');
    expect(getChanges()).toContain('-a');
  });

  it('ignores untracked files', () => {
    repo.write('new.txt', 'new\n');
    expect(hasChanges()).toBe(false);
  });

  it('getHeadSha returns HEAD', () => {
    expect(getHeadSha()).toBe(repo.git('rev-parse HEAD'));
  });

  it('getChangedFiles stages everything and lists paths without renames', () => {
    repo.write('a.txt', 'changed\n');
    repo.write('new.txt', 'new\n');
    rmSync(path.join(repo.dir, 'b.txt'));
    repo.git('mv c.txt moved.txt');
    expect(getChangedFiles().toSorted()).toEqual([
      'a.txt',
      'b.txt',
      'c.txt',
      'moved.txt',
      'new.txt'
    ]);
    expect(repo.git('status --porcelain')).not.toMatch(/^\?\?/m);
  });

  it('getChangedFiles returns an empty list on a clean tree', () => {
    expect(getChangedFiles()).toEqual([]);
  });
});

describe('commitChanges', () => {
  it('keeps shell syntax in the message verbatim', () => {
    const message =
      'Fix "quotes" and \'single\' $(touch pwned1) `touch pwned2` ${HOME} \\n';
    repo.write('a.txt', 'changed\n');
    commitChanges(message, false);
    expect(repo.git('log -1 --format=%B')).toBe(message.trim());
    expect(existsSync(path.join(repo.dir, 'pwned1'))).toBe(false);
    expect(existsSync(path.join(repo.dir, 'pwned2'))).toBe(false);
    expect(hasChanges()).toBe(false);
  });

  it('runs hooks unless verification is skipped', () => {
    hook('pre-commit', 'exit 1');
    repo.write('a.txt', 'changed\n');
    const before = repo.git('rev-parse HEAD');
    expect(() => commitChanges('msg', false)).toThrow();
    expect(repo.git('rev-parse HEAD')).toBe(before);
    commitChanges('msg', true);
    expect(repo.git('log -1 --format=%s')).toBe('msg');
  });

  it('does not commit untracked files', () => {
    repo.write('a.txt', 'changed\n');
    repo.write('new.txt', 'new\n');
    commitChanges('msg', false);
    expect(repo.git('show --name-only --format= HEAD')).toBe('a.txt');
  });
});

describe('pushChanges', () => {
  it('pushes the commit to origin', () => {
    repo.write('a.txt', 'changed\n');
    commitChanges('msg', false);
    pushChanges(false);
    expect(git(repo.remote, 'rev-parse main')).toBe(repo.git('rev-parse HEAD'));
  });

  it('runs the pre-push hook unless verification is skipped', () => {
    hook('pre-push', 'exit 1');
    repo.write('a.txt', 'changed\n');
    commitChanges('msg', true);
    expect(() => pushChanges(false)).toThrow();
    expect(git(repo.remote, 'rev-parse main')).not.toBe(
      repo.git('rev-parse HEAD')
    );
    pushChanges(true);
    expect(git(repo.remote, 'rev-parse main')).toBe(repo.git('rev-parse HEAD'));
  });
});

describe('setUserInfo', () => {
  it('writes the identity to the (isolated) global config', () => {
    setUserInfo('Lint Bot', 'bot@example.com');
    expect(git(repo.dir, 'config --global user.name')).toBe('Lint Bot');
    expect(git(repo.dir, 'config --global user.email')).toBe('bot@example.com');
    expect(readFileSync(env.globalConfig, 'utf8')).toContain('Lint Bot');
  });

  it('stores shell syntax in the name literally without running it', () => {
    const name = '$(touch marker) `touch marker2` "q"';
    setUserInfo(name, '$(touch marker3)@example.com');
    expect(git(repo.dir, 'config --global user.name')).toBe(name);
    expect(git(repo.dir, 'config --global user.email')).toBe(
      '$(touch marker3)@example.com'
    );
    for (const marker of ['marker', 'marker2', 'marker3']) {
      expect(existsSync(path.join(repo.dir, marker))).toBe(false);
    }
  });
});

/**
 * WHATWG URLs drop credentials on file: URLs and an in-process HTTP server would deadlock against
 * the synchronous `git fetch`, so remotes use https URLs that git rewrites to the local bare repo
 * via `url.<base>.insteadOf` (in the isolated global config). The URL the action writes, with
 * its actor:token credentials, is still what git stores and resolves
 */
const rewrite = (url: string, target: string) =>
  repo.git(`config --global url."${target}".insteadOf "${url}"`);

describe('checkOutRemoteBranch', () => {
  it('adds credentials to origin and checks out a tracking branch for a push event', () => {
    const sha = pushFeature(repo.remote);
    rewrite('https://actor:tok@git.example/o/r.git', repo.remote);
    repo.git('checkout -q --detach');
    checkOutRemoteBranch(
      context({ cloneUrl: 'https://git.example/o/r.git', eventName: 'push' })
    );
    expect(repo.git('config remote.origin.url')).toBe(
      'https://actor:tok@git.example/o/r.git'
    );
    expect(repo.git('rev-parse --abbrev-ref HEAD')).toBe('feature');
    expect(repo.git('rev-parse HEAD')).toBe(sha);
    expect(repo.git('rev-parse --abbrev-ref feature@{upstream}')).toBe(
      'origin/feature'
    );
  });

  it('checks out a tracking branch for a PR on the same repo', () => {
    const sha = pushFeature(repo.remote);
    repo.git('checkout -q --detach');
    checkOutRemoteBranch(context());
    expect(repo.git('rev-parse --abbrev-ref HEAD')).toBe('feature');
    expect(repo.git('rev-parse HEAD')).toBe(sha);
    // WHATWG URLs can't carry credentials for file:, so the URL is left as is
    expect(repo.git('remote get-url origin')).toBe(`file://${repo.remote}`);
  });

  it('checks out a branch named with shell syntax without running it', () => {
    const branch = 'feat-$(touch${IFS}pwned)`touch${IFS}pwned2`';
    // Valid refname, so a fork could open a PR from it
    expect(git(repo.dir, `check-ref-format --branch '${branch}'`)).toBe(branch);
    repo.git(`checkout -q -b '${branch}'`);
    repo.write('feature.txt', 'feature\n');
    repo.git('add -A');
    repo.git('commit -q -m feature');
    const sha = repo.git('rev-parse HEAD');
    repo.git(`push -q origin '${branch}'`);
    repo.git('checkout -q main');
    repo.git(`branch -q -D '${branch}'`);

    checkOutRemoteBranch(context({ branch }));
    expect(repo.git('rev-parse --abbrev-ref HEAD')).toBe(branch);
    expect(repo.git('rev-parse HEAD')).toBe(sha);
    checkOutRemoteBranch(context({ branch, eventName: 'pull_request_target' }));
    expect(repo.git('rev-parse HEAD')).toBe(sha);
    for (const marker of ['pwned', 'pwned2']) {
      expect(existsSync(path.join(repo.dir, marker))).toBe(false);
    }
  });

  it('throws when the remote branch cannot be fetched', () => {
    expect(() => checkOutRemoteBranch(context({ branch: 'missing' }))).toThrow(
      /git fetch/
    );
  });

  it('hard resets to the remote branch for pull_request_target', () => {
    const sha = pushFeature(repo.remote);
    repo.write('a.txt', 'dirty\n');
    checkOutRemoteBranch(context({ eventName: 'pull_request_target' }));
    expect(repo.git('rev-parse --abbrev-ref HEAD')).toBe('main');
    expect(repo.git('rev-parse HEAD')).toBe(sha);
    expect(repo.git('status --porcelain')).toBe('');
  });

  it('adds the fork as remote with credentials and resets to its branch', () => {
    const forkRoot = tempDir();
    const fork = path.join(forkRoot, 'fork.git');
    try {
      git(repo.dir, `clone -q --bare "${repo.remote}" "${fork}"`);
      const sha = pushFeature(fork);
      const url = 'https://actor:tok@fork.example/someone/repo.git';
      rewrite(url, fork);
      checkOutRemoteBranch(
        context({
          forkCloneUrl: 'https://fork.example/someone/repo.git',
          forkName: 'someone/repo',
          hasFork: true
        })
      );
      expect(repo.git('config remote.fork.url')).toBe(url);
      expect(repo.git('config remote.origin.url')).toBe(repo.remote);
      expect(repo.git('rev-parse --abbrev-ref HEAD')).toBe('main');
      expect(repo.git('rev-parse HEAD')).toBe(sha);
      expect(env.commands('debug')).toContain(`git remote add fork ${url}`);
      expect(env.commands('debug')).toContain('git reset --hard fork/feature');
    } finally {
      rmSync(forkRoot, { force: true, recursive: true });
    }
  });

  it('falls back to origin when a fork has no clone URL', () => {
    const sha = pushFeature(repo.remote);
    checkOutRemoteBranch(context({ forkName: 'someone/repo', hasFork: true }));
    expect(repo.git('remote')).toBe('origin');
    expect(repo.git('rev-parse HEAD')).toBe(sha);
    expect(env.commands('debug')).toContain('git reset --hard origin/feature');
  });
});
