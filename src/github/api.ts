import * as core from '@actions/core';

import { name as actionName } from '../../package.json';
import { GithubContext } from './context';
import { LintResult } from '../utils/lint-result';
import request from '../utils/request';
import { capitalizeFirstLetter } from '../utils/string';
import { Octokit } from '@octokit/core';
import { run } from '../utils/action';
import { readFileSync } from 'fs';
import path from 'path';
import { getFileMode, GitMode } from '../utils/file';

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
export async function createCheck(
  linterName: string,
  sha: string,
  context: GithubContext,
  lintResult: LintResult,
  neutralCheckOnWarning: boolean,
  summary: string
): Promise<void> {
  let annotations: any[] = [];
  for (const level of ['error', 'warning'] as const) {
    annotations = [
      ...annotations,
      ...lintResult[level].map((result) => ({
        path: result.path,
        start_line: result.firstLine,
        end_line: result.lastLine,
        annotation_level: level === 'warning' ? 'warning' : 'failure',
        message: result.message
      }))
    ];
  }

  // Only use the first 50 annotations (limit for a single API request)
  if (annotations.length > 50) {
    core.info(
      `There are more than 50 errors/warnings from ${linterName}. Annotations are created for the first 50 issues only.`
    );
    annotations = annotations.slice(0, 50);
  }

  let conclusion: 'neutral' | 'success' | 'failure';
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
    name: linterName,
    head_sha: sha,
    conclusion,
    output: {
      title: capitalizeFirstLetter(summary),
      summary: `${linterName} found ${summary}`,
      annotations
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
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // "Accept" header is required to access Checks API during preview period
          Accept: 'application/vnd.github.antiope-preview+json',
          Authorization: `Bearer ${context.token}`,
          'User-Agent': actionName
        },
        body
      }
    );
    core.info(`${linterName} check created successfully`);
  } catch (err: any) {
    let errorMessage = err.message;
    if (err.data) {
      try {
        const errorData = JSON.parse(err.data);
        if (errorData.message) {
          errorMessage += `. ${errorData.message}`;
        }
        if (errorData.documentation_url) {
          errorMessage += ` ${errorData.documentation_url}`;
        }
      } catch (e) {
        // Ignore
      }
    }
    core.error(errorMessage);

    throw new Error(
      `Error trying to create GitHub check for ${linterName}: ${errorMessage}`
    );
  }
}

export async function apiCommit(
  octokit: Octokit,
  context: GithubContext,
  message: string
) {
  const owner = context.repository.repoName.split('/')[0];
  const repo = context.repository.repoName.split('/')[1];

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
      repo,
      ref
    })
  ).data;
  let headCommit: string;
  if (refData.object.type === 'commit') {
    headCommit = refData.object.sha;
  } else {
    throw new Error(`Unsupported ref type: ${refData.object.type}`);
  }

  const headTree = (
    await octokit.request(
      'GET /repos/{owner}/{repo}/git/commits/{commit_sha}',
      {
        owner,
        repo,
        commit_sha: headCommit
      }
    )
  ).data.tree.sha;

  run('git add -A');
  let changes = run('git diff --cached --name-only --no-renames');
  if (changes.status !== 0) {
    throw new Error(`Error trying to get staged changes: ${changes.stderr}`);
  }

  const changedFiles = changes.stdout.split(/\r?\n/).filter((f) => f);
  if (changedFiles.length === 0) {
    core.info('No changes to commit');
    return;
  }

  let blobs: {
    sha: string | null;
    path: string;
    type: 'blob';
    mode: GitMode;
  }[] = [];

  core.startGroup(`Creating blobs for ${changedFiles.length} changed files…`);
  for (const file of changedFiles) {
    const location = path.join(context.workspace, file);
    const content = Buffer.from(readFileSync(location)).toString('base64');

    let mode: GitMode;
    try {
      mode = getFileMode(location, true);
    } catch {
      core.info(
        `Couldn't determine file mode for ${file}, using default "100644"`
      );
      blobs.push({
        path: file,
        type: 'blob',
        sha: null,
        mode: '100644'
      });
      continue;
    }

    const sha = (
      await octokit.request('POST /repos/{owner}/{repo}/git/blobs', {
        owner,
        repo,
        encoding: 'base64',
        content
      })
    ).data.sha;

    const blob = {
      path: file,
      type: 'blob' as const,
      mode,
      sha
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
      owner,
      repo,
      base_tree: headTree,
      tree: blobs
    })
  ).data.sha;
  core.info(`Created tree ${tree} with ${blobs.length} blobs`);

  const commit = (
    await octokit.request('POST /repos/{owner}/{repo}/git/commits', {
      owner,
      repo,
      message,
      tree,
      parents: [headCommit]
    })
  ).data.sha;
  core.info(`Created commit ${commit} with message "${message}"`);

  const refSha = (
    await octokit.request('PATCH /repos/{owner}/{repo}/git/refs/{ref}', {
      owner,
      repo,
      sha: commit,
      ref
    })
  ).data.object.sha;
  core.info(`Updated ref ${ref} to point to commit ${refSha}`);

  run(`git pull origin refs/${ref}`);
}

export function normalizeRef(ref: string): string {
  // Ensure ref matches format `heads/<ref>` or `tags/<ref>`
  if (ref.startsWith('heads/') || ref.startsWith('tags/')) return ref;
  else if (ref.startsWith('refs/')) return ref.replace('refs/', '');
  else return `heads/${ref}`;
}
