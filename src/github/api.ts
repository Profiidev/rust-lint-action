import * as core from '@actions/core';

import { name as actionName } from '../../package.json';
import type { GithubContext } from './context';
import type { LintResult } from '../utils/lint-result';
import request from '../utils/request';
import { capitalizeFirstLetter } from '../utils/string';
import type { Octokit } from '@octokit/core';
import { run } from '../utils/action';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type GitMode, getFileMode } from '../utils/file';

/**
 * Creates a new check on GitHub which annotates the relevant commit with linting errors
 * @param {string} linterName - Name of the linter for which a check should be created
 * @param {string} sha - SHA of the commit which should be annotated
 * @param {GithubContext} context - Information about the GitHub repository and
 * action trigger event
 * @param {LintResult} lintResult - Parsed lint result
 * @param {boolean} neutralCheckOnWarning - Whether the check run should conclude as neutral if
 * there are only warnings
 * @param {string} summary - Summary for the GitHub check
 */
export const createCheck = async (
  linterName: string,
  sha: string,
  context: GithubContext,
  lintResult: LintResult,
  neutralCheckOnWarning: boolean,
  summary: string
): Promise<void> => {
  let annotations: any[] = [];
  for (const level of ['error', 'warning'] as const) {
    annotations.push(
      ...lintResult[level].map((result) => ({
        annotation_level: level === 'warning' ? 'warning' : 'failure',
        end_line: result.lastLine,
        message: result.message,
        path: result.path,
        start_line: result.firstLine
      }))
    );
  }

  // Only use the first 50 annotations (limit for a single API request)
  if (annotations.length > 50) {
    core.info(
      `There are more than 50 errors/warnings from ${linterName}. Annotations are created for the first 50 issues only.`
    );
    annotations = annotations.slice(0, 50);
  }

  let conclusion: 'neutral' | 'success' | 'failure' = 'success';
  if (lintResult.isSuccess) {
    if (annotations.length > 0 && neutralCheckOnWarning) {
      conclusion = 'neutral';
    } else {
      conclusion = 'success';
    }
  } else {
    conclusion = 'failure';
  }

  const body = {
    conclusion,
    head_sha: sha,
    name: linterName,
    output: {
      annotations,
      summary: `${linterName} found ${summary}`,
      title: capitalizeFirstLetter(summary)
    }
  };
  try {
    core.info(
      `Creating GitHub check with ${conclusion} conclusion and ${annotations.length} annotations for ${linterName}…`
    );
    core.debug(`Sending with body ${JSON.stringify(body)}`);
    await request(
      `${process.env.GITHUB_API_URL}/repos/${context.repository.repoName}/check-runs`,
      {
        body,
        headers: {
          // "Accept" header is required to access Checks API during preview period
          Accept: 'application/vnd.github.antiope-preview+json',
          Authorization: `Bearer ${context.token}`,
          'Content-Type': 'application/json',
          'User-Agent': actionName
        },
        method: 'POST'
      }
    );
    core.info(`${linterName} check created successfully`);
  } catch (error: any) {
    let errorMessage = error.message;
    if (error.data) {
      try {
        const errorData = JSON.parse(error.data);
        if (errorData.message) {
          errorMessage += `. ${errorData.message}`;
        }
        if (errorData.documentation_url) {
          errorMessage += ` ${errorData.documentation_url}`;
        }
      } catch {
        // Ignore
      }
    }
    core.error(errorMessage);

    throw new Error(
      `Error trying to create GitHub check for ${linterName}: ${errorMessage}`,
      { cause: error }
    );
  }
};

export const apiCommit = async (
  octokit: Octokit,
  context: GithubContext,
  message: string
) => {
  const [owner, repo] = context.repository.repoName.split('/');

  let functionalRef: string = context.ref;
  if (
    context.eventName === 'pull_request' ||
    context.eventName === 'pull_request_target'
  ) {
    if (context.event.pull_request?.head?.ref) {
      functionalRef = `refs/heads/${context.event.pull_request.head.ref}`;
    }
  }

  const ref = normalizeRef(functionalRef);
  const refData = (
    await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
      owner,
      ref,
      repo
    })
  ).data;
  let headCommit = '';
  if (refData.object.type === 'commit') {
    headCommit = refData.object.sha;
  } else {
    throw new Error(`Unsupported ref type: ${refData.object.type}`);
  }

  const headTree = (
    await octokit.request(
      'GET /repos/{owner}/{repo}/git/commits/{commit_sha}',
      {
        commit_sha: headCommit,
        owner,
        repo
      }
    )
  ).data.tree.sha;

  run('git add -A');
  const changes = run('git diff --cached --name-only --no-renames');
  if (changes.status !== 0) {
    throw new Error(`Error trying to get staged changes: ${changes.stderr}`);
  }

  const changedFiles = changes.stdout.split(/\r?\n/).filter((f) => f);
  if (changedFiles.length === 0) {
    core.info('No changes to commit');
    return;
  }

  const blobs: {
    sha?: string;
    path: string;
    type: 'blob';
    mode: GitMode;
  }[] = [];

  core.startGroup(`Creating blobs for ${changedFiles.length} changed files…`);
  for (const file of changedFiles) {
    const location = path.join(context.workspace, file);
    const content = Buffer.from(readFileSync(location)).toString('base64');

    let mode: GitMode = '100644';
    try {
      mode = getFileMode(location, true);
    } catch {
      core.info(
        `Couldn't determine file mode for ${file}, using default "100644"`
      );
      blobs.push({
        mode: '100644',
        path: file,
        sha: undefined,
        type: 'blob'
      });
      continue;
    }

    // oxlint-disable no-await-in-loop
    const { sha } = (
      await octokit.request('POST /repos/{owner}/{repo}/git/blobs', {
        content,
        encoding: 'base64',
        owner,
        repo
      })
    ).data;

    const blob = {
      mode,
      path: file,
      sha,
      type: 'blob' as const
    };

    core.info(`${blob.sha}\t${blob.path}`);
    blobs.push(blob);
  }
  core.endGroup();
  core.setOutput(
    'blobs',
    blobs.map((b) => b.sha)
  );

  if (blobs.length === 0) {
    core.info('No blobs to commit');
    return;
  }

  const tree = (
    await octokit.request('POST /repos/{owner}/{repo}/git/trees', {
      base_tree: headTree,
      owner,
      repo,
      tree: blobs
    })
  ).data.sha;
  core.info(`Created tree ${tree} with ${blobs.length} blobs`);

  const commit = (
    await octokit.request('POST /repos/{owner}/{repo}/git/commits', {
      message,
      owner,
      parents: [headCommit],
      repo,
      tree
    })
  ).data.sha;
  core.info(`Created commit ${commit} with message "${message}"`);

  const refSha = (
    await octokit.request('PATCH /repos/{owner}/{repo}/git/refs/{ref}', {
      owner,
      ref,
      repo,
      sha: commit
    })
  ).data.object.sha;
  core.info(`Updated ref ${ref} to point to commit ${refSha}`);

  run(`git pull origin refs/${ref}`);
};

export const normalizeRef = (ref: string): string => {
  // Ensure ref matches format `heads/<ref>` or `tags/<ref>`
  if (ref.startsWith('heads/') || ref.startsWith('tags/')) {
    return ref;
  } else if (ref.startsWith('refs/')) {
    return ref.replace('refs/', '');
  } else {
    return `heads/${ref}`;
  }
};
