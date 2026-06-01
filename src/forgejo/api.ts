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

  await repoChangeFiles({
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
};
