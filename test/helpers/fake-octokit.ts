import { vi } from 'vitest';

export interface RecordedCall {
  method: string;
  params: Record<string, any>;
}

/**
 * Minimal octokit stand-in covering every endpoint the action uses. All calls are recorded in
 * `calls`; `responses` maps a `request` route (e.g. `GET /repos/{owner}/{repo}/git/ref/{ref}`)
 * to the `data` it resolves with
 */
export const createFakeOctokit = (responses: Record<string, unknown> = {}) => {
  const calls: RecordedCall[] = [];
  let nextCheckId = 1;
  const record = (method: string) =>
    vi.fn(async (params: Record<string, any>) => {
      calls.push({ method, params });
      return { data: {} };
    });

  const octokit = {
    request: vi.fn(async (route: string, params: Record<string, any> = {}) => {
      calls.push({ method: route, params });
      return { data: responses[route] ?? {} };
    }),
    rest: {
      checks: {
        create: vi.fn(async (params: Record<string, any>) => {
          calls.push({ method: 'checks.create', params });
          return { data: { id: nextCheckId++ } };
        }),
        update: record('checks.update')
      },
      repos: {
        createCommitStatus: record('repos.createCommitStatus')
      }
    }
  };

  return { calls, octokit: octokit as any };
};
