import * as core from '@actions/core';

import { git } from './utils/action';
import type { GithubContext } from './github/context';

/**
 * Fetches and checks out the remote Git branch (if it exists, the fork repository will be used)
 * @param {GithubContext} context - Information about the GitHub
 */
export const checkOutRemoteBranch = (context: GithubContext): void => {
  if (context.repository.hasFork && context.repository.forkCloneUrl) {
    // Fork: Add fork repo as remote
    core.info(
      `Adding "${context.repository.forkName}" fork as remote with Git`
    );
    const cloneURl = new URL(context.repository.forkCloneUrl);
    cloneURl.username = context.actor;
    cloneURl.password = context.token;
    git(['remote', 'add', 'fork', cloneURl.toString()]);
  } else {
    // No fork: Update remote URL to include auth information (so auto-fixes can be pushed)
    core.info(`Adding auth information to Git remote URL`);
    const cloneURl = new URL(context.repository.cloneUrl);
    cloneURl.username = context.actor;
    cloneURl.password = context.token;
    git(['remote', 'set-url', 'origin', cloneURl.toString()]);
  }

  const remote =
    context.repository.hasFork && context.repository.forkCloneUrl
      ? 'fork'
      : 'origin';

  // Fetch remote branch
  core.info(`Fetching remote branch "${context.branch}"`);
  git(['fetch', '--no-tags', '--depth=1', remote, context.branch]);

  // Switch to remote branch

  if (
    context.repository.hasFork ||
    context.eventName === 'pull_request_target'
  ) {
    core.info(`Resetting local branch to ${remote}/${context.branch}`);
    git(['reset', '--hard', `${remote}/${context.branch}`]);
  } else {
    core.info(`Switching to the "${context.branch}" branch`);
    git([
      'branch',
      '--force',
      context.branch,
      '--track',
      `${remote}/${context.branch}`
    ]);
    git(['checkout', context.branch]);
  }
};

/**
 * Stages and commits all changes using Git
 * @param {string} message - Git commit message
 * @param {boolean} skipVerification - Skip Git verification
 */
export const commitChanges = (
  message: string,
  skipVerification: boolean
): void => {
  core.info(`Committing changes`);
  git([
    'commit',
    '-a',
    '-m',
    message,
    ...(skipVerification ? ['--no-verify'] : [])
  ]);
};

/**
 * Returns the SHA of the head commit
 * @returns {string} - Head SHA
 */
export const getHeadSha = (): string => {
  const sha = git(['rev-parse', 'HEAD']).stdout.trim();
  core.info(`SHA of last commit is "${sha}"`);
  return sha;
};

/**
 * Checks whether there are differences from HEAD
 * @returns {boolean} - Boolean indicating whether changes exist
 */
export const hasChanges = (): boolean => {
  const output = git(
    ['diff-index', '--name-status', '--exit-code', 'HEAD', '--'],
    {
      ignoreErrors: true
    }
  );
  const hasChangedFiles = output.status === 1;
  core.info(`${hasChangedFiles ? 'Changes' : 'No changes'} found with Git`);
  return hasChangedFiles;
};

export const getChanges = (): string => {
  const output = git(['diff', '--exit-code', 'HEAD', '--'], {
    ignoreErrors: true
  });
  return output.stdout.trim();
};

/**
 * Pushes all changes to the remote repository
 * @param {boolean} skipVerification - Skip Git verification
 */
export const pushChanges = (skipVerification: boolean): void => {
  core.info('Pushing changes with Git');
  git(['push', ...(skipVerification ? ['--no-verify'] : [])]);
};

/**
 * Updates the global Git configuration with the provided information
 */
export const setUserInfo = (name: string, email: string): void => {
  core.info(`Setting Git user information`);
  git(['config', '--global', 'user.name', name]);
  git(['config', '--global', 'user.email', email]);
};

export const getChangedFiles = (): string[] => {
  git(['add', '-A']);
  const changes = git(['diff', '--cached', '--name-only', '--no-renames']);
  return changes.stdout.split(/\r?\n/).filter((f) => f);
};
