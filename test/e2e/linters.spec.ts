import { describe, expect, it } from 'vitest';
import {
  type Lang,
  checkRuns,
  fixtureRepo,
  requireNodeTool,
  requireTool,
  runAction
} from './harness';

interface LinterCase {
  /** Input name (`<id>`, `<id>_auto_fix`, …) */
  id: string;
  /** Linter name used for the check run and the commit message */
  name: string;
  lang: Lang;
  available: () => boolean;
  /** Issues of the broken fixture: each must be covered by an annotation */
  issues: { level: 'failure' | 'warning'; path: string; line: number }[];
  /** For linters fixing by default: file and a snippet the fix removes */
  fix?: { file: string; removed: string };
}

const cases: LinterCase[] = [
  {
    available: () => requireTool('cargo clippy --version'),
    fix: { file: 'src/main.rs', removed: 'return a + b;' },
    id: 'clippy',
    issues: [{ level: 'warning', line: 2, path: 'src/main.rs' }],
    lang: 'rust',
    name: 'clippy'
  },
  {
    available: () => requireTool('cargo fmt --version'),
    fix: { file: 'src/main.rs', removed: 'let x   =' },
    id: 'rustfmt',
    // Rustfmt reports the first line of the diff hunk
    issues: [{ level: 'failure', line: 3, path: 'src/main.rs' }],
    lang: 'rust',
    name: 'rustfmt'
  },
  {
    available: () => requireNodeTool('eslint'),
    fix: { file: 'src/app.js', removed: 'let total' },
    id: 'eslint',
    issues: [
      { level: 'failure', line: 3, path: 'src/app.js' },
      { level: 'failure', line: 4, path: 'src/app.js' }
    ],
    lang: 'node',
    name: 'ESLint'
  },
  {
    available: () => requireNodeTool('prettier'),
    fix: { file: 'src/app.js', removed: 'result   =' },
    id: 'prettier',
    issues: [{ level: 'failure', line: 1, path: 'src/app.js' }],
    lang: 'node',
    name: 'prettier'
  },
  {
    available: () => requireNodeTool('tsc'),
    id: 'tsc',
    issues: [{ level: 'failure', line: 3, path: 'src/math.ts' }],
    lang: 'node',
    name: 'TypeScript'
  },
  {
    available: () => requireNodeTool('sv'),
    id: 'svelte',
    issues: [
      { level: 'failure', line: 3, path: 'src/App.svelte' },
      { level: 'failure', line: 3, path: 'src/math.ts' }
    ],
    lang: 'node',
    name: 'svelte'
  },
  {
    available: () => requireNodeTool('oxfmt'),
    fix: { file: 'src/app.js', removed: 'result   =' },
    id: 'oxfmt',
    issues: [{ level: 'failure', line: 1, path: 'src/app.js' }],
    lang: 'node',
    name: 'oxfmt'
  },
  {
    available: () => requireNodeTool('oxlint'),
    // `prefer-const` is enabled in the fixture's .oxlintrc.json, it has a safe fix
    fix: { file: 'src/app.js', removed: 'let total' },
    id: 'oxlint',
    issues: [
      { level: 'failure', line: 3, path: 'src/app.js' },
      { level: 'warning', line: 4, path: 'src/app.js' }
    ],
    lang: 'node',
    name: 'oxlint'
  },
  {
    available: () => requireTool('mypy --version'),
    id: 'mypy',
    issues: [{ level: 'failure', line: 5, path: 'app.py' }],
    lang: 'python',
    name: 'mypy'
  },
  {
    available: () => requireTool('ty --version'),
    // `ty --fix` can't fix type errors, so there is nothing to commit
    id: 'ty',
    issues: [{ level: 'failure', line: 5, path: 'app.py' }],
    lang: 'python',
    name: 'ty'
  },
  {
    available: () => requireTool('basedpyright --version'),
    id: 'basedpyright',
    issues: [{ level: 'failure', line: 5, path: 'app.py' }],
    lang: 'python',
    name: 'basedpyright'
  },
  {
    available: () => requireTool('autopep8 --version'),
    fix: { file: 'app.py', removed: 'result=add(1,2)' },
    id: 'autopep8',
    issues: [{ level: 'failure', line: 6, path: 'app.py' }],
    lang: 'python',
    name: 'autopep8'
  },
  {
    available: () => requireTool('ruff --version'),
    fix: { file: 'app.py', removed: 'result=add(1,2)' },
    id: 'ruff',
    issues: [{ level: 'failure', line: 6, path: 'app.py' }],
    lang: 'python',
    name: 'ruff'
  },
  {
    available: () => requireTool('black --version'),
    fix: { file: 'app.py', removed: 'result=add(1,2)' },
    id: 'black',
    issues: [{ level: 'failure', line: 6, path: 'app.py' }],
    lang: 'python',
    name: 'black'
  }
];

describe.each(cases)('$id', (c) => {
  const { available, fix, id, issues, lang, name } = c;
  describe.skipIf(!available())('with the real linter', () => {
    it('fails on the broken fixture with annotations', async () => {
      const repo = fixtureRepo(lang, 'broken');
      const result = await runAction(repo, { inputs: { [id]: 'true' } });
      expect(result.exitCode).toBe(0);
      const check = checkRuns(result.requests)[name];
      expect(check).toMatchObject({ conclusion: 'failure' });
      const { annotations } = check.output;
      for (const issue of issues) {
        expect(
          annotations.some(
            (a: any) =>
              a.path === issue.path &&
              a.annotation_level === issue.level &&
              a.start_line <= issue.line &&
              a.end_line >= issue.line
          ),
          `${issue.level} at ${issue.path}:${issue.line} in ${JSON.stringify(annotations)}`
        ).toBe(true);
      }
      // Without auto_fix nothing is pushed
      expect(repo.git(`--git-dir "${repo.remote}" rev-list --count main`)).toBe(
        '1'
      );
    });

    it('succeeds on the clean fixture', async () => {
      const repo = fixtureRepo(lang, 'clean');
      const result = await runAction(repo, { inputs: { [id]: 'true' } });
      expect(result.exitCode).toBe(0);
      expect(checkRuns(result.requests)[name]).toMatchObject({
        conclusion: 'success',
        output: { annotations: [] }
      });
    });

    if (fix) {
      it('commits and pushes the fix', async () => {
        const repo = fixtureRepo(lang, 'broken');
        const result = await runAction(repo, {
          inputs: { [id]: 'true', auto_fix: 'true' }
        });
        expect(result.exitCode).toBe(0);
        const remote = (cmd: string) =>
          repo.git(`--git-dir "${repo.remote}" ${cmd}`);
        expect(remote('log -1 --format=%s main')).toBe(
          `chore: fix code style issues with ${name}`
        );
        expect(remote(`show main:${fix.file}`)).not.toContain(fix.removed);
      });
    }
  });
});
