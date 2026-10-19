import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const git = (cwd: string, cmd: string): string =>
  execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

export const tempDir = (prefix = 'lint-test-'): string =>
  mkdtempSync(path.join(tmpdir(), prefix));

export interface TestRepo {
  /** Working copy */
  dir: string;
  /** Bare repository configured as `origin` */
  remote: string;
  write: (file: string, content: string) => void;
  git: (cmd: string) => string;
  cleanup: () => void;
}

/**
 * Creates a working repository with one commit on `main`, pushed to a bare `origin`. Git identity
 * is set locally so no global config is touched
 */
export const createRepo = (
  files: Record<string, string> = { 'README.md': 'init\n' }
): TestRepo => {
  const root = tempDir();
  const dir = path.join(root, 'work');
  const remote = path.join(root, 'remote.git');
  execSync(`git init --bare -q -b main "${remote}"`);
  execSync(`git init -q -b main "${dir}"`);
  const write = (file: string, content: string) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  };
  git(dir, 'config user.name Test');
  git(dir, 'config user.email test@example.com');
  git(dir, 'config commit.gpgsign false');
  for (const [file, content] of Object.entries(files)) {
    write(file, content);
  }
  git(dir, 'add -A');
  git(dir, 'commit -q -m init');
  git(dir, `remote add origin "${remote}"`);
  git(dir, 'push -q -u origin main');
  return {
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    dir,
    git: (cmd) => git(dir, cmd),
    remote,
    write
  };
};
