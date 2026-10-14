import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as core from '@actions/core';
import * as git from './git';
import { apiCommit } from './github/api';
import { Checks } from './github/status';
import { getContext, parseActionEnv, parseEnvFile } from './github/context';
import linters from './linters';
import {
  type LintIssue,
  type LintResult,
  getSummary
} from './utils/lint-result';
import { getOctokit } from '@actions/github';
import { client } from './forgejo-client/client.gen';
import { forgejoApiCommit } from './forgejo/api';

interface Check {
  linterId: string;
  lintCheckName: string;
  lintResult: LintResult;
  summary: string;
}

/** Lint results passed from an unprivileged run to a privileged publish run */
interface ResultsFile {
  checks: { linterId: string; lintResult: LintResult }[];
}

const formatCheckName = (template: string, linter: string, dir: string) =>
  template
    .replace(/\${linter}/g, linter)
    .replace(/\${dir}/g, dir !== '.' ? dir : '')
    .trim();

const toIssues = (issues: unknown): LintIssue[] =>
  Array.isArray(issues)
    ? issues.map((i: any) => ({
        firstLine: Number(i?.firstLine) || 1,
        lastLine: Number(i?.lastLine) || Number(i?.firstLine) || 1,
        message: String(i?.message ?? ''),
        path: String(i?.path ?? '')
      }))
    : [];

/**
 * Privileged run triggered by `workflow_run`: creates check runs from a results file written by an
 * unprivileged run. The file is untrusted, so only known linter check names are accepted and the
 * commit is taken from the triggering event, never from the file
 */
const publishResults = async (file: string): Promise<void> => {
  const { eventName, eventPath, token } = parseActionEnv();
  if (eventName !== 'workflow_run') {
    throw new Error(
      '`publish_results` is only supported on `workflow_run` events'
    );
  }
  const event = parseEnvFile(eventPath);
  const headSha: string = event.workflow_run.head_sha;
  const checkName = core.getInput('check_name', { required: true });

  // Untrusted input: every field is validated below
  const results: { checks?: any[] } = JSON.parse(readFileSync(file, 'utf8'));
  const checks: Check[] = [];
  for (const { linterId, lintResult } of results.checks ?? []) {
    if (!Object.hasOwn(linters, linterId)) {
      core.warning(`Ignoring results for unknown linter "${linterId}"`);
      continue;
    }
    // oxlint-disable-next-line no-unsafe-type-assertion -- checked by hasOwn above
    const { linterName } = linters[linterId as keyof typeof linters];
    const sanitized: LintResult = {
      error: toIssues(lintResult?.error),
      isSuccess: lintResult?.isSuccess === true,
      warning: toIssues(lintResult?.warning)
    };
    checks.push({
      lintCheckName: formatCheckName(
        checkName,
        linterName,
        core.getInput(`${linterId}_dir`) || '.'
      ),
      lintResult: sanitized,
      linterId,
      summary: getSummary(sanitized)
    });
  }

  const status = new Checks({
    forgejo: false,
    neutralCheckOnWarning: core.getInput('neutral_check_on_warning') === 'true',
    octokit: getOctokit(token),
    repoName: event.repository.full_name,
    sha: headSha
  });
  core.startGroup('Create check runs with commit annotations');
  await Promise.all(
    checks.map(async ({ lintCheckName, lintResult, summary }) =>
      status.complete(lintCheckName, lintResult, summary)
    )
  );
  core.endGroup();

  if (
    checks.some((c) => !c.lintResult.isSuccess) &&
    core.getInput('continue_on_error') !== 'true'
  ) {
    core.setFailed(
      'Linting failures detected. See check runs with annotations for details.'
    );
  }
};

/**
 * Parses the action configuration and runs all enabled linters on matching files
 */
