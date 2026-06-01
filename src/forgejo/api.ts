import * as core from '@actions/core';
import path from 'node:path';
import { type ChangeFileOperation, repoChangeFiles } from '../forgejo-client';
import { getChangedFiles } from '../git';
import type { GithubContext } from '../github/context';
import { readFileSync } from 'node:fs';

export const forgejoApiCommit = async (
  context: GithubContext,
  message: string,
  email: string,
  name: string
) => {
  core.info(`Committing changes to Forgejo with message: "${message}"`);
  const [owner, repo] = context.repository.repoName.split('/');
  const changedFiles = getChangedFiles();

  const files: ChangeFileOperation[] = [];

  for (const file of changedFiles) {
    const location = path.join(context.workspace, file);
    const content = Buffer.from(readFileSync(location)).toString('base64');

    files.push({
      content,
      operation: 'update',
      path: file
    });
  }

  const { error, response } = await repoChangeFiles({
    body: {
      author: {
        email,
        name
      },
      branch: context.ref,
      files,
      message
    },
    path: {
      owner,
      repo
    }
  });

  if (error || !response || !response.ok) {
    if (response) {
      const responseText = await response.text();
      core.error(
        `Forgejo API response: ${response.status} ${response.statusText}: ${responseText}`
      );
    }

    const errorMessage = `Failed to commit changes to Forgejo: ${
      error ? JSON.stringify(error) : ''
    } Response: ${response?.statusText || 'Unknown error'}`;
    throw new Error(errorMessage);
  }
  core.info(
    `Successfully committed changes to Forgejo with message: "${message}"`
  );
};
