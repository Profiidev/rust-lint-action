import * as core from '@actions/core';

import type { GithubContext } from './context';
import type { Octokit } from '@octokit/core';
import { git } from '../utils/action';
import { readFileSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { type GitMode, getFileMode } from '../utils/file';
import { getChangedFiles } from '../git';

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

  const changedFiles = getChangedFiles();
  if (changedFiles.length === 0) {
    core.info('No changes to commit');
    return;
  }

  const blobs: {
    sha: string | null;
    path: string;
    type: 'blob';
    mode: GitMode;
  }[] = [];

  core.startGroup(`Creating blobs for ${changedFiles.length} changed files…`);
  for (const file of changedFiles) {
    const location = path.join(context.workspace, file);
    // oxlint-disable-next-line init-declarations
    let mode: GitMode;
    try {
      mode = getFileMode(location, true);
    } catch {
      // File no longer exists: a null sha deletes it from the tree
      core.info(`${file} was deleted`);
      blobs.push({
        mode: '100644',
        path: file,
        // oxlint-disable-next-line no-null -- the trees API deletes entries with a null sha
        sha: null,
        type: 'blob'
      });
      continue;
    }

    // Symlink blobs hold the link target, not the content it points to
    const raw =
      mode === '120000'
        ? Buffer.from(readlinkSync(location))
        : readFileSync(location);
    const content = raw.toString('base64');

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

  git(['pull', 'origin', `refs/${ref}`]);
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
