import { execSync } from "child_process";
import * as core from "@actions/core";

interface RunOptions {
	dir?: string | null;
	ignoreErrors?: boolean;
	prefix?: string;
}

const RUN_OPTIONS_DEFAULTS: RunOptions = { dir: null, ignoreErrors: false, prefix: "" };

/**
 * Returns the value for an environment variable. If the variable is required but doesn't have a
 * value, an error is thrown
 * @param {string} name - Name of the environment variable
 * @param {boolean} required - Whether an error should be thrown if the variable doesn't have a
 * value
 * @returns {string | null} - Value of the environment variable
 */
export function getEnv(name: string, required = false): string | null {
	const nameUppercase = name.toUpperCase();
	const value = process.env[nameUppercase];
	if (value == null) {
		// Value is either not set (`undefined`) or set to `null`
		if (required) {
			throw new Error(`Environment variable "${nameUppercase}" is not defined`);
		}
		return null;
	}
	return value;
}

/**
 * Executes the provided shell command
 * @param {string} cmd - Shell command to execute
 * @param {RunOptions} [options] - {@see RUN_OPTIONS_DEFAULTS}
 * @returns {{status: number | null, stdout: string, stderr: string}} - Output of the shell command
 */
export function run(
	cmd: string,
	options?: RunOptions,
): { status: number | null; stdout: string; stderr: string } {
	const optionsWithDefaults = {
		...RUN_OPTIONS_DEFAULTS,
		...options,
	};

	core.debug(cmd);

	try {
		const stdout = execSync(cmd, {
			encoding: "utf8",
			cwd: optionsWithDefaults.dir || undefined,
			maxBuffer: 20 * 1024 * 1024,
		});
		const output = {
			status: 0,
			stdout: stdout.trim(),
			stderr: "",
		};

		core.debug(`Stdout: ${output.stdout}`);

		return output;
	} catch (err: any) {
		if (optionsWithDefaults.ignoreErrors) {
			const output = {
				status: err.status as number | null,
				stdout: (err.stdout || "").toString().trim(),
				stderr: (err.stderr || "").toString().trim(),
			};

			core.debug(`Exit code: ${output.status}`);
			core.debug(`Stdout: ${output.stdout}`);
			core.debug(`Stderr: ${output.stderr}`);

			return output;
		}
		throw err;
	}
}
