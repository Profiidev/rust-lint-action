import * as core from '@actions/core';
import path from 'node:path';
import { type ChangeFileOperation, repoChangeFiles } from '../forgejo-client';
import type { GithubContext } from '../github/context';
import { readFileSync } from 'node:fs';
import { run } from '../utils/action';

export const forgejoApiCommit = async (
  context: GithubContext,
  message: string,
  email: string,
  name: string
) => {
  core.info(`Committing changes to Forgejo with message: "${message}"`);
  const [owner, repo] = context.repository.repoName.split('/');

  run('git add -A');

  const changes = run('git diff-index --cached -M -z HEAD');
  if (changes.status !== 0) {
    throw new Error(`Failed to get changed files: ${changes.stderr}`);
  }

  const chunks = changes.stdout
    .split('\0')
    .filter((chunk) => chunk.trim() !== '');

  const files: ChangeFileOperation[] = [];

  let i = 0;
  while (i < chunks.length) {
    const metaAndPath = chunks[i];
    // oxlint-disable-next-line prefer-regexp-exec
    const match = metaAndPath.match(
      /^:(\d+) (\d+) ([a-f0-9]+) ([a-f0-9]+) ([ADMRUXT]\d*)$/i
    );

    if (!match) {
      i += 1;
      continue;
    }

    // oxlint-disable-next-line no-unreadable-array-destructuring
    const [, , , srcSha, , status] = match;
    const statusCode = status[0].toUpperCase();

    if (statusCode === 'R') {
      const fromPath = chunks[i + 1];
      const toPath = chunks[i + 2];

      core.info(`Detected rename from ${fromPath} to ${toPath}`);
      const location = path.join(context.workspace, toPath);
      const content = Buffer.from(readFileSync(location)).toString('base64');

      files.push({
        content,
        from_path: fromPath,
        operation: 'update',
        path: toPath,
        sha: srcSha
      });

      i += 3;
    } else {
      const filePath = chunks[i + 1];
      const location = path.join(context.workspace, filePath);

      switch (statusCode) {
        case 'A': {
          core.info(`Detected addition of file ${filePath}`);

          const content = Buffer.from(readFileSync(location)).toString(
            'base64'
          );
          files.push({
            content,
            operation: 'create',
            path: filePath
          });
          break;
        }
        case 'D': {
          core.info(`Detected deletion of file ${filePath}`);

          files.push({
            operation: 'delete',
            path: filePath,
            sha: srcSha
          });
          break;
        }
        case 'M': {
          core.info(`Detected modification of file ${filePath}`);

          const content = Buffer.from(readFileSync(location)).toString(
            'base64'
          );
          files.push({
            content,
            operation: 'update',
            path: filePath,
            sha: srcSha
          });
          break;
        }
        default: {
          core.warning(
            `Unsupported file status: ${statusCode} for file ${filePath}`
          );
        }
      }

      i += 2;
    }
  }

  console.log(JSON.stringify(files));
  console.log(JSON.stringify(context));

  const { error, response, data, request } = await repoChangeFiles({
    body: {
      author: {
        email,
        name
      },
      branch: context.ref,
      files,
      message
    },
    parseAs: 'text',
    path: {
      owner,
      repo
    }
  });

  console.log('Forgejo API request:', request);
  core.info(`Data: ${JSON.stringify(data)}`);

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
