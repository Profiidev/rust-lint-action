import * as core from '@actions/core';

import { run } from './utils/action';
import { GithubContext } from './github/context';

/**
 * Fetches and checks out the remote Git branch (if it exists, the fork repository will be used)
 * @param {GithubContext} context - Information about the GitHub
 */
export function checkOutRemoteBranch(context: GithubContext): void {
  if (context.repository.hasFork && context.repository.forkCloneUrl) {
    // Fork: Add fork repo as remote
    core.info(
      `Adding "${context.repository.forkName}" fork as remote with Git`
    );
    const cloneURl = new URL(context.repository.forkCloneUrl);
    cloneURl.username = context.actor;
    cloneURl.password = context.token;
    run(`git remote add fork ${cloneURl.toString()}`);
  } else {
    // No fork: Update remote URL to include auth information (so auto-fixes can be pushed)
    core.info(`Adding auth information to Git remote URL`);
    const cloneURl = new URL(context.repository.cloneUrl);
    cloneURl.username = context.actor;
    cloneURl.password = context.token;
    run(`git remote set-url origin ${cloneURl.toString()}`);
  }

  const remote = context.repository.hasFork ? 'fork' : 'origin';

  // Fetch remote branch
  core.info(`Fetching remote branch "${context.branch}"`);
  run(`git fetch --no-tags --depth=1 ${remote} ${context.branch}`);

  // Switch to remote branch

  if (
    context.repository.hasFork ||
    context.eventName === 'pull_request_target'
  ) {
    core.info(`Resetting local branch to ${remote}/${context.branch}`);
    run(`git reset --hard ${remote}/${context.branch}`);
  } else {
    core.info(`Switching to the "${context.branch}" branch`);
    run(
      `git branch --force ${context.branch} --track ${remote}/${context.branch}`
    );
    run(`git checkout ${context.branch}`);
  }
}

/**
 * Stages and commits all changes using Git
 * @param {string} message - Git commit message
 * @param {boolean} skipVerification - Skip Git verification
 */
export function commitChanges(
  message: string,
  skipVerification: boolean
): void {
  core.info(`Committing changes`);
  run(`git commit -am "${message}"${skipVerification ? ' --no-verify' : ''}`);
}

/**
 * Returns the SHA of the head commit
 * @returns {string} - Head SHA
 */
export function getHeadSha(): string {
  const sha = run('git rev-parse HEAD').stdout.trim();
  core.info(`SHA of last commit is "${sha}"`);
  return sha;
}

/**
 * Checks whether there are differences from HEAD
 * @returns {boolean} - Boolean indicating whether changes exist
 */
export function hasChanges(): boolean {
  const output = run('git diff-index --name-status --exit-code HEAD --', {
    ignoreErrors: true
  });
  const hasChangedFiles = output.status === 1;
  core.info(`${hasChangedFiles ? 'Changes' : 'No changes'} found with Git`);
  return hasChangedFiles;
}

export function getChanges(): string {
  const output = run('git diff --exit-code HEAD --', {
    ignoreErrors: true
  });
  return output.stdout.trim();
}

/**
 * Pushes all changes to the remote repository
 * @param {boolean} skipVerification - Skip Git verification
 */
export function pushChanges(skipVerification: boolean): void {
  core.info('Pushing changes with Git');
  run(`git push${skipVerification ? ' --no-verify' : ''}`);
}

/**
 * Updates the global Git configuration with the provided information
 */
export function setUserInfo(name: string, email: string): void {
  core.info(`Setting Git user information`);
  run(`git config --global user.name "${name}"`);
  run(`git config --global user.email "${email}"`);
}
