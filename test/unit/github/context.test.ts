import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as core from '@actions/core';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getContext,
  parseActionEnv,
  parseBranch,
  parseEnvFile,
  parseRepository
} from '../../../src/github/context';

vi.mock('@actions/core', () => ({ getInput: vi.fn() }));

const dir = mkdtempSync(path.join(tmpdir(), 'lint-context-test-'));
afterAll(() => rmSync(dir, { force: true, recursive: true }));

const writeEvent = (event: unknown) => {
  const file = path.join(dir, 'event.json');
  writeFileSync(file, JSON.stringify(event));
  return file;
};

const ENV = {
  GITHUB_ACTOR: 'octocat',
  GITHUB_EVENT_NAME: 'push',
  GITHUB_EVENT_PATH: '/tmp/event.json',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_WORKSPACE: '/work'
};

const stubEnv = (env: Record<string, string>) => {
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
};

const prEvent = (head: string, headUrl = `https://x/${head}.git`) => ({
  pull_request: {
    head: { ref: 'feature', repo: { clone_url: headUrl, full_name: head } }
  },
  repository: { clone_url: 'https://x/o/r.git', full_name: 'o/r' }
});

beforeEach(() => {
  vi.mocked(core.getInput).mockReturnValue('token');
});

describe('parseActionEnv', () => {
  it('reads all variables and the token input', () => {
    stubEnv(ENV);
    expect(parseActionEnv()).toEqual({
      actor: 'octocat',
      eventName: 'push',
      eventPath: '/tmp/event.json',
      ref: 'refs/heads/main',
      token: 'token',
      workspace: '/work'
    });
    expect(core.getInput).toHaveBeenCalledWith('github_token', {
      required: true
    });
  });

  it.each(Object.keys(ENV))('throws when %s is missing', (missing) => {
    stubEnv(ENV);
    vi.stubEnv(missing, undefined);
    expect(() => parseActionEnv()).toThrow(
      `Environment variable "${missing}" is not defined`
    );
  });

  it('propagates a missing token error', () => {
    stubEnv(ENV);
    vi.mocked(core.getInput).mockImplementation(() => {
      throw new Error('Input required and not supplied: github_token');
    });
    expect(() => parseActionEnv()).toThrow('github_token');
  });
});

describe('parseEnvFile', () => {
  it('parses the JSON event file', () => {
    expect(parseEnvFile(writeEvent({ a: 1 }))).toEqual({ a: 1 });
  });

  it('throws for a missing file', () => {
    expect(() => parseEnvFile(path.join(dir, 'missing.json'))).toThrow();
  });
});

describe('parseBranch', () => {
  it.each(['push', 'workflow_dispatch'])(
    'strips refs/heads/ for %s',
    (name) => {
      expect(parseBranch(name, { ref: 'refs/heads/feat/x' })).toBe('feat/x');
    }
  );

  it.each(['pull_request', 'pull_request_target'])(
    'uses the head ref for %s',
    (name) => {
      expect(parseBranch(name, prEvent('o/r'))).toBe('feature');
    }
  );

  it('throws for unsupported events', () => {
    expect(() => parseBranch('schedule', {})).toThrow(
      'rust-lint-action does not support "schedule" GitHub events'
    );
  });
});

describe('parseRepository', () => {
  it('has no fork for push events', () => {
    expect(parseRepository('push', prEvent('fork/r'))).toEqual({
      cloneUrl: 'https://x/o/r.git',
      forkCloneUrl: undefined,
      forkName: undefined,
      hasFork: false,
      repoName: 'o/r'
    });
  });

  it.each(['pull_request', 'pull_request_target'])(
    'detects a fork for %s',
    (name) => {
      expect(parseRepository(name, prEvent('fork/r'))).toEqual({
        cloneUrl: 'https://x/o/r.git',
        forkCloneUrl: 'https://x/fork/r.git',
        forkName: 'fork/r',
        hasFork: true,
        repoName: 'o/r'
      });
    }
  );

  it('has no fork when the PR head is the same repository', () => {
    expect(parseRepository('pull_request', prEvent('o/r'))).toEqual({
      cloneUrl: 'https://x/o/r.git',
      forkCloneUrl: undefined,
      forkName: undefined,
      hasFork: false,
      repoName: 'o/r'
    });
  });

  it('keeps fork name and URL independent', () => {
    // Same clone URL but different name: fork without clone URL
    expect(
      parseRepository('pull_request', prEvent('fork/r', 'https://x/o/r.git'))
    ).toMatchObject({
      forkCloneUrl: undefined,
      forkName: 'fork/r',
      hasFork: true
    });
  });
});

describe('getContext', () => {
  it('combines env, event file and parsed values', () => {
    const event = prEvent('fork/r');
    stubEnv({
      ...ENV,
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: writeEvent(event)
    });
    expect(getContext()).toEqual({
      actor: 'octocat',
      branch: 'feature',
      event,
      eventName: 'pull_request',
      ref: 'refs/heads/main',
      repository: {
        cloneUrl: 'https://x/o/r.git',
        forkCloneUrl: 'https://x/fork/r.git',
        forkName: 'fork/r',
        hasFork: true,
        repoName: 'o/r'
      },
      token: 'token',
      workspace: '/work'
    });
  });
});
