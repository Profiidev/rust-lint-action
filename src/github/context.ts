import { readFileSync } from "fs";

import * as core from "@actions/core";

import { name as actionName } from "../../package.json";
import { getEnv } from "../utils/action";

/**
 * GitHub Actions workflow's environment variables
 */
export interface ActionEnv {
	/** Event actor. */
	actor: string;
	/** Event name. */
	eventName: string;
	/** Event path. */
	eventPath: string;
	/** Token. */
	token: string;
	/** Workspace path. */
	workspace: string;
}

/**
 * Information about the GitHub repository and its fork (if it exists)
 */
export interface GithubRepository {
	/** Repo name. */
	repoName: string;
	/** Repo clone URL. */
	cloneUrl: string;
	/** Fork name. */
	forkName?: string;
	/** Fork repo clone URL. */
	forkCloneUrl?: string;
	/** Whether repo has a fork. */
	hasFork: boolean;
}

/**
 * Information about the GitHub repository and action trigger event
 */
export interface GithubContext {
	/** Event actor. */
	actor: string;
	/** Branch name. */
	branch: string;
	/** Event. */
	event: any;
	/** Event name. */
	eventName: string;
	/** Information about the GitHub repository */
	repository: GithubRepository;
	/** Token. */
	token: string;
	/** Workspace path. */
	workspace: string;
}

/**
 * Returns the GitHub Actions workflow's environment variables
 * @returns {ActionEnv} GitHub Actions workflow's environment variables
 */
export function parseActionEnv(): ActionEnv {
	return {
		// Information provided by environment
		actor: getEnv("github_actor", true)!,
		eventName: getEnv("github_event_name", true)!,
		eventPath: getEnv("github_event_path", true)!,
		workspace: getEnv("github_workspace", true)!,

		// Information provided by action user
		token: core.getInput("github_token", { required: true }),
	};
}

/**
 * Parse `event.json` file (file with the complete webhook event payload, automatically provided by
 * GitHub)
 * @param {string} eventPath - Path to the `event.json` file
 * @returns {any} - Webhook event payload
 */
export function parseEnvFile(eventPath: string): any {
	const eventBuffer = readFileSync(eventPath, "utf8");
	return JSON.parse(eventBuffer);
}

/**
 * Parses the name of the current branch from the GitHub webhook event
 * @param {string} eventName - GitHub event type
 * @param {any} event - GitHub webhook event payload
 * @returns {string} - Branch name
 */
export function parseBranch(eventName: string, event: any): string {
	if (eventName === "push" || eventName === "workflow_dispatch") {
		return event.ref.substring(11); // Remove "refs/heads/" from start of string
	}
	if (eventName === "pull_request" || eventName === "pull_request_target") {
		return event.pull_request.head.ref;
	}
	throw Error(`${actionName} does not support "${eventName}" GitHub events`);
}

/**
 * Parses the name of the current repository and determines whether it has a corresponding fork.
 * Fork detection is only supported for the "pull_request" event
 * @param {string} eventName - GitHub event type
 * @param {any} event - GitHub webhook event payload
 * @returns {GithubRepository} - Information about the GitHub repository and its fork (if it exists)
 */
export function parseRepository(eventName: string, event: any): GithubRepository {
	const repoName = event.repository.full_name;
	const cloneUrl = event.repository.clone_url;
	let forkName: string | undefined;
	let forkCloneUrl: string | undefined;
	if (eventName === "pull_request" || eventName === "pull_request_target") {
		// "pull_request" events are triggered on the repository where the PR is made. The PR branch can
		// be on the same repository (`forkRepository` is set to `null`) or on a fork (`forkRepository`
		// is defined)
		const headRepoName = event.pull_request.head.repo.full_name;
		forkName = repoName === headRepoName ? undefined : headRepoName;
		const headForkCloneUrl = event.pull_request.head.repo.clone_url;
		forkCloneUrl = cloneUrl === headForkCloneUrl ? undefined : headForkCloneUrl;
	}
	return {
		repoName,
		cloneUrl,
		forkName,
		forkCloneUrl,
		hasFork: forkName != null && forkName !== repoName,
	};
}

/**
 * Returns information about the GitHub repository and action trigger event
 * @returns {GithubContext} context - Information about the GitHub repository and action trigger
 * event
 */
export function getContext(): GithubContext {
	const { actor, eventName, eventPath, token, workspace } = parseActionEnv();
	const event = parseEnvFile(eventPath);
	return {
		actor,
		branch: parseBranch(eventName, event),
		event,
		eventName,
		repository: parseRepository(eventName, event),
		token,
		workspace,
	};
}
