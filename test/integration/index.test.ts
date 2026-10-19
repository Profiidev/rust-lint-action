import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupActionEnv } from '../helpers/action-env';

// Hoisted so every fresh import of the mocked module after resetModules shares the same spies
const { runAction, runPost } = vi.hoisted(() => ({
  runAction: vi.fn(async () => undefined),
  runPost: vi.fn(async () => undefined)
}));
vi.mock('../../src/main', () => ({ runAction, runPost }));

let env: ReturnType<typeof setupActionEnv>;

beforeEach(() => {
  env = setupActionEnv();
  vi.resetModules();
});

afterEach(() => env.restore());

/** Imports the entry point fresh, so its top-level dispatch runs again, and lets it settle */
const runIndex = async () => {
  await import('../../src/index');
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
};

describe('index', () => {
  it('runs the main step and marks the next run as post step', async () => {
    await runIndex();
    expect(runAction).toHaveBeenCalledOnce();
    expect(runPost).not.toHaveBeenCalled();
    expect(env.state()).toEqual({ isPost: 'true' });
    expect(process.exitCode).toBeUndefined();
  });

  it('runs the post step when isPost was saved', async () => {
    vi.stubEnv('STATE_isPost', 'true');
    await runIndex();
    expect(runPost).toHaveBeenCalledOnce();
    expect(runAction).not.toHaveBeenCalled();
  });

  it('fails the action and logs the stack when a step rejects', async () => {
    const error = new Error('boom');
    vi.mocked(runAction).mockRejectedValueOnce(error);
    await runIndex();
    expect(process.exitCode).toBe(1);
    expect(env.commands('error')).toEqual(['boom']);
    expect(env.commands('debug')).toEqual([
      error.stack?.replaceAll('\n', '%0A')
    ]);
  });

  it('logs a placeholder for errors without a stack', async () => {
    vi.stubEnv('STATE_isPost', 'true');
    vi.mocked(runPost).mockRejectedValueOnce({ message: 'no stack' });
    await runIndex();
    expect(process.exitCode).toBe(1);
    expect(env.commands('error')).toEqual(['no stack']);
    expect(env.commands('debug')).toEqual(['No error stack trace']);
  });
});
