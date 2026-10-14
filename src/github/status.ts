import * as core from '@actions/core';
import type { getOctokit } from '@actions/github';
import type { LintResult } from '../utils/lint-result';
import { capitalizeFirstLetter } from '../utils/string';

const STATE_KEY = 'checks';

/**
 * Runs a check update and logs errors instead of throwing
 * @param name - Check name
 * @param update - Update to run
 */
const safe = async (
  name: string,
  update: () => Promise<void>
): Promise<void> => {
  try {
    await update();
  } catch (error: any) {
    core.warning(`Could not update check ${name}: ${error.message}`);
  }
};

export interface StatusOptions {
  octokit: ReturnType<typeof getOctokit>;
  /** Repository in `owner/repo` format */
  repoName: string;
  /** Commit the checks are attached to */
  sha: string;
  /** Create commit statuses instead of check runs */
  forgejo: boolean;
  neutralCheckOnWarning: boolean;
  targetUrl?: string;
}

/** State handed to the post step, so it can fail checks left over by a crashed or cancelled run */
interface SavedState {
  repoName: string;
  sha: string;
  forgejo: boolean;
  /** Check name to check run id (0 for Forgejo commit statuses) */
  pending: Record<string, number>;
}

/**
 * Creates and continuously updates one check run (or Forgejo commit status) per linter:
 * queued, in progress, completed. Failures to update are logged, never thrown
 */
export class Checks {
  private readonly pending = new Map<string, number>();

  private readonly owner: string;

  private readonly repo: string;

  public constructor(private readonly options: StatusOptions) {
    [this.owner, this.repo] = options.repoName.split('/');
  }

  /**
   * Marks all checks as queued
   * @param names - Check names
   */
  public async queue(names: string[]): Promise<void> {
    await Promise.all(
      names.map(async (name) =>
        safe(name, async () => {
          if (this.options.forgejo) {
            await this.commitStatus(name, 'pending', 'queued');
            this.pending.set(name, 0);
          } else {
            const { data } = await this.options.octokit.rest.checks.create({
              head_sha: this.options.sha,
              name,
              owner: this.owner,
              repo: this.repo,
              status: 'queued'
            });
            this.pending.set(name, data.id);
          }
        })
      )
    );
    this.save();
  }

  /**
   * Marks a check as running
   * @param name - Check name
   */
  public async start(name: string): Promise<void> {
    await safe(name, async () => {
      if (this.options.forgejo) {
        await this.commitStatus(name, 'pending', 'running');
      } else if (this.pending.get(name)) {
        await this.options.octokit.rest.checks.update({
          check_run_id: this.pending.get(name)!,
          owner: this.owner,
          repo: this.repo,
          status: 'in_progress'
        });
      }
    });
  }

  /**
   * Completes a check with the lint result. Creates the check if it wasn't queued before
   * @param name - Check name
   * @param lintResult - Parsed lint result
   * @param summary - Summary of the lint result
   */
  public async complete(
    name: string,
    lintResult: LintResult,
    summary: string
  ): Promise<void> {
    const { neutralCheckOnWarning } = this.options;
    await safe(name, async () => {
      if (this.options.forgejo) {
        const success =
          lintResult.isSuccess ||
          (lintResult.warning.length === 0 && lintResult.error.length === 0) ||
          (neutralCheckOnWarning &&
            lintResult.warning.length > 0 &&
            lintResult.error.length === 0);
        await this.commitStatus(
          name,
          success ? 'success' : 'failure',
          `${name} found ${summary}`
        );
      } else {
        let annotations = (['error', 'warning'] as const).flatMap((level) =>
          lintResult[level].map((result) => ({
            annotation_level:
              level === 'warning' ? ('warning' as const) : ('failure' as const),
            end_line: result.lastLine,
            message: result.message,
            path: result.path,
            start_line: result.firstLine
          }))
        );
        // Only use the first 50 annotations (limit for a single API request)
        if (annotations.length > 50) {
          core.info(
            `There are more than 50 errors/warnings from ${name}. Annotations are created for the first 50 issues only.`
          );
          annotations = annotations.slice(0, 50);
        }

        let conclusion: 'neutral' | 'success' | 'failure' = 'failure';
        if (lintResult.isSuccess) {
          conclusion =
            annotations.length > 0 && neutralCheckOnWarning
              ? 'neutral'
              : 'success';
        }

        core.info(
          `Completing check ${name} with ${conclusion} conclusion and ${annotations.length} annotations`
        );
        await this.finish(name, conclusion, {
          annotations,
          summary: `${name} found ${summary}`,
          title: capitalizeFirstLetter(summary)
        });
      }
      this.pending.delete(name);
      this.save();
    });
  }

  /**
   * Fails all checks which were queued but never completed
   */
  public async failRemaining(): Promise<void> {
    await Promise.all(
      [...this.pending.keys()].map(async (name) =>
        safe(name, async () => {
          core.info(`Marking ${name} as failed`);
          if (this.options.forgejo) {
            await this.commitStatus(name, 'failure', 'did not finish');
          } else {
            await this.finish(name, 'failure', {
              summary: `${name} did not finish. See the workflow logs for details.`,
              title: 'Did not finish'
            });
          }
        })
      )
    );
  }

  /**
   * Restores the checks saved by the main step
   * @param options - Options without the saved fields
   * @returns Restored checks, or undefined if nothing was saved
   */
  public static restore(
    options: Omit<StatusOptions, keyof Omit<SavedState, 'pending'>>
  ): Checks | undefined {
    const raw = core.getState(STATE_KEY);
    if (!raw) {
      return undefined;
    }
    // oxlint-disable-next-line no-unsafe-type-assertion
    const { pending, ...saved } = JSON.parse(raw) as SavedState;
    const checks = new Checks({ ...options, ...saved });
    for (const [name, id] of Object.entries(pending)) {
      checks.pending.set(name, id);
    }
    return checks;
  }

  private async finish(
    name: string,
    conclusion: 'neutral' | 'success' | 'failure',
    output: { title: string; summary: string; annotations?: any[] }
  ): Promise<void> {
    const { octokit, sha } = this.options;
    const common = { conclusion, output, owner: this.owner, repo: this.repo };
    const checkRunId = this.pending.get(name);
    await (checkRunId
      ? octokit.rest.checks.update({ ...common, check_run_id: checkRunId })
      : octokit.rest.checks.create({ ...common, head_sha: sha, name }));
  }

  private async commitStatus(
    context: string,
    state: 'pending' | 'success' | 'failure',
    description: string
  ): Promise<void> {
    await this.options.octokit.rest.repos.createCommitStatus({
      context,
      description,
      owner: this.owner,
      repo: this.repo,
      sha: this.options.sha,
      state,
      target_url: this.options.targetUrl
    });
  }

  private save(): void {
    const state: SavedState = {
      forgejo: this.options.forgejo,
      pending: Object.fromEntries(this.pending),
      repoName: this.options.repoName,
      sha: this.options.sha
    };
    core.saveState(STATE_KEY, JSON.stringify(state));
  }
}
