import type { LintResult } from '../utils/lint-result';
import Autopep8 from './autopep8';
import Basedpyright from './basedpyright';
import Black from './black';
import Clippy from './clippy';
import ESLint from './eslint';
import Mypy from './mypy';
import OxFmt from './oxfmt';
import OxLint from './oxlint';
import Prettier from './prettier';
import Ruff from './ruff';
import RustFmt from './rustfmt';
import Svelte from './svelte';
import TSC from './tsc';
import TY from './ty';

/**
 * Interface for all linters.
 */
export interface Linter {
  /** Name of the linter. */
  readonly linterName: string;
  /** Verifies that the linter is installed and can be run. */
  verifySetup: (dir: string, prefix?: string) => Promise<void>;
  /** Runs the linter. */
  lint: (
    dir: string,
    extensions: string[],
    args?: string,
    fix?: boolean,
    prefix?: string
  ) => { status: number | null; stdout: string; stderr: string };
  /** Parses the output of the linter. */
  parseOutput: (
    dir: string,
    output: { status: number | null; stdout: string; stderr: string },
    relativeDir?: string
  ) => LintResult;
}

// Linters/type checkers run before formatters, so formatters can clean up after linter fixes and
// All fixes end up in a single commit
// oxlint-disable-next-line sort-keys
const linters: Record<string, Linter> = {
  clippy: Clippy,
  eslint: ESLint,
  mypy: Mypy,
  oxlint: OxLint,
  svelte: Svelte,
  tsc: TSC,
  ty: TY,
  basedpyright: Basedpyright,
  autopep8: Autopep8,
  ruff: Ruff,
  black: Black,
  oxfmt: OxFmt,
  prettier: Prettier,
  rustfmt: RustFmt
};

export default linters;
