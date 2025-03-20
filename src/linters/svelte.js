const { run } = require("../utils/action");
const commandExists = require("../utils/command-exists");
const { initLintResult } = require("../utils/lint-result");
const core = require("@actions/core");

/** @typedef {import('../utils/lint-result').LintResult} LintResult */

class Svelte {
	static get name() {
		return "Svelte";
	}

	/**
	 * Verifies that all required programs are installed. Throws an error if programs are missing
	 * @param {string} dir - Directory to run the linting program in
	 * @param {string} prefix - Prefix to the lint command
	 */
	static async verifySetup(dir, prefix = "") {
		// Verify that NPM is installed (required to execute Prettier)
		if (!(await commandExists("npm"))) {
			throw new Error("NPM is not installed");
		}

		// Verify that SV is installed
		const commandPrefix = prefix || "npx -y";
		try {
			run(`${commandPrefix} sv -v`, { dir });
		} catch (err) {
			throw new Error(`${this.name} is not installed`);
		}
	}

	/**
	 * Runs the linting program and returns the command output
	 * @param {string} dir - Directory to run the linter in
	 * @param {string[]} extensions - File extensions which should be linted
	 * @param {string} args - Additional arguments to pass to the linter
	 * @param {boolean} fix - Whether the linter should attempt to fix code style issues automatically
	 * @param {string} prefix - Prefix to the lint command
	 * @returns {{status: number, stdout: string, stderr: string}} - Output of the lint command
	 */
	static lint(dir, extensions, args = "", fix = false, prefix = "") {
		const commandPrefix = prefix || "npx --no-install";
		return run(`${commandPrefix} sv check --output machine-verbose ${args}`, {
			dir,
			ignoreErrors: true,
		});
	}

	/**
	 * Parses the output of the lint command. Determines the success of the lint process and the
	 * severity of the identified code style violations
	 * @param {string} dir - Directory in which the linter has been run
	 * @param {{status: number, stdout: string, stderr: string}} output - Output of the lint command
	 * @returns {LintResult} - Parsed lint result
	 */
	static parseOutput(dir, output) {
		const lintResult = initLintResult();
		lintResult.isSuccess = output.status === 0;
		if (lintResult.isSuccess || !output) {
			return lintResult;
		}

		const lints = output.stdout
			.split(/\n/)
			.map((lint) => {
				core.debug(lint);
				try {
					return JSON.parse(lint);
				} catch (e) {}
			})
			.filter((lint) => {
				core.debug(lint);
				return lint;
			});

		lintResult.error = lints
			.filter((lint) => lint.type === "ERROR")
			.map((lint) => ({
				path: lint.filename,
				firstLine: lint.start.line,
				lastLine: lint.end.line,
				message: lint.message,
			}));

		lintResult.warning = lints
			.filter((lint) => lint.type === "WARNING")
			.map((lint) => ({
				path: lint.filename,
				firstLine: lint.start.line,
				lastLine: lint.end.line,
				message: lint.message,
			}));

		return lintResult;
	}
}

module.exports = Svelte;
