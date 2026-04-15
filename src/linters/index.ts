import { LintResult } from "../utils/lint-result";
import Clippy from "./clippy";
import Prettier from "./prettier";
import RustFmt from "./rustfmt";
import Svelte from "./svelte";
import TSC from "./tsc";

/**
 * Interface for all linters.
 */
export interface Linter {
	/** Name of the linter. */
	readonly linterName: string;
	/** Verifies that the linter is installed and can be run. */
	verifySetup(dir: string, prefix?: string): Promise<void>;
	/** Runs the linter. */
	lint(
		dir: string,
		extensions: string[],
		args?: string,
		fix?: boolean,
		prefix?: string,
	): { status: number | null; stdout: string; stderr: string };
	/** Parses the output of the linter. */
	parseOutput(
		dir: string,
		output: { status: number | null; stdout: string; stderr: string },
	): LintResult;
}

const linters: Record<string, Linter> = {
	clippy: Clippy,
	rustfmt: RustFmt,
	tsc: TSC,
	prettier: Prettier,
	svelte: Svelte,
};

export default linters;