// oxlint-disable-next-line complexity
const runAction = async (): Promise<void> => {
  const publishFile = core.getInput('publish_results');
  if (publishFile) {
    await publishResults(publishFile);
    return;
  }

  const context = getContext();
  const resultsFile = core.getInput('results_file');
  const autoFix = core.getInput('auto_fix') === 'true';
  const commit = core.getInput('commit') === 'true';
  const skipVerification = core.getInput('git_no_verify') === 'true';
  const continueOnError = core.getInput('continue_on_error') === 'true';
  const commitMessage = core.getInput('commit_message', { required: true });
  const checkName = core.getInput('check_name', { required: true });
  const neutralCheckOnWarning =
    core.getInput('neutral_check_on_warning') === 'true';
  const isPullRequest =
    context.eventName === 'pull_request' ||
    context.eventName === 'pull_request_target';
  const gitName = core.getInput('git_user_name');
  const gitEmail = core.getInput('git_user_email');
  const signCommits = core.getInput('git_sign_commits') === 'true';
  const forgejo = core.getInput('forgejo') === 'true';
  const api_url = core.getInput('api_url') || process.env.GITHUB_API_URL;

  const octokit = getOctokit(context.token);

  if (api_url) {
    client.setConfig({
      baseUrl: api_url
    });

    client.interceptors.request.use((request) => {
      request.headers.set('Authorization', `Bearer ${context.token}`);
      return request;
    });
  }

  // If on a PR from fork: Display messages regarding action limitations
  if (
    context.eventName === 'pull_request' &&
    context.repository.hasFork &&
    !resultsFile
  ) {
    core.error(
      'This action does not have permission to create annotations on forks. Set `results_file`, upload it as an artifact and publish it from a `workflow_run` workflow with `publish_results`. See the README for details.'
    );
  }
  if (isPullRequest && context.repository.hasFork && autoFix) {
    core.error(
      'This action does not have permission to push to forks. You may want to run it only on `push` events.'
    );
  }

  if (autoFix) {
    // Set Git committer username and password
    git.setUserInfo(gitName, gitEmail);
  }
  if (isPullRequest) {
    // Fetch and check out PR branch:
    // - "push" event: Already on correct branch
    // - "pull_request" event on origin, for code on origin: The Checkout Action
    //   (https://github.com/actions/checkout) checks out the PR's test merge commit instead of the
    //   PR branch. Git is therefore in detached head state. To be able to push changes, the branch
    //   Needs to be fetched and checked out first
    // - "pull_request" event on origin, for code on fork: Same as above, but the repo/branch where
    //   Changes need to be pushed is not yet available. The fork needs to be added as a Git remote
    //   First
    git.checkOutRemoteBranch(context);
  }

  const headSha = git.getHeadSha();

  let hasFailures = false;
  const checks: Check[] = [];
  const linterWithFixes: string[] = [];
  let previousChanges = '';

  const enabled = Object.entries(linters)
    .filter(([linterId]) => core.getInput(linterId) === 'true')
    .map(([linterId, linter]) => {
      const lintDirRel = core.getInput(`${linterId}_dir`) || '.';
      return {
        lintCheckName: formatCheckName(
          checkName,
          linter.linterName,
          lintDirRel
        ),
        lintDirRel,
        linter,
        linterId
      };
    });

  // Untrusted runs (e.g. PRs from forks) hand the results to a privileged workflow instead
  const status = resultsFile
    ? undefined
    : new Checks({
        forgejo,
        neutralCheckOnWarning,
        octokit,
        repoName: context.repository.repoName,
        sha: headSha,
        targetUrl: api_url
      });
  await status?.queue(enabled.map((e) => e.lintCheckName));

  for (const { linterId, linter, lintDirRel, lintCheckName } of enabled) {
    core.startGroup(`Run ${linter.linterName}`);
    // oxlint-disable-next-line no-await-in-loop
    await status?.start(lintCheckName);

    const fileExtensions = core.getInput(`${linterId}_extensions`, {
      required: true
    });
    const args = core.getInput(`${linterId}_args`);
    const prefix = core.getInput(`${linterId}_command_prefix`);
    const lintDirAbs = path.join(context.workspace, lintDirRel);
    const linterAutoFix =
      autoFix && core.getInput(`${linterId}_auto_fix`) === 'true';

    if (!existsSync(lintDirAbs)) {
      throw new Error(
        `Directory ${lintDirAbs} for ${linter.linterName} doesn't exist`
      );
    }

    // Check that the linter and its dependencies are installed
    core.info(`Verifying setup for ${linter.linterName}…`);
    // oxlint-disable-next-line no-await-in-loop
    await linter.verifySetup(lintDirAbs, prefix);
    core.info(`Verified ${linter.linterName} setup`);

    // Determine which files should be linted
    const fileExtList = fileExtensions.split(',');
    core.info(
      `Will use ${linter.linterName} to check the files with extensions ${fileExtList.join(',')}`
    );

    // Lint and optionally auto-fix the matching files, parse code style violations
    core.info(
      `Linting ${linterAutoFix ? 'and auto-fixing ' : ''}files in ${lintDirAbs} ` +
        `with ${linter.linterName} ${args ? `and args: ${args}` : ''}…`
    );
    const lintOutput = linter.lint(
      lintDirAbs,
      fileExtList,
      args,
      linterAutoFix,
      prefix
    );

    // Parse output of linting command
    const lintResult = linter.parseOutput(
      context.workspace,
      lintOutput,
      lintDirRel
    );
    const summary = getSummary(lintResult);
    core.info(
      `${linter.linterName} found ${summary} (${lintResult.isSuccess ? 'success' : 'failure'})`
    );

    if (!lintResult.isSuccess) {
      hasFailures = true;
    }

    if (linterAutoFix && commit && git.hasChanges()) {
      const changes = git.getChanges();
      if (changes !== previousChanges) {
        previousChanges = changes;
        linterWithFixes.push(linter.linterName);
      }
    }

    checks.push({ lintCheckName, lintResult, linterId, summary });
    // oxlint-disable-next-line no-await-in-loop
    await status?.complete(lintCheckName, lintResult, summary);

    core.endGroup();
  }

  if (resultsFile) {
    const results: ResultsFile = {
      checks: checks.map(({ linterId, lintResult }) => ({
        lintResult,
        linterId
      }))
    };
    writeFileSync(resultsFile, JSON.stringify(results));
    core.info(`Wrote lint results to ${resultsFile}`);
  }

  if (git.hasChanges()) {
    // Commit and push auto-fix changes
    const message = commitMessage.replace(
      /\${linter}/g,
      linterWithFixes.join(', ')
    );
    if (signCommits) {
      if (forgejo) {
        await forgejoApiCommit(context, message, gitEmail, gitName);
      } else {
        await apiCommit(octokit, context, message);
      }
    } else {
      git.commitChanges(message, skipVerification);
      git.pushChanges(skipVerification);
    }
  }

  if (hasFailures && !continueOnError) {
    core.setFailed(
      'Linting failures detected. See check runs with annotations for details.'
    );
  }
};

/**
 * Post step: fails all checks the main step queued but never completed, e.g. because a linter
 * crashed or the job was cancelled
 */
const runPost = async (): Promise<void> => {
  const checks = Checks.restore({
    neutralCheckOnWarning: false,
    octokit: getOctokit(core.getInput('github_token', { required: true })),
    targetUrl: core.getInput('api_url') || process.env.GITHUB_API_URL
  });
  await checks?.failRemaining();
};

const isPost = core.getState('isPost') === 'true';
core.saveState('isPost', 'true');

// oxlint-disable-next-line use-unknown-in-catch-callback-variable
(isPost ? runPost() : runAction()).catch((error: any) => {
  core.debug(error.stack || 'No error stack trace');
  core.setFailed(error.message);
});
